'use strict';

const XLSX = require('xlsx');
const { detectarCabecalho, linhaParaItem, normalizar } = require('./columnMapper');

/**
 * Planilha no formato binario antigo (.xls, do Excel 97-2003) e seus parentes.
 * O exceljs, que le os .xlsx, nao abre esse formato — e ele ainda e o que muita
 * fabrica manda. Aqui vale o mesmo reconhecimento de colunas das outras planilhas.
 *
 * Imagens nao sao extraidas: no formato antigo elas ficam num fluxo OLE separado,
 * fora do alcance desta biblioteca.
 */
async function parseXls(caminho, opcoes = {}) {
  const workbook = XLSX.readFile(caminho, { cellDates: true, cellText: false });

  const itens = [];
  const avisos = [];

  for (const nome of workbook.SheetNames) {
    const planilha = workbook.Sheets[nome];
    if (!planilha || !planilha['!ref']) continue;

    // header:1 devolve matriz crua, com a linha do jeito que esta na planilha
    const matriz = XLSX.utils
      .sheet_to_json(planilha, { header: 1, blankrows: false, defval: '' })
      .map((linha) => linha.map((celula) => (celula instanceof Date
        ? celula.toISOString().slice(0, 10)
        : String(celula ?? ''))));

    if (!matriz.length) continue;

    const cabecalho = opcoes.mapa ?? detectarCabecalho(matriz);
    if (!cabecalho) {
      avisos.push(`Aba "${nome}": não foi possível identificar o cabeçalho, ignorada.`);
      continue;
    }

    for (let i = cabecalho.indice + 1; i < matriz.length; i++) {
      const item = linhaParaItem(matriz[i], cabecalho);
      if (!item) continue;
      item.origem = `xls:${nome}:linha ${i + 1}`;
      itens.push(item);
    }
  }

  if (!itens.length) avisos.push('Nenhuma peça reconhecida na planilha.');

  return {
    itens,
    imagens: [],
    avisos,
    texto: null,
    meta: { abas: workbook.SheetNames.map(normalizar) },
  };
}

module.exports = { parseXls };
