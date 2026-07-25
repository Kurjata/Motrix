'use strict';

const ExcelJS = require('exceljs');
const { detectarCabecalho, linhaParaItem, normalizar } = require('./columnMapper');

/** row.values do exceljs e 1-indexado (posicao 0 vem vazia). Normaliza para array 0-indexado. */
function valoresDaLinha(row) {
  const valores = Array.isArray(row.values) ? row.values.slice(1) : [];
  return valores.map((v) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
      // celulas ricas do exceljs: formula, hyperlink ou rich text
      if ('result' in v) return v.result ?? '';
      if ('text' in v) return v.text ?? '';
      if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
      return '';
    }
    return v;
  });
}

/**
 * Le uma planilha e devolve itens + imagens ancoradas na linha em que aparecem.
 * `ref` liga a imagem ao item ("Sheet1!42").
 */
async function parseXlsx(caminho) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(caminho);

  const itens = [];
  const imagens = [];
  const avisos = [];

  for (const worksheet of workbook.worksheets) {
    if (worksheet.state === 'veryHidden') continue;

    const linhas = [];
    const numerosDeLinha = [];
    worksheet.eachRow({ includeEmpty: false }, (row, numero) => {
      linhas.push(valoresDaLinha(row));
      numerosDeLinha.push(numero);
    });

    if (!linhas.length) continue;

    const cabecalho = detectarCabecalho(linhas);
    if (!cabecalho) {
      avisos.push(`Aba "${worksheet.name}": nao foi possivel identificar o cabecalho, ignorada.`);
      continue;
    }

    for (let i = cabecalho.indice + 1; i < linhas.length; i++) {
      const item = linhaParaItem(linhas[i], cabecalho);
      if (!item) continue;
      const numeroLinha = numerosDeLinha[i];
      item.origem = `xlsx:${worksheet.name}:linha ${numeroLinha}`;
      item.ref = `${worksheet.name}!${numeroLinha}`;
      itens.push(item);
    }

    for (const info of worksheet.getImages()) {
      const media = workbook.getImage(Number(info.imageId));
      if (!media || !media.buffer) continue;
      const linhaExcel = Math.round(info.range?.tl?.nativeRow ?? 0) + 1;
      imagens.push({
        buffer: media.buffer,
        extensao: media.extension || 'png',
        ancora: `${worksheet.name}!linha ${linhaExcel}`,
        ref: `${worksheet.name}!${linhaExcel}`,
      });
    }
  }

  if (!itens.length) avisos.push('Nenhum item reconhecido na planilha.');
  return { itens, imagens, avisos, texto: null, meta: { abas: workbook.worksheets.map((w) => normalizar(w.name)) } };
}

module.exports = { parseXlsx };
