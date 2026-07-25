'use strict';

const express = require('express');
const fornecedorService = require('../services/fornecedorService');

const router = express.Router();

router.get('/', (req, res) => res.json(fornecedorService.listar()));

router.post('/', (req, res) => {
  const nome = String(req.body?.nome ?? '').trim();
  if (!nome) return res.status(400).json({ erro: 'O campo "nome" e obrigatorio.' });

  const fornecedor = fornecedorService.obterOuCriar(nome, {
    cnpj: req.body.cnpj,
    contato: req.body.contato,
    prazo_dias: req.body.prazo_dias,
    observacao: req.body.observacao,
  });
  res.status(201).json(fornecedor);
});

module.exports = router;
