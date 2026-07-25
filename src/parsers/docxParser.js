'use strict';

const AdmZip = require('adm-zip');
const mammoth = require('mammoth');
const { parse: parseHtml } = require('node-html-parser');
const { detectarCabecalho, linhaParaItem } = require('./columnMapper');
const { ehImagem } = require('../utils/files');

function textoDaCelula(td) {
  return td.textContent.replace(/\s+/g, ' ').trim();
}

/** Expande colspan/rowspan simples para manter o alinhamento das colunas. */
function tabelaParaMatriz(table) {
  return table.querySelectorAll('tr').map((tr) => {
    const linha = [];
    for (const celula of tr.querySelectorAll('th,td')) {
      const span = Number(celula.getAttribute('colspan') || 1);
      linha.push(textoDaCelula(celula));
      for (let i = 1; i < span; i++) linha.push('');
    }
    return linha;
  });
}

/** Le as imagens embutidas direto do pacote OOXML (word/media/*). */
function extrairImagens(caminho) {
  const zip = new AdmZip(caminho);
  const imagens = [];

  for (const entrada of zip.getEntries()) {
    if (entrada.isDirectory) continue;
    if (!entrada.entryName.startsWith('word/media/')) continue;
    if (!ehImagem(entrada.entryName)) continue;

    const buffer = entrada.getData();
    if (!buffer.length) continue;

    const extensao = entrada.entryName.slice(entrada.entryName.lastIndexOf('.') + 1);
    imagens.push({
      buffer,
      extensao,
      ancora: `docx:${entrada.entryName}`,
      ref: null, // vinculo com o item e feito manualmente (ou na etapa de matching)
    });
  }

  return imagens;
}

async function parseDocx(caminho) {
  const { value: html, messages } = await mammoth.convertToHtml(
    { path: caminho },
    { convertImage: mammoth.images.imgElement(() => ({ src: '' })) },
  );

  const raiz = parseHtml(html);
  const itens = [];
  const avisos = messages.filter((m) => m.type === 'error').map((m) => m.message);

  raiz.querySelectorAll('table').forEach((table, indiceTabela) => {
    const matriz = tabelaParaMatriz(table);
    if (matriz.length < 2) return;

    const cabecalho = detectarCabecalho(matriz, 5);
    if (!cabecalho) {
      avisos.push(`Tabela ${indiceTabela + 1}: cabecalho nao reconhecido, ignorada.`);
      return;
    }

    for (let i = cabecalho.indice + 1; i < matriz.length; i++) {
      const item = linhaParaItem(matriz[i], cabecalho);
      if (!item) continue;
      item.origem = `docx:tabela ${indiceTabela + 1}:linha ${i + 1}`;
      itens.push(item);
    }
  });

  const imagens = extrairImagens(caminho);
  const texto = raiz.textContent.replace(/\n{3,}/g, '\n\n').trim();

  if (!itens.length) {
    avisos.push('Nenhuma tabela de itens reconhecida no documento. O texto foi guardado para revisao manual.');
  }

  return { itens, imagens, avisos, texto, meta: {} };
}

module.exports = { parseDocx };
