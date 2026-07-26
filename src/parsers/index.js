'use strict';

const path = require('path');
const { parseXlsx } = require('./xlsxParser');
const { parseXls } = require('./xlsParser');
const { parseDocx } = require('./docxParser');
const { parsePdf } = require('./pdfParser');
const { parsePsd } = require('./psdParser');

/** Extensoes aceitas no upload. As sem parser ficam com status "pendente". */
const EXTENSOES_ACEITAS = new Set(['.xlsx', '.xlsm', '.xls', '.docx', '.doc', '.pdf', '.psd']);

const PARSERS = {
  '.xlsx': parseXlsx,
  '.xlsm': parseXlsx,
  '.xls': parseXls,   // formato binario antigo: outra biblioteca, mesmo reconhecimento
  '.docx': parseDocx,
  '.pdf': parsePdf,
  '.psd': parsePsd,
};

class FormatoNaoSuportadoError extends Error {
  constructor(extensao) {
    super(`Formato ${extensao} ainda nao possui parser (previsto para a proxima etapa).`);
    this.name = 'FormatoNaoSuportadoError';
    this.extensao = extensao;
  }
}

function extensaoDe(nome) {
  return path.extname(nome).toLowerCase();
}

function ehExtensaoAceita(nome) {
  return EXTENSOES_ACEITAS.has(extensaoDe(nome));
}

function temParser(nome) {
  return Boolean(PARSERS[extensaoDe(nome)]);
}

/** @returns {Promise<{itens: object[], imagens: object[], avisos: string[], texto: ?string, meta: object}>} */
async function parseArquivo(caminho) {
  const extensao = extensaoDe(caminho);
  const parser = PARSERS[extensao];
  if (!parser) throw new FormatoNaoSuportadoError(extensao);
  return parser(caminho);
}

module.exports = {
  EXTENSOES_ACEITAS,
  FormatoNaoSuportadoError,
  extensaoDe,
  ehExtensaoAceita,
  temParser,
  parseArquivo,
};
