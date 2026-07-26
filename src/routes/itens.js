'use strict';

const express = require('express');
const db = require('../db');
const { normalizarCodigo } = require('../services/importService');
const {
  historicoDoItem, custosVigentes, registrarCusto, ultimaTabelaPorFornecedor,
} = require('../services/custoService');
const { chaveDe } = require('../services/aplicacoes');

const router = express.Router({ mergeParams: true });

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 500;

/** Campos do item que a tela de edicao pode alterar. */
const CAMPOS_EDITAVEIS = {
  codigo: 'texto', descricao: 'texto', marca: 'texto', unidade: 'texto', ncm: 'texto',
  observacao: 'texto', quantidade: 'numero', preco_venda: 'numero', margem_alvo: 'numero',
  revisado: 'booleano',
};

function converter(valor, tipo) {
  if (valor === null || valor === '') return null;
  if (tipo === 'numero') {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : null;
  }
  if (tipo === 'booleano') return valor ? 1 : 0;
  return String(valor).trim() || null;
}

/** Texto de vitrine: "VOLKSWAGEN | Bucha traseira | FOX 1.6 COMFORTLINE 2015-2017". */
function descricaoCompleta(item) {
  const veiculo = item.aplicacoes[0];
  const partes = [veiculo?.montadora, item.descricao];

  if (veiculo) {
    const anos = veiculo.ano_inicio
      ? `${veiculo.ano_inicio}${veiculo.ano_fim ? `-${veiculo.ano_fim}` : '+'}`
      : null;
    partes.push([veiculo.modelo, veiculo.motor, veiculo.versao, anos].filter(Boolean).join(' '));
  }

  return partes.filter(Boolean).join(' | ');
}

function montarItens(itens) {
  if (!itens.length) return [];
  const ids = itens.map((i) => i.id);
  const marcadores = ids.map(() => '?').join(',');

  const aplicacoes = db
    .prepare(`SELECT * FROM item_aplicacoes WHERE item_id IN (${marcadores}) ORDER BY montadora, modelo, ano_inicio`)
    .all(...ids);
  const imagens = db
    .prepare(`SELECT id, item_id, caminho, largura, altura, principal FROM imagens
               WHERE item_id IN (${marcadores}) ORDER BY principal DESC, id`)
    .all(...ids);
  const codigos = db
    .prepare(`SELECT id, item_id, tipo, codigo, fabricante FROM item_codigos WHERE item_id IN (${marcadores}) ORDER BY tipo, codigo`)
    .all(...ids);
  const custos = db
    .prepare(`
      SELECT c.id, c.item_id, c.custo, c.qtd_min, c.qtd_max, c.moeda, c.vigencia_inicio,
             c.confirmado_em, c.variacao_percentual, f.id AS fornecedor_id, f.nome AS fornecedor
        FROM item_custos c JOIN fornecedores f ON f.id = c.fornecedor_id
       WHERE c.item_id IN (${marcadores}) AND c.vigencia_fim IS NULL
       ORDER BY f.nome, c.qtd_min`)
    .all(...ids);

  // um preco esta desatualizado quando aquela fabrica ja mandou tabela mais nova sem ele
  const ultimaTabela = ultimaTabelaPorFornecedor(itens[0].catalogo_id);
  const desatualizado = (custo) => {
    const tabela = ultimaTabela.get(custo.fornecedor_id);
    const confirmado = custo.confirmado_em || custo.vigencia_inicio;
    return Boolean(tabela && confirmado && tabela > confirmado);
  };

  const porItem = new Map(itens.map((i) => [i.id, {
    ...i,
    dados_extra: i.dados_extra ? JSON.parse(i.dados_extra) : null,
    codigos: [], aplicacoes: [], imagens: [], custos: [],
  }]));

  for (const c of codigos) porItem.get(c.item_id).codigos.push(c);
  for (const a of aplicacoes) porItem.get(a.item_id).aplicacoes.push(a);
  for (const m of imagens) porItem.get(m.item_id).imagens.push({ ...m, url: `/media/${m.caminho}` });
  for (const c of custos) {
    porItem.get(c.item_id).custos.push({ ...c, desatualizado: desatualizado(c) });
  }

  return [...porItem.values()].map((item) => {
    const custo = item.melhor_custo;
    const anterior = item.melhor_custo_anterior;
    const venda = item.preco_venda;

    // a variacao da peca e a do melhor custo: o que ele efetivamente pagaria.
    // Se uma fabrica subiu mas outra segue mais barata, para ele nao mudou nada.
    const variacao = custo != null && anterior
      ? Number((((custo - anterior) / anterior) * 100).toFixed(2))
      : null;

    // o aviso segue o preco que a lista mostra na coluna Custo — que é o custo base
    // quando existe, não o melhor custo
    const exibido = item.custo_base ?? custo;
    const sustenta = item.custos.find((c) => c.custo === exibido);

    return {
      ...item,
      descricao_completa: descricaoCompleta(item),
      margem_percentual: custo != null && venda ? Number((((venda - custo) / venda) * 100).toFixed(2)) : null,
      variacao_custo: variacao,
      preco_desatualizado: Boolean(sustenta?.desatualizado),
    };
  });
}

function exigirItem(req, res, next) {
  const item = db
    .prepare('SELECT id FROM itens WHERE id = ? AND catalogo_id = ?')
    .get(req.params.itemId, req.params.catalogoId);
  if (!item) return res.status(404).json({ erro: 'Item nao encontrado.' });
  next();
}

// ---------------------------------------------------------------- listagem

router.get('/', (req, res) => {
  const { catalogoId } = req.params;
  const busca = String(req.query.busca ?? '').trim();
  const limite = Math.min(Number(req.query.limite) || LIMITE_PADRAO, LIMITE_MAXIMO);
  const pagina = Math.max(Number(req.query.pagina) || 1, 1);

  const condicoes = ['i.catalogo_id = ?'];
  const params = [catalogoId];

  if (busca) {
    condicoes.push(`(
      i.codigo LIKE ? OR i.descricao LIKE ?
      OR EXISTS (SELECT 1 FROM item_codigos ic WHERE ic.item_id = i.id AND ic.codigo_norm LIKE ?)
      OR EXISTS (SELECT 1 FROM item_aplicacoes ia WHERE ia.item_id = i.id
                   AND (ia.modelo LIKE ? OR ia.montadora LIKE ? OR ia.texto_livre LIKE ?))
    )`);
    const curinga = `%${busca}%`;
    params.push(curinga, curinga, `%${normalizarCodigo(busca) ?? ''}%`, curinga, curinga, curinga);
  }

  if (req.query.montadora) {
    condicoes.push('EXISTS (SELECT 1 FROM item_aplicacoes ia WHERE ia.item_id = i.id AND ia.montadora = ?)');
    params.push(req.query.montadora);
  }

  if (req.query.fornecedor_id) {
    condicoes.push(`EXISTS (SELECT 1 FROM item_custos c
                             WHERE c.item_id = i.id AND c.fornecedor_id = ? AND c.vigencia_fim IS NULL)`);
    params.push(req.query.fornecedor_id);
  }

  if (req.query.sem_custo === '1') condicoes.push('i.melhor_custo IS NULL');

  // "so o que mudou": peças cujo melhor custo é diferente do que valia antes
  if (req.query.variou === '1') {
    condicoes.push('i.melhor_custo_anterior IS NOT NULL AND i.melhor_custo <> i.melhor_custo_anterior');
  }

  const where = `WHERE ${condicoes.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM vw_itens_custo i ${where}`).get(...params).n;
  const itens = db
    .prepare(`SELECT i.* FROM vw_itens_custo i ${where}
              ORDER BY i.codigo IS NULL, i.codigo, i.id LIMIT ? OFFSET ?`)
    .all(...params, limite, (pagina - 1) * limite);

  res.json({ total, pagina, limite, itens: montarItens(itens) });
});

/** Montadoras presentes no catalogo, para alimentar o filtro da tela. */
router.get('/-/montadoras', (req, res) => {
  res.json(db.prepare(`
    SELECT ia.montadora AS nome, COUNT(DISTINCT ia.item_id) AS itens
      FROM item_aplicacoes ia JOIN itens i ON i.id = ia.item_id
     WHERE i.catalogo_id = ? AND ia.montadora IS NOT NULL
     GROUP BY ia.montadora ORDER BY ia.montadora`).all(req.params.catalogoId));
});

router.get('/:itemId', (req, res) => {
  const item = db
    .prepare('SELECT * FROM vw_itens_custo WHERE id = ? AND catalogo_id = ?')
    .get(req.params.itemId, req.params.catalogoId);
  if (!item) return res.status(404).json({ erro: 'Item nao encontrado.' });

  res.json({
    ...montarItens([item])[0],
    historico_custo: historicoDoItem(item.id),
    custos_vigentes: custosVigentes(item.id),
  });
});

// ---------------------------------------------------------------- criacao

/**
 * Registra o codigo principal tambem no DE-PARA, como faz o import: e por essa
 * tabela que a busca por codigo com separadores encontra a peca.
 */
function registrarCodigoPrincipal(itemId, codigo, marca) {
  const norm = normalizarCodigo(codigo);
  if (!norm) return;
  db.prepare(`INSERT OR IGNORE INTO item_codigos (item_id, tipo, codigo, codigo_norm, fabricante)
              VALUES (?, 'para', ?, ?, ?)`).run(itemId, String(codigo).trim(), norm, marca ?? null);
}

const criar = db.transaction((catalogoId, dados, aplicacao) => {
  const { lastInsertRowid: itemId } = db.prepare(`
    INSERT INTO itens (catalogo_id, codigo, codigo_norm, descricao, marca, unidade, ncm,
                       quantidade, preco_venda, observacao, origem)
    VALUES (@catalogo_id, @codigo, @codigo_norm, @descricao, @marca, @unidade, @ncm,
            @quantidade, @preco_venda, @observacao, 'manual')`).run({
    catalogo_id: Number(catalogoId),
    codigo: dados.codigo ?? null,
    codigo_norm: normalizarCodigo(dados.codigo),
    descricao: dados.descricao ?? null,
    marca: dados.marca ?? null,
    unidade: dados.unidade ?? null,
    ncm: dados.ncm ?? null,
    quantidade: dados.quantidade ?? null,
    preco_venda: dados.preco_venda ?? null,
    observacao: dados.observacao ?? null,
  });

  registrarCodigoPrincipal(itemId, dados.codigo, dados.marca);

  if (aplicacao) {
    db.prepare(`INSERT OR IGNORE INTO item_aplicacoes
                  (item_id, montadora, modelo, motor, versao, ano_inicio, ano_fim, texto_livre, chave)
                VALUES (@item_id, @montadora, @modelo, @motor, @versao, @ano_inicio, @ano_fim,
                        @texto_livre, @chave)`).run({ ...aplicacao, item_id: itemId });
  }

  return itemId;
});

router.post('/', (req, res) => {
  const dados = {};
  for (const [campo, tipo] of Object.entries(CAMPOS_EDITAVEIS)) {
    if (campo in req.body) dados[campo] = converter(req.body[campo], tipo);
  }

  if (!dados.codigo && !dados.descricao) {
    return res.status(400).json({ erro: 'Informe ao menos o código ou a descrição da peça.' });
  }

  // o codigo e unico dentro do catalogo: avisar antes e melhor do que estourar a constraint
  const norm = normalizarCodigo(dados.codigo);
  if (norm) {
    const existente = db.prepare('SELECT id, descricao FROM itens WHERE catalogo_id = ? AND codigo_norm = ?')
      .get(req.params.catalogoId, norm);
    if (existente) {
      return res.status(409).json({
        erro: `Já existe uma peça com o código ${dados.codigo} neste catálogo.`,
        item_id: existente.id,
      });
    }
  }

  const aplicacao = req.body.aplicacao && Object.values(req.body.aplicacao).some(Boolean)
    ? normalizarAplicacao(req.body.aplicacao)
    : null;

  const itemId = criar(req.params.catalogoId, dados, aplicacao?.chave.replace(/\|/g, '') ? aplicacao : null);
  const item = db.prepare('SELECT * FROM vw_itens_custo WHERE id = ?').get(itemId);
  res.status(201).json(montarItens([item])[0]);
});

// ---------------------------------------------------------------- edicao

router.patch('/:itemId', exigirItem, (req, res) => {
  const alteracoes = {};
  for (const [campo, tipo] of Object.entries(CAMPOS_EDITAVEIS)) {
    if (campo in req.body) alteracoes[campo] = converter(req.body[campo], tipo);
  }
  if (!Object.keys(alteracoes).length) return res.status(400).json({ erro: 'Nada para alterar.' });

  if ('codigo' in alteracoes) alteracoes.codigo_norm = normalizarCodigo(alteracoes.codigo);

  const sets = Object.keys(alteracoes).map((c) => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE itens SET ${sets}, atualizado_em = datetime('now') WHERE id = @id`)
    .run({ ...alteracoes, id: Number(req.params.itemId) });

  // trocar o codigo principal sem levar o DE-PARA junto deixaria a peca fora da busca por codigo
  if (alteracoes.codigo) registrarCodigoPrincipal(req.params.itemId, alteracoes.codigo, alteracoes.marca);

  const item = db.prepare('SELECT * FROM vw_itens_custo WHERE id = ?').get(req.params.itemId);
  res.json(montarItens([item])[0]);
});

router.delete('/:itemId', exigirItem, (req, res) => {
  db.prepare('DELETE FROM itens WHERE id = ?').run(req.params.itemId);
  res.status(204).end();
});

// ---------------------------------------------------------------- codigos (DE-PARA)

router.post('/:itemId/codigos', exigirItem, (req, res) => {
  const codigo = String(req.body?.codigo ?? '').trim();
  const tipo = ['de', 'para', 'similar'].includes(req.body?.tipo) ? req.body.tipo : 'de';
  const norm = normalizarCodigo(codigo);
  if (!norm) return res.status(400).json({ erro: 'Codigo invalido.' });

  db.prepare(`INSERT OR IGNORE INTO item_codigos (item_id, tipo, codigo, codigo_norm, fabricante)
              VALUES (?, ?, ?, ?, ?)`)
    .run(req.params.itemId, tipo, codigo, norm, req.body.fabricante ?? null);

  res.status(201).json(db.prepare('SELECT * FROM item_codigos WHERE item_id = ? ORDER BY tipo, codigo')
    .all(req.params.itemId));
});

router.delete('/:itemId/codigos/:codigoId', exigirItem, (req, res) => {
  const info = db.prepare('DELETE FROM item_codigos WHERE id = ? AND item_id = ?')
    .run(req.params.codigoId, req.params.itemId);
  if (!info.changes) return res.status(404).json({ erro: 'Codigo nao encontrado.' });
  res.status(204).end();
});

// ---------------------------------------------------------------- aplicacoes

function normalizarAplicacao(corpo) {
  const texto = (valor) => (valor ? String(valor).trim().toUpperCase() : null);
  const inteiro = (valor) => (Number(valor) ? Math.trunc(Number(valor)) : null);

  const aplicacao = {
    montadora: texto(corpo.montadora),
    modelo: texto(corpo.modelo),
    motor: texto(corpo.motor),
    versao: texto(corpo.versao),
    ano_inicio: inteiro(corpo.ano_inicio),
    ano_fim: inteiro(corpo.ano_fim),
  };
  aplicacao.texto_livre = [aplicacao.montadora, aplicacao.modelo, aplicacao.motor, aplicacao.versao,
    aplicacao.ano_inicio, aplicacao.ano_fim].filter(Boolean).join(' ');
  aplicacao.chave = chaveDe(aplicacao);
  return aplicacao;
}

router.post('/:itemId/aplicacoes', exigirItem, (req, res) => {
  const aplicacao = normalizarAplicacao(req.body ?? {});
  if (!aplicacao.chave.replace(/\|/g, '')) {
    return res.status(400).json({ erro: 'Informe ao menos modelo ou montadora.' });
  }

  db.prepare(`INSERT OR IGNORE INTO item_aplicacoes
                (item_id, montadora, modelo, motor, versao, ano_inicio, ano_fim, texto_livre, chave)
              VALUES (@item_id, @montadora, @modelo, @motor, @versao, @ano_inicio, @ano_fim, @texto_livre, @chave)`)
    .run({ ...aplicacao, item_id: Number(req.params.itemId) });

  res.status(201).json(db.prepare('SELECT * FROM item_aplicacoes WHERE item_id = ?').all(req.params.itemId));
});

router.patch('/:itemId/aplicacoes/:aplicacaoId', exigirItem, (req, res) => {
  const atual = db.prepare('SELECT * FROM item_aplicacoes WHERE id = ? AND item_id = ?')
    .get(req.params.aplicacaoId, req.params.itemId);
  if (!atual) return res.status(404).json({ erro: 'Aplicacao nao encontrada.' });

  const aplicacao = normalizarAplicacao({ ...atual, ...req.body });
  db.prepare(`UPDATE item_aplicacoes
                 SET montadora = @montadora, modelo = @modelo, motor = @motor, versao = @versao,
                     ano_inicio = @ano_inicio, ano_fim = @ano_fim, texto_livre = @texto_livre, chave = @chave
               WHERE id = @id`)
    .run({ ...aplicacao, id: Number(req.params.aplicacaoId) });

  res.json(db.prepare('SELECT * FROM item_aplicacoes WHERE item_id = ?').all(req.params.itemId));
});

router.delete('/:itemId/aplicacoes/:aplicacaoId', exigirItem, (req, res) => {
  const info = db.prepare('DELETE FROM item_aplicacoes WHERE id = ? AND item_id = ?')
    .run(req.params.aplicacaoId, req.params.itemId);
  if (!info.changes) return res.status(404).json({ erro: 'Aplicacao nao encontrada.' });
  res.status(204).end();
});

// ---------------------------------------------------------------- custos (faixas de volume)

router.post('/:itemId/custos', exigirItem, (req, res) => {
  const custo = Number(req.body?.custo);
  const fornecedorId = Number(req.body?.fornecedor_id);
  if (!Number.isFinite(custo) || custo < 0) return res.status(400).json({ erro: 'Custo invalido.' });
  if (!fornecedorId) return res.status(400).json({ erro: 'Informe o fornecedor.' });

  const situacao = registrarCusto({
    item_id: Number(req.params.itemId),
    fornecedor_id: fornecedorId,
    custo,
    qtd_min: req.body.qtd_min,
    qtd_max: req.body.qtd_max ? Number(req.body.qtd_max) : null,
    vigencia_inicio: req.body.vigencia_inicio,
    observacao: req.body.observacao ?? 'lancado manualmente',
  });

  res.status(201).json({ situacao, custos_vigentes: custosVigentes(req.params.itemId) });
});

module.exports = router;
