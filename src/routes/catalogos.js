'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

const RESUMO = `
  SELECT c.*,
         (SELECT COUNT(*) FROM arquivos a WHERE a.catalogo_id = c.id) AS total_arquivos,
         (SELECT COUNT(*) FROM itens i    WHERE i.catalogo_id = c.id) AS total_itens,
         (SELECT COUNT(*) FROM imagens m  WHERE m.catalogo_id = c.id) AS total_imagens
    FROM catalogos c`;

router.get('/', (req, res) => {
  res.json(db.prepare(`${RESUMO} ORDER BY c.criado_em DESC`).all());
});

router.post('/', (req, res) => {
  const nome = String(req.body?.nome ?? '').trim();
  if (!nome) return res.status(400).json({ erro: 'O campo "nome" e obrigatorio.' });

  const descricao = String(req.body?.descricao ?? '').trim() || null;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO catalogos (nome, descricao) VALUES (?, ?)')
    .run(nome, descricao);

  res.status(201).json(db.prepare(`${RESUMO} WHERE c.id = ?`).get(lastInsertRowid));
});

router.get('/:id', (req, res) => {
  const catalogo = db.prepare(`${RESUMO} WHERE c.id = ?`).get(req.params.id);
  if (!catalogo) return res.status(404).json({ erro: 'Catalogo nao encontrado.' });
  res.json(catalogo);
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM catalogos WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ erro: 'Catalogo nao encontrado.' });
  res.status(204).end();
});

module.exports = router;
