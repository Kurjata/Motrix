'use strict';

const db = require('../db');

const normalizarNome = (nome) =>
  String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\b(LTDA|S\.?A\.?|ME|EIRELI|EPP|IND(USTRIA)?|COM(ERCIO)?)\b/g, '')
    .replace(/[^A-Z0-9]/g, '');

const stmt = {
  porNorm: db.prepare('SELECT * FROM fornecedores WHERE nome_norm = ?'),
  inserir: db.prepare('INSERT INTO fornecedores (nome, nome_norm, cnpj, contato, prazo_dias, observacao) VALUES (?, ?, ?, ?, ?, ?)'),
  porId: db.prepare('SELECT * FROM fornecedores WHERE id = ?'),
  listar: db.prepare(`
    SELECT f.*,
           (SELECT COUNT(DISTINCT c.item_id) FROM item_custos c
             WHERE c.fornecedor_id = f.id AND c.vigencia_fim IS NULL) AS itens_cotados
      FROM fornecedores f ORDER BY f.nome`),
};

/** Busca pelo nome normalizado (ignora acento, caixa e sufixos societarios) ou cria. */
function obterOuCriar(nome, extras = {}) {
  const limpo = String(nome ?? '').replace(/\s+/g, ' ').trim();
  if (!limpo) return null;

  const norm = normalizarNome(limpo);
  if (!norm) return null;

  const existente = stmt.porNorm.get(norm);
  if (existente) return existente;

  const { lastInsertRowid } = stmt.inserir.run(
    limpo, norm, extras.cnpj ?? null, extras.contato ?? null, extras.prazo_dias ?? null, extras.observacao ?? null,
  );
  return stmt.porId.get(lastInsertRowid);
}

module.exports = { obterOuCriar, listar: () => stmt.listar.all(), porId: (id) => stmt.porId.get(id), normalizarNome };
