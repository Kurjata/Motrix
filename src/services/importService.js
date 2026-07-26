'use strict';

const db = require('../db');
const { parseArquivo, FormatoNaoSuportadoError } = require('../parsers');
const { salvarImagem } = require('../utils/files');
const { aplicacoesDoItem } = require('./aplicacoes');
const { registrarCusto, hoje } = require('./custoService');
const fornecedorService = require('./fornecedorService');

/** "ABC-123.4 " -> "ABC1234": permite casar o DE-PARA ignorando separadores. */
function normalizarCodigo(codigo) {
  return String(codigo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
}

const stmt = {
  atualizarStatus: db.prepare('UPDATE arquivos SET status = ?, erro = ? WHERE id = ?'),
  finalizar: db.prepare(`
    UPDATE arquivos
       SET status = ?, erro = ?, itens_extraidos = ?, itens_novos = ?, custos_registrados = ?,
           imagens_extraidas = ?, processado_em = datetime('now')
     WHERE id = ?`),
  itemPorCodigo: db.prepare('SELECT * FROM itens WHERE catalogo_id = ? AND codigo_norm = ?'),
  itemPorCodigoDePara: db.prepare(`
    SELECT i.* FROM itens i
      JOIN item_codigos c ON c.item_id = i.id
     WHERE i.catalogo_id = ? AND c.codigo_norm = ?
     LIMIT 1`),
  inserirItem: db.prepare(`
    INSERT INTO itens (catalogo_id, arquivo_id, codigo, codigo_norm, descricao, marca, unidade, ncm,
                       quantidade, preco_venda, observacao, origem, dados_extra)
    VALUES (@catalogo_id, @arquivo_id, @codigo, @codigo_norm, @descricao, @marca, @unidade, @ncm,
            @quantidade, @preco_venda, @observacao, @origem, @dados_extra)`),
  inserirCodigo: db.prepare(`
    INSERT OR IGNORE INTO item_codigos (item_id, tipo, codigo, codigo_norm, fabricante)
    VALUES (?, ?, ?, ?, ?)`),
  inserirAplicacao: db.prepare(`
    INSERT OR IGNORE INTO item_aplicacoes
      (item_id, montadora, modelo, motor, versao, ano_inicio, ano_fim, texto_livre, chave)
    VALUES (@item_id, @montadora, @modelo, @motor, @versao, @ano_inicio, @ano_fim, @texto_livre, @chave)`),
  aplicacaoEquivalente: db.prepare(`
    SELECT * FROM item_aplicacoes
     WHERE item_id = @item_id
       AND IFNULL(montadora, '') = IFNULL(@montadora, '')
       AND IFNULL(modelo, '')    = IFNULL(@modelo, '')
       AND IFNULL(versao, '')    = IFNULL(@versao, '')
       AND IFNULL(ano_inicio, 0) = IFNULL(@ano_inicio, 0)
       AND IFNULL(ano_fim, 0)    = IFNULL(@ano_fim, 0)`),
  detalharAplicacao: db.prepare('UPDATE item_aplicacoes SET motor = ?, texto_livre = ?, chave = ? WHERE id = ?'),
  inserirImagem: db.prepare(`
    INSERT INTO imagens (catalogo_id, arquivo_id, item_id, caminho, hash, largura, altura, ancora, principal)
    VALUES (@catalogo_id, @arquivo_id, @item_id, @caminho, @hash, @largura, @altura, @ancora, @principal)`),
  imagemDuplicada: db.prepare('SELECT id FROM imagens WHERE catalogo_id = ? AND hash = ? AND arquivo_id = ?'),
};

/** Campos do item que so sao gravados quando ainda estao vazios: import nunca apaga curadoria. */
const CAMPOS_COMPLEMENTAVEIS = ['descricao', 'marca', 'unidade', 'ncm', 'quantidade', 'preco_venda', 'observacao'];

function complementarItem(existente, item) {
  const alteracoes = {};
  for (const campo of CAMPOS_COMPLEMENTAVEIS) {
    const valor = item[campo];
    if (valor !== null && valor !== undefined && valor !== '' && (existente[campo] === null || existente[campo] === '')) {
      alteracoes[campo] = valor;
    }
  }
  if (!Object.keys(alteracoes).length) return;

  const sets = Object.keys(alteracoes).map((c) => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE itens SET ${sets}, atualizado_em = datetime('now') WHERE id = @id`)
    .run({ ...alteracoes, id: existente.id });
}

/** Uma celula pode trazer varios codigos: "12345 / 67890; ABC-1". */
function gravarCodigos(itemId, item) {
  const entradas = [
    { tipo: 'para', valor: item.codigo },
    { tipo: 'de', valor: item.codigo_de },
    { tipo: 'similar', valor: item.codigo_similar },
  ];

  for (const { tipo, valor } of entradas) {
    if (!valor) continue;
    for (const parte of String(valor).split(/[;,/\n|]+/)) {
      const codigo = parte.trim();
      const norm = normalizarCodigo(codigo);
      if (!norm) continue;
      stmt.inserirCodigo.run(itemId, tipo, codigo, norm, item.marca ?? null);
    }
  }
}

/**
 * Grava a aplicacao evitando duplicar o mesmo veiculo com granularidade diferente:
 * "CHEVROLET ONIX 1.0 8V 2016-2020" e "CHEVROLET ONIX 2016-2020" sao a mesma linha,
 * e a versao com motor e a que fica.
 */
function gravarAplicacao(itemId, aplicacao) {
  const parametros = {
    item_id: itemId,
    montadora: aplicacao.montadora,
    modelo: aplicacao.modelo,
    versao: aplicacao.versao,
    ano_inicio: aplicacao.ano_inicio,
    ano_fim: aplicacao.ano_fim,
  };

  for (const existente of stmt.aplicacaoEquivalente.all(parametros)) {
    if (existente.motor && !aplicacao.motor) return;                 // ja temos versao mais detalhada
    if (existente.motor === aplicacao.motor) return;                 // identica
    if (!existente.motor && aplicacao.motor) {
      stmt.detalharAplicacao.run(aplicacao.motor, aplicacao.texto_livre, aplicacao.chave, existente.id);
      return;
    }
  }

  stmt.inserirAplicacao.run({ item_id: itemId, ...aplicacao });
}

/**
 * Encontra o item ja existente no catalogo: primeiro pelo codigo principal,
 * depois por qualquer codigo do DE-PARA (a peca pode chegar pelo codigo OEM).
 */
function localizarItem(catalogoId, item) {
  const principal = normalizarCodigo(item.codigo);
  if (principal) {
    const achado = stmt.itemPorCodigo.get(catalogoId, principal);
    if (achado) return achado;
  }

  for (const codigo of [item.codigo, item.codigo_de, item.codigo_fornecedor]) {
    const norm = normalizarCodigo(codigo);
    // exige digito: evita que um texto solto ("CHEVROLET") funda duas pecas diferentes
    if (!norm || !/\d/.test(norm)) continue;
    const achado = stmt.itemPorCodigoDePara.get(catalogoId, norm);
    if (achado) return achado;
  }
  return null;
}

/**
 * Faixas de volume da linha. Tabela de fabrica sempre fala de custo:
 * coluna generica ("Preco", "Valor") entra como custo da faixa base (1+).
 * Coluna explicita de venda ("Preco de Venda") e a unica que vira preco_venda.
 */
function faixasDeCusto(item, descontoPercentual = 0) {
  const faixas = [...(item.faixas || [])];
  const base = item.custo ?? item.preco ?? null;

  if (base !== null && !faixas.some((f) => (f.qtd_min || 1) <= 1)) {
    faixas.unshift({ qtd_min: 1, qtd_max: null, custo: base });
  }

  // a fabrica manda a tabela cheia e o desconto e combinado a parte; guardamos o que
  // ele paga de verdade, e o percentual fica registrado no arquivo e na observacao
  const fator = 1 - (Number(descontoPercentual) || 0) / 100;

  return faixas
    .filter((f) => f.custo !== null && f.custo !== undefined)
    .map((f) => ({
      qtd_min: f.qtd_min || 1,
      qtd_max: f.qtd_max ?? null,
      custo: Number((f.custo * fator).toFixed(4)),
      cheio: f.custo,
    }));
}

const persistir = db.transaction((arquivo, resultado, imagensSalvas) => {
  const totais = { itens: 0, novos: 0, custos: 0, imagens: 0, semFornecedor: 0, ignoradas: 0 };
  const idPorRef = new Map();
  const vigencia = arquivo.vigencia || hoje();

  for (const item of resultado.itens) {
    const faixas = faixasDeCusto(item, arquivo.desconto_percentual);

    // linha sem codigo e sem preco nao e peca: e titulo de secao ("* LANÇAMENTOS"),
    // observacao da fabrica ou sobra de rodape
    if (!item.codigo && !item.codigo_de && !faixas.length) {
      totais.ignoradas++;
      continue;
    }
    const precoVenda = item.preco_venda ?? null;
    const existente = localizarItem(arquivo.catalogo_id, item);

    let itemId;
    if (existente) {
      itemId = existente.id;
      complementarItem(existente, { ...item, preco_venda: precoVenda });
    } else {
      const codigo = item.codigo || item.codigo_de || item.codigo_fornecedor || null;
      const info = stmt.inserirItem.run({
        catalogo_id: arquivo.catalogo_id,
        arquivo_id: arquivo.id,
        codigo,
        codigo_norm: normalizarCodigo(codigo),
        descricao: item.descricao ?? null,
        marca: item.marca ?? null,
        unidade: item.unidade ?? null,
        ncm: item.ncm ?? null,
        quantidade: item.quantidade ?? null,
        preco_venda: precoVenda,
        observacao: item.observacao ?? null,
        origem: item.origem ?? null,
        dados_extra: Object.keys(item.dados_extra || {}).length ? JSON.stringify(item.dados_extra) : null,
      });
      itemId = info.lastInsertRowid;
      totais.novos++;
    }

    totais.itens++;
    if (item.ref) idPorRef.set(item.ref, itemId);

    gravarCodigos(itemId, item);

    for (const aplicacao of aplicacoesDoItem(item)) gravarAplicacao(itemId, aplicacao);

    if (faixas.length) {
      // o fornecedor da linha vence o do arquivo: planilhas consolidadas trazem varias fabricas
      const fornecedor = item.fornecedor
        ? fornecedorService.obterOuCriar(item.fornecedor)
        : arquivo.fornecedor_id
          ? { id: arquivo.fornecedor_id }
          : null;

      if (!fornecedor) {
        totais.semFornecedor++;
      } else {
        for (const faixa of faixas) {
          const situacao = registrarCusto({
            item_id: itemId,
            fornecedor_id: fornecedor.id,
            custo: faixa.custo,
            qtd_min: faixa.qtd_min,
            qtd_max: faixa.qtd_max,
            codigo_fornecedor: item.codigo_fornecedor ?? null,
            prazo_dias: item.prazo_dias ?? null,
            lote_minimo: item.lote_minimo ?? null,
            vigencia_inicio: vigencia,
            arquivo_id: arquivo.id,
            observacao: arquivo.desconto_percentual
              ? `tabela ${faixa.cheio} com ${arquivo.desconto_percentual}% de desconto`
              : null,
          });
          if (situacao !== 'inalterado') totais.custos++;
        }
      }
    }
  }

  const comPrincipal = new Set();
  for (const imagem of imagensSalvas) {
    if (stmt.imagemDuplicada.get(arquivo.catalogo_id, imagem.hash, arquivo.id)) continue;
    const itemId = imagem.ref ? idPorRef.get(imagem.ref) ?? null : null;

    // so a primeira foto de cada peca entra como principal
    let principal = 0;
    if (itemId && !comPrincipal.has(itemId)) {
      principal = db.prepare('SELECT COUNT(*) AS n FROM imagens WHERE item_id = ?').get(itemId).n ? 0 : 1;
      if (principal) comPrincipal.add(itemId);
    }
    stmt.inserirImagem.run({
      catalogo_id: arquivo.catalogo_id,
      arquivo_id: arquivo.id,
      item_id: itemId,
      caminho: imagem.caminho,
      hash: imagem.hash,
      largura: imagem.largura,
      altura: imagem.altura,
      ancora: imagem.ancora ?? null,
      principal,
    });
    totais.imagens++;
  }

  return totais;
});

/**
 * Processa um arquivo ja gravado em disco: parse -> normalizacao -> consolidacao.
 * Nunca lanca: o desfecho fica registrado na propria tabela `arquivos`.
 */
async function processarArquivo(arquivoId) {
  const arquivo = db.prepare('SELECT * FROM arquivos WHERE id = ?').get(arquivoId);
  if (!arquivo) throw new Error(`Arquivo ${arquivoId} nao encontrado`);

  stmt.atualizarStatus.run('processando', null, arquivo.id);

  try {
    const resultado = await parseArquivo(arquivo.caminho);

    // I/O de imagem fora da transacao: better-sqlite3 e sincrono e nao deve segurar o lock
    const imagensSalvas = resultado.imagens.map((imagem) => ({
      ...salvarImagem(imagem.buffer, imagem.extensao),
      ancora: imagem.ancora,
      ref: imagem.ref,
    }));

    const totais = persistir(arquivo, resultado, imagensSalvas);
    const avisos = [...(resultado.avisos ?? [])];
    if (totais.ignoradas) {
      avisos.push(`${totais.ignoradas} linha(s) sem código e sem preço foram ignoradas (título de seção ou observação).`);
    }
    if (totais.semFornecedor) {
      avisos.push(`${totais.semFornecedor} linha(s) com custo foram ignoradas por nao ter fornecedor definido.`);
    }

    stmt.finalizar.run(
      'processado', avisos.length ? avisos.join(' | ') : null,
      totais.itens, totais.novos, totais.custos, totais.imagens, arquivo.id,
    );

    return { status: 'processado', ...totais, avisos };
  } catch (erro) {
    const naoSuportado = erro instanceof FormatoNaoSuportadoError;
    stmt.finalizar.run(naoSuportado ? 'pendente' : 'erro', erro.message, 0, 0, 0, 0, arquivo.id);
    return { status: naoSuportado ? 'pendente' : 'erro', itens: 0, novos: 0, custos: 0, imagens: 0, erro: erro.message };
  }
}

/**
 * Desfaz o que um arquivo gerou, para permitir reprocessar.
 * Itens criados por ele saem; itens criados por outros arquivos e apenas complementados
 * permanecem (a curadoria feita depois nao pode ser perdida por um reprocessamento).
 * Ao remover custos, a vigencia anterior de cada fornecedor e reaberta.
 */
const reverterArquivo = db.transaction((arquivoId) => {
  db.prepare('DELETE FROM item_custos WHERE arquivo_id = ?').run(arquivoId);
  db.prepare('DELETE FROM imagens WHERE arquivo_id = ?').run(arquivoId);
  db.prepare('DELETE FROM itens WHERE arquivo_id = ?').run(arquivoId);

  db.prepare(`
    UPDATE item_custos SET vigencia_fim = NULL
     WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (PARTITION BY item_id, fornecedor_id, qtd_min
                                       ORDER BY vigencia_inicio DESC, id DESC) AS rn
           FROM item_custos
       ) WHERE rn = 1
     )
       AND NOT EXISTS (
         SELECT 1 FROM item_custos c2
          WHERE c2.item_id = item_custos.item_id
            AND c2.fornecedor_id = item_custos.fornecedor_id
            AND c2.qtd_min = item_custos.qtd_min
            AND c2.vigencia_fim IS NULL
       )`).run();
});

module.exports = { processarArquivo, reverterArquivo, normalizarCodigo };
