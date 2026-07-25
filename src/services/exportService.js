'use strict';

const db = require('../db');

/**
 * Monta o conteudo do catalogo de apresentacao: as pecas ja consolidadas, com foto
 * principal, aplicacao, equivalencias e preco, agrupadas para virar secoes do documento.
 */

const SEM_GRUPO = 'Outras aplicações';

function montarFiltro(catalogoId, filtros = {}) {
  const condicoes = ['i.catalogo_id = ?'];
  const params = [catalogoId];

  if (filtros.montadora) {
    condicoes.push('EXISTS (SELECT 1 FROM item_aplicacoes ia WHERE ia.item_id = i.id AND ia.montadora = ?)');
    params.push(filtros.montadora);
  }

  if (filtros.fornecedor_id) {
    condicoes.push(`EXISTS (SELECT 1 FROM item_custos c
                             WHERE c.item_id = i.id AND c.fornecedor_id = ? AND c.vigencia_fim IS NULL)`);
    params.push(filtros.fornecedor_id);
  }

  if (filtros.apenas_com_foto === true) {
    condicoes.push('EXISTS (SELECT 1 FROM imagens m WHERE m.item_id = i.id)');
  }

  return { where: `WHERE ${condicoes.join(' AND ')}`, params };
}

function carregarItens(catalogoId, filtros) {
  const { where, params } = montarFiltro(catalogoId, filtros);
  const itens = db.prepare(`SELECT i.* FROM vw_itens_custo i ${where} ORDER BY i.codigo`).all(...params);
  if (!itens.length) return [];

  const ids = itens.map((i) => i.id);
  const marcadores = ids.map(() => '?').join(',');

  const aplicacoes = db.prepare(`
    SELECT * FROM item_aplicacoes WHERE item_id IN (${marcadores})
     ORDER BY montadora, modelo, ano_inicio`).all(...ids);
  const codigos = db.prepare(`
    SELECT item_id, tipo, codigo FROM item_codigos WHERE item_id IN (${marcadores}) ORDER BY codigo`).all(...ids);
  const imagens = db.prepare(`
    SELECT item_id, caminho, principal FROM imagens WHERE item_id IN (${marcadores})
     ORDER BY principal DESC, id`).all(...ids);
  const custos = db.prepare(`
    SELECT c.item_id, c.custo, c.qtd_min, c.qtd_max, f.nome AS fornecedor
      FROM item_custos c JOIN fornecedores f ON f.id = c.fornecedor_id
     WHERE c.item_id IN (${marcadores}) AND c.vigencia_fim IS NULL
     ORDER BY c.qtd_min`).all(...ids);

  const porItem = new Map(itens.map((i) => [i.id, {
    ...i, aplicacoes: [], equivalencias: [], imagens: [], custos: [],
  }]));

  for (const a of aplicacoes) porItem.get(a.item_id).aplicacoes.push(a);
  for (const c of codigos) if (c.tipo !== 'para') porItem.get(c.item_id).equivalencias.push(c.codigo);
  for (const m of imagens) porItem.get(m.item_id).imagens.push(m);
  for (const c of custos) porItem.get(c.item_id).custos.push(c);

  return [...porItem.values()];
}

/** Agrupa por montadora: uma peca que serve varias montadoras aparece em cada secao. */
function agrupar(itens, criterio) {
  if (criterio !== 'montadora') return [{ titulo: null, itens }];

  const grupos = new Map();
  for (const item of itens) {
    const montadoras = [...new Set(item.aplicacoes.map((a) => a.montadora).filter(Boolean))];
    for (const montadora of montadoras.length ? montadoras : [SEM_GRUPO]) {
      if (!grupos.has(montadora)) grupos.set(montadora, []);
      grupos.get(montadora).push(item);
    }
  }

  return [...grupos.entries()]
    .sort(([a], [b]) => (a === SEM_GRUPO ? 1 : b === SEM_GRUPO ? -1 : a.localeCompare(b)))
    .map(([titulo, itensDoGrupo]) => ({ titulo, itens: itensDoGrupo }));
}

function descreverAplicacao(aplicacao) {
  const anos = aplicacao.ano_inicio
    ? `${aplicacao.ano_inicio}${aplicacao.ano_fim ? `/${aplicacao.ano_fim}` : ' em diante'}`
    : null;
  return [aplicacao.montadora, aplicacao.modelo, aplicacao.motor, aplicacao.versao, anos]
    .filter(Boolean).join(' ');
}

/**
 * @param {object} opcoes
 *   agrupar: 'montadora' | 'nenhum'
 *   preco: 'nenhum' | 'venda' | 'interno'  (interno mostra custo, fornecedor e margem)
 */
function montarCatalogo(catalogoId, opcoes = {}) {
  const catalogo = db.prepare('SELECT * FROM catalogos WHERE id = ?').get(catalogoId);
  if (!catalogo) return null;

  const itens = carregarItens(catalogoId, opcoes);
  const fornecedores = [...new Set(itens.flatMap((i) => i.custos.map((c) => c.fornecedor)))].sort();

  return {
    catalogo,
    opcoes: {
      agrupar: opcoes.agrupar === 'nenhum' ? 'nenhum' : 'montadora',
      preco: ['nenhum', 'venda', 'interno'].includes(opcoes.preco) ? opcoes.preco : 'venda',
      titulo: opcoes.titulo || catalogo.nome,
      subtitulo: opcoes.subtitulo || null,
    },
    grupos: agrupar(itens, opcoes.agrupar === 'nenhum' ? 'nenhum' : 'montadora'),
    resumo: {
      total_pecas: itens.length,
      com_foto: itens.filter((i) => i.imagens.length).length,
      sem_preco_venda: itens.filter((i) => i.preco_venda == null).length,
      fornecedores,
      gerado_em: new Date().toISOString(),
    },
  };
}

/**
 * Precificacao em massa: preco de venda = custo x (1 + margem%).
 * `base` escolhe de qual custo partir: 'custo_base' (comprando pouco) ou 'melhor_custo' (volume).
 * Nao mexe em item ja precificado, a menos que sobrescrever seja true.
 */
function precificar(catalogoId, { margem, base = 'custo_base', sobrescrever = false, arredondar = true }) {
  const percentual = Number(margem);
  if (!Number.isFinite(percentual) || percentual <= -100) throw new Error('Margem invalida.');

  const coluna = base === 'melhor_custo' ? 'melhor_custo' : 'custo_base';
  const itens = db.prepare(`
    SELECT id, ${coluna} AS custo, preco_venda FROM vw_itens_custo
     WHERE catalogo_id = ? AND ${coluna} IS NOT NULL`).all(catalogoId);

  const atualizar = db.prepare("UPDATE itens SET preco_venda = ?, atualizado_em = datetime('now') WHERE id = ?");

  const aplicar = db.transaction(() => {
    let alterados = 0;
    for (const item of itens) {
      if (item.preco_venda != null && !sobrescrever) continue;

      const bruto = item.custo * (1 + percentual / 100);
      // preco de vitrine termina em ,90 — evita numero quebrado no catalogo
      const preco = arredondar ? Math.max(Math.ceil(bruto) - 0.1, 0.9) : Number(bruto.toFixed(2));
      atualizar.run(preco, item.id);
      alterados++;
    }
    return alterados;
  });

  return { itens_com_custo: itens.length, precificados: aplicar() };
}

module.exports = { montarCatalogo, precificar, descreverAplicacao };
