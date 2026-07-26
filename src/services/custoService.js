'use strict';

const db = require('../db');

/**
 * Historico de custo append-only: um registro por vigencia.
 * `vigencia_fim IS NULL` marca o custo vigente daquele fornecedor para aquela peca.
 */
const stmt = {
  vigente: db.prepare(`
    SELECT * FROM item_custos
     WHERE item_id = ? AND fornecedor_id = ? AND qtd_min = ? AND vigencia_fim IS NULL`),
  fecharVigencia: db.prepare('UPDATE item_custos SET vigencia_fim = ? WHERE id = ?'),
  inserir: db.prepare(`
    INSERT INTO item_custos (item_id, fornecedor_id, custo, qtd_min, qtd_max, moeda, codigo_fornecedor,
                             prazo_dias, lote_minimo, vigencia_inicio, vigencia_fim, confirmado_em,
                             variacao_percentual, arquivo_id, observacao)
    VALUES (@item_id, @fornecedor_id, @custo, @qtd_min, @qtd_max, @moeda, @codigo_fornecedor,
            @prazo_dias, @lote_minimo, @vigencia_inicio, @vigencia_fim, @confirmado_em,
            @variacao_percentual, @arquivo_id, @observacao)`),
  confirmar: db.prepare(`
    UPDATE item_custos SET confirmado_em = ?
     WHERE id = ? AND (confirmado_em IS NULL OR confirmado_em < ?)`),
  ultimaTabela: db.prepare(`
    SELECT fornecedor_id, MAX(COALESCE(vigencia, date(criado_em))) AS ultima_tabela
      FROM arquivos
     WHERE catalogo_id = ? AND fornecedor_id IS NOT NULL AND status = 'processado'
     GROUP BY fornecedor_id`),
  historico: db.prepare(`
    SELECT c.*, f.nome AS fornecedor
      FROM item_custos c JOIN fornecedores f ON f.id = c.fornecedor_id
     WHERE c.item_id = ?
     ORDER BY c.vigencia_inicio DESC, c.qtd_min ASC, c.id DESC`),
  vigentes: db.prepare(`
    SELECT c.*, f.nome AS fornecedor
      FROM item_custos c JOIN fornecedores f ON f.id = c.fornecedor_id
     WHERE c.item_id = ? AND c.vigencia_fim IS NULL
     ORDER BY f.nome ASC, c.qtd_min ASC`),
};

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

function variacao(anterior, novo) {
  if (!anterior) return null;
  return Number((((novo - anterior) / anterior) * 100).toFixed(4));
}

/**
 * Registra o custo de uma peca em um fornecedor numa data-base, para uma faixa de volume.
 * Cada faixa (1+, 100+, 200+) tem vigencia e historico proprios.
 * - primeiro custo            -> 'novo'
 * - mesmo valor do vigente    -> 'inalterado' (nao polui o historico)
 * - valor diferente           -> 'reajuste' (fecha a vigencia anterior e abre a nova)
 * - data anterior a vigente   -> 'retroativo' (entra fechado, sem mexer no atual)
 */
function registrarCusto(dados) {
  const data = dados.vigencia_inicio || hoje();
  const qtdMin = Number(dados.qtd_min) > 0 ? Math.trunc(dados.qtd_min) : 1;
  const base = {
    item_id: dados.item_id,
    fornecedor_id: dados.fornecedor_id,
    custo: dados.custo,
    qtd_min: qtdMin,
    qtd_max: dados.qtd_max ?? null,
    moeda: dados.moeda || 'BRL',
    codigo_fornecedor: dados.codigo_fornecedor ?? null,
    prazo_dias: dados.prazo_dias ?? null,
    lote_minimo: dados.lote_minimo ?? null,
    vigencia_inicio: data,
    vigencia_fim: null,
    confirmado_em: data,
    variacao_percentual: null,
    arquivo_id: dados.arquivo_id ?? null,
    observacao: dados.observacao ?? null,
  };

  const vigente = stmt.vigente.get(dados.item_id, dados.fornecedor_id, qtdMin);
  if (!vigente) {
    stmt.inserir.run(base);
    return 'novo';
  }

  if (Number(vigente.custo) === Number(dados.custo)) {
    // preco igual nao abre vigencia nova, mas foi visto de novo: registrar a confirmacao,
    // senao ele passaria a parecer desatualizado sem estar
    stmt.confirmar.run(data, vigente.id, data);
    return 'inalterado';
  }

  if (data <= vigente.vigencia_inicio) {
    stmt.inserir.run({ ...base, vigencia_fim: vigente.vigencia_inicio });
    return 'retroativo';
  }

  stmt.fecharVigencia.run(data, vigente.id);
  stmt.inserir.run({ ...base, variacao_percentual: variacao(vigente.custo, dados.custo) });
  return 'reajuste';
}

const historicoDoItem = (itemId) => stmt.historico.all(itemId);
const custosVigentes = (itemId) => stmt.vigentes.all(itemId);

/**
 * Data-base da tabela mais recente de cada fornecedor no catalogo.
 * Preco confirmado antes dessa data e preco que a fabrica parou de cotar.
 * @returns {Map<number, string>} fornecedor_id -> data
 */
function ultimaTabelaPorFornecedor(catalogoId) {
  return new Map(stmt.ultimaTabela.all(catalogoId).map((l) => [l.fornecedor_id, l.ultima_tabela]));
}

module.exports = { registrarCusto, historicoDoItem, custosVigentes, ultimaTabelaPorFornecedor, hoje };
