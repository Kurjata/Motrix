'use strict';

const { paraNumero, normalizar } = require('./columnMapper');

/**
 * Muita tabela de fabrica nao e tabela: e uma lista corrida, uma peca por linha,
 * sem cabecalho nenhum. Ex.: "HF – 11 Bucha da Bandej. Inferior Susp. Diant. Chevette R$ 8,00 #RE".
 *
 * Aqui o reconhecimento e por padrao dentro da linha, nao por coluna: acha o codigo no
 * comeco, o preco no fim, e o que sobra no meio e a descricao.
 */

// "HF – 11", "HF-124", "OS-1001", "12345"
const CODIGO = /^([A-Za-zÀ-ÿ]{1,6}\s*[-–—]\s*\d{1,6}[A-Za-z]?|[A-Za-zÀ-ÿ]{1,6}\s?\d{2,6}[A-Za-z]?|\d{4,8})\b/;
const PRECO = /R?\$?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*$/;
const MARCADOR = /#\s*([A-Za-z0-9]{1,6})\s*$/;   // "#RE" no fim da linha, legenda da fabrica
const MIN_LINHAS = 5;

/** "HF – 11" e "HF-  11" viram "HF-11": o mesmo codigo escrito de tres jeitos vira um so. */
function arrumarCodigo(codigo) {
  return normalizar(codigo).replace(/\s*[-–—]\s*/, '-').replace(/\s+/g, ' ').toUpperCase();
}

/** @returns {?{codigo: string, descricao: string, preco: ?number, observacao: ?string}} */
function interpretarLinha(texto) {
  const linha = normalizar(texto);
  if (linha.length < 8) return null;

  const achouCodigo = linha.match(CODIGO);
  if (!achouCodigo) return null;

  let resto = linha.slice(achouCodigo[0].length).trim();

  const achouMarcador = resto.match(MARCADOR);
  if (achouMarcador) resto = resto.slice(0, achouMarcador.index).trim();

  const achouPreco = resto.match(PRECO);
  if (!achouPreco) return null; // sem preco nao da para distinguir peca de texto solto

  const descricao = resto.slice(0, achouPreco.index).replace(/[\s.·-]+$/, '').trim();
  if (descricao.length < 3) return null;

  return {
    codigo: arrumarCodigo(achouCodigo[1]),
    descricao,
    preco: paraNumero(achouPreco[1]),
    observacao: achouMarcador ? `#${achouMarcador[1]}` : null,
  };
}

/**
 * Le uma lista de linhas de texto e devolve as que parecem peca.
 * So assume o formato quando varias linhas casam: uma ou duas seriam coincidencia.
 * @param {string[]} linhas
 * @param {(indice: number) => string} origem  como descrever de onde veio a linha
 */
function itensPorLinha(linhas, origem) {
  const itens = [];

  linhas.forEach((texto, indice) => {
    const item = interpretarLinha(texto);
    if (!item) return;
    itens.push({ ...item, dados_extra: {}, faixas: [], origem: origem(indice) });
  });

  return itens.length >= MIN_LINHAS ? itens : [];
}

module.exports = { itensPorLinha, interpretarLinha, MIN_LINHAS };
