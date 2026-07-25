'use strict';

const express = require('express');
const multer = require('multer');
const db = require('../db');
const { salvarImagem } = require('../utils/files');

const EXT_ACEITAS = /\.(png|jpe?g|webp|gif|bmp)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (EXT_ACEITAS.test(file.originalname)) return cb(null, true);
    const erro = new Error('Envie uma imagem (png, jpg, webp, gif ou bmp).');
    erro.status = 400;
    cb(erro);
  },
});

const router = express.Router({ mergeParams: true });

const comUrl = (imagem) => ({ ...imagem, url: `/media/${imagem.caminho}` });

function exigirCatalogo(req, res, next) {
  const catalogo = db.prepare('SELECT id FROM catalogos WHERE id = ?').get(req.params.catalogoId);
  if (!catalogo) return res.status(404).json({ erro: 'Catalogo nao encontrado.' });
  next();
}

router.use(exigirCatalogo);

/** ?soltas=1 lista o que foi extraido dos arquivos mas ainda nao pertence a nenhuma peca. */
router.get('/', (req, res) => {
  const condicoes = ['m.catalogo_id = ?'];
  const params = [req.params.catalogoId];

  if (req.query.soltas === '1') condicoes.push('m.item_id IS NULL');
  if (req.query.item_id) {
    condicoes.push('m.item_id = ?');
    params.push(req.query.item_id);
  }

  const imagens = db.prepare(`
    SELECT m.*, a.nome_original AS arquivo
      FROM imagens m LEFT JOIN arquivos a ON a.id = m.arquivo_id
     WHERE ${condicoes.join(' AND ')}
     ORDER BY m.item_id IS NULL DESC, m.principal DESC, m.id`).all(...params);

  res.json(imagens.map(comUrl));
});

/** Sobe uma foto direto para uma peca (campo "imagem"). */
router.post('/', upload.single('imagem'), (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhuma imagem enviada (campo "imagem").' });

  const itemId = req.body.item_id ? Number(req.body.item_id) : null;
  if (itemId) {
    const item = db.prepare('SELECT id FROM itens WHERE id = ? AND catalogo_id = ?')
      .get(itemId, req.params.catalogoId);
    if (!item) return res.status(404).json({ erro: 'Peca nao encontrada.' });
  }

  const extensao = req.file.originalname.slice(req.file.originalname.lastIndexOf('.'));
  const salva = salvarImagem(req.file.buffer, extensao);

  const duplicada = db.prepare('SELECT id FROM imagens WHERE catalogo_id = ? AND hash = ? AND IFNULL(item_id, 0) = ?')
    .get(req.params.catalogoId, salva.hash, itemId ?? 0);
  if (duplicada) return res.status(200).json({ id: duplicada.id, ...salva, url: `/media/${salva.caminho}` });

  // primeira foto da peca ja entra como principal
  const jaTem = itemId
    ? db.prepare('SELECT COUNT(*) AS n FROM imagens WHERE item_id = ?').get(itemId).n
    : 0;

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO imagens (catalogo_id, arquivo_id, item_id, caminho, hash, largura, altura, ancora, principal)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.params.catalogoId, itemId, salva.caminho, salva.hash, salva.largura, salva.altura,
      `upload:${req.file.originalname}`, itemId && !jaTem ? 1 : 0);

  res.status(201).json(comUrl(db.prepare('SELECT * FROM imagens WHERE id = ?').get(lastInsertRowid)));
});

/** Vincula a imagem a uma peca (ou solta) e define qual e a principal. */
const vincular = db.transaction((imagemId, catalogoId, itemId, principal) => {
  if (itemId !== undefined) {
    db.prepare('UPDATE imagens SET item_id = ? WHERE id = ? AND catalogo_id = ?')
      .run(itemId, imagemId, catalogoId);
  }

  if (principal) {
    const imagem = db.prepare('SELECT item_id FROM imagens WHERE id = ?').get(imagemId);
    if (imagem?.item_id) {
      db.prepare('UPDATE imagens SET principal = 0 WHERE item_id = ?').run(imagem.item_id);
      db.prepare('UPDATE imagens SET principal = 1 WHERE id = ?').run(imagemId);
    }
  }
});

router.patch('/:imagemId', (req, res) => {
  const imagem = db.prepare('SELECT * FROM imagens WHERE id = ? AND catalogo_id = ?')
    .get(req.params.imagemId, req.params.catalogoId);
  if (!imagem) return res.status(404).json({ erro: 'Imagem nao encontrada.' });

  let itemId;
  if ('item_id' in req.body) {
    itemId = req.body.item_id === null || req.body.item_id === '' ? null : Number(req.body.item_id);
    if (itemId) {
      const item = db.prepare('SELECT id FROM itens WHERE id = ? AND catalogo_id = ?')
        .get(itemId, req.params.catalogoId);
      if (!item) return res.status(404).json({ erro: 'Peca nao encontrada.' });
    }
  }

  // ao vincular uma foto a uma peca que ainda nao tem nenhuma, ela vira a principal
  const viraPrincipal = req.body.principal
    || (itemId && db.prepare('SELECT COUNT(*) AS n FROM imagens WHERE item_id = ?').get(itemId).n === 0);

  vincular(imagem.id, Number(req.params.catalogoId), itemId, viraPrincipal);
  res.json(comUrl(db.prepare('SELECT * FROM imagens WHERE id = ?').get(imagem.id)));
});

/** Ao remover a principal, a proxima foto da peca assume — a peca nunca fica sem vitrine. */
const remover = db.transaction((imagem) => {
  db.prepare('DELETE FROM imagens WHERE id = ?').run(imagem.id);
  if (!imagem.principal || !imagem.item_id) return;

  const proxima = db.prepare('SELECT id FROM imagens WHERE item_id = ? ORDER BY id LIMIT 1').get(imagem.item_id);
  if (proxima) db.prepare('UPDATE imagens SET principal = 1 WHERE id = ?').run(proxima.id);
});

router.delete('/:imagemId', (req, res) => {
  // o arquivo em disco fica: ele e deduplicado por hash e pode estar em uso por outra peca
  const imagem = db.prepare('SELECT * FROM imagens WHERE id = ? AND catalogo_id = ?')
    .get(req.params.imagemId, req.params.catalogoId);
  if (!imagem) return res.status(404).json({ erro: 'Imagem nao encontrada.' });

  remover(imagem);
  res.status(204).end();
});

module.exports = router;
