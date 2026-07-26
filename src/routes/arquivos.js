'use strict';

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { UPLOAD_DIR, MAX_UPLOAD_BYTES } = require('../config');
const { ehExtensaoAceita, extensaoDe, EXTENSOES_ACEITAS } = require('../parsers');
const { hashArquivo } = require('../utils/files');
const { processarArquivo, reverterArquivo } = require('../services/importService');
const fornecedorService = require('../services/fornecedorService');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomUUID()}${extensaoDe(file.originalname)}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (ehExtensaoAceita(file.originalname)) return cb(null, true);
    const erro = new Error(`Formato nao aceito (${file.originalname}). Use: ${[...EXTENSOES_ACEITAS].join(', ')}`);
    erro.status = 400;
    cb(erro);
  },
});

// mergeParams: as rotas sao montadas sob /api/catalogos/:catalogoId/arquivos
const router = express.Router({ mergeParams: true });

function exigirCatalogo(req, res, next) {
  const catalogo = db.prepare('SELECT id FROM catalogos WHERE id = ?').get(req.params.catalogoId);
  if (!catalogo) return res.status(404).json({ erro: 'Catalogo nao encontrado.' });
  next();
}

router.use(exigirCatalogo);

router.get('/', (req, res) => {
  res.json(
    db.prepare(`
      SELECT a.*, f.nome AS fornecedor_nome
        FROM arquivos a LEFT JOIN fornecedores f ON f.id = a.fornecedor_id
       WHERE a.catalogo_id = ?
       ORDER BY a.criado_em DESC, a.id DESC`).all(req.params.catalogoId),
  );
});

router.post('/', upload.array('arquivos', 20), async (req, res, next) => {
  try {
    const enviados = req.files ?? [];
    if (!enviados.length) return res.status(400).json({ erro: 'Nenhum arquivo enviado (campo "arquivos").' });

    // contexto da tabela enviada: de qual fabrica ela e e o que a coluna de preco significa
    const fornecedor = req.body.fornecedor_id
      ? fornecedorService.porId(req.body.fornecedor_id)
      : fornecedorService.obterOuCriar(req.body.fornecedor);
    const vigencia = /^\d{4}-\d{2}-\d{2}$/.test(req.body.vigencia || '') ? req.body.vigencia : null;

    // desconto sobre a tabela cheia: a fabrica manda o preco de lista e o abatimento
    // é combinado à parte. Guardamos o líquido, e o percentual fica registrado.
    const desconto = Number(String(req.body.desconto ?? '').replace(',', '.'));
    const descontoValido = Number.isFinite(desconto) && desconto > 0 && desconto < 100 ? desconto : null;

    const resultados = [];
    for (const file of enviados) {
      const { lastInsertRowid: arquivoId } = db
        .prepare(`
          INSERT INTO arquivos (catalogo_id, fornecedor_id, vigencia, desconto_percentual,
                                nome_original, caminho, extensao, mime, tamanho, hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          req.params.catalogoId,
          fornecedor?.id ?? null,
          vigencia,
          descontoValido,
          file.originalname,
          file.path,
          extensaoDe(file.originalname),
          file.mimetype,
          file.size,
          hashArquivo(file.path),
        );

      const resultado = await processarArquivo(arquivoId);
      resultados.push({ id: arquivoId, nome: file.originalname, ...resultado });
    }

    db.prepare("UPDATE catalogos SET atualizado_em = datetime('now') WHERE id = ?").run(req.params.catalogoId);
    res.status(201).json({ arquivos: resultados });
  } catch (erro) {
    next(erro);
  }
});

router.post('/:arquivoId/reprocessar', async (req, res, next) => {
  try {
    const arquivo = db
      .prepare('SELECT id FROM arquivos WHERE id = ? AND catalogo_id = ?')
      .get(req.params.arquivoId, req.params.catalogoId);
    if (!arquivo) return res.status(404).json({ erro: 'Arquivo nao encontrado.' });

    reverterArquivo(arquivo.id);
    res.json(await processarArquivo(arquivo.id));
  } catch (erro) {
    next(erro);
  }
});

router.delete('/:arquivoId', (req, res) => {
  const info = db
    .prepare('DELETE FROM arquivos WHERE id = ? AND catalogo_id = ?')
    .run(req.params.arquivoId, req.params.catalogoId);
  if (!info.changes) return res.status(404).json({ erro: 'Arquivo nao encontrado.' });
  res.status(204).end();
});

module.exports = router;
