'use strict';

const express = require('express');
const { montarCatalogo, precificar } = require('../services/exportService');
const { gerarCatalogoHtml } = require('../exports/catalogoHtml');
const { gerarCatalogoXlsx } = require('../exports/catalogoXlsx');

const router = express.Router({ mergeParams: true });

function lerOpcoes(query) {
  return {
    agrupar: query.agrupar,
    preco: query.preco,
    titulo: query.titulo,
    subtitulo: query.subtitulo,
    montadora: query.montadora,
    fornecedor_id: query.fornecedor_id,
    apenas_com_foto: query.apenas_com_foto === '1',
  };
}

/** Nome de arquivo seguro, sem acento nem caractere que atrapalhe o download. */
function nomeArquivo(titulo, extensao) {
  const base = String(titulo || 'catalogo')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'catalogo';
  return `${base}-${new Date().toISOString().slice(0, 10)}.${extensao}`;
}

router.get('/previa', (req, res) => {
  const dados = montarCatalogo(req.params.catalogoId, lerOpcoes(req.query));
  if (!dados) return res.status(404).json({ erro: 'Catalogo nao encontrado.' });
  res.json({ ...dados.resumo, opcoes: dados.opcoes, grupos: dados.grupos.map((g) => ({ titulo: g.titulo, pecas: g.itens.length })) });
});

router.get('/html', (req, res) => {
  const dados = montarCatalogo(req.params.catalogoId, lerOpcoes(req.query));
  if (!dados) return res.status(404).json({ erro: 'Catalogo nao encontrado.' });

  const html = gerarCatalogoHtml(dados);
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo(dados.opcoes.titulo, 'html')}"`);
  }
  res.type('html').send(html);
});

router.get('/xlsx', async (req, res, next) => {
  try {
    const dados = montarCatalogo(req.params.catalogoId, lerOpcoes(req.query));
    if (!dados) return res.status(404).json({ erro: 'Catalogo nao encontrado.' });

    const buffer = await gerarCatalogoXlsx(dados);
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo(dados.opcoes.titulo, 'xlsx')}"`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buffer));
  } catch (erro) {
    next(erro);
  }
});

/** Precificacao em massa: aplica a margem sobre o custo e preenche o preco de venda. */
router.post('/precificar', (req, res) => {
  try {
    const resultado = precificar(req.params.catalogoId, {
      margem: req.body?.margem,
      base: req.body?.base,
      sobrescrever: Boolean(req.body?.sobrescrever),
    });
    res.json(resultado);
  } catch (erro) {
    res.status(400).json({ erro: erro.message });
  }
});

module.exports = router;
