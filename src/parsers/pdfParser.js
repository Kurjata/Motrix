'use strict';

const fs = require('fs');
const path = require('path');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const { detectarCabecalho, linhaParaItem } = require('./columnMapper');
const { codificarPng, expandirMonocromatico } = require('../utils/png');

// tolerancias em pontos (1/72"): o PDF nao tem linhas nem colunas, so coordenadas
const TOLERANCIA_LINHA = 3;
const TOLERANCIA_COLUNA = 12;
const MIN_LADO_IMAGEM = 32; // ignora icone, marca d'agua e fio de tabela

/** Agrupa os fragmentos de texto por altura (y): cada grupo vira uma linha da tabela. */
function agruparEmLinhas(itens) {
  const linhas = [];

  for (const item of itens) {
    const texto = item.str.trim();
    if (!texto) continue;

    const x = item.transform[4];
    const y = item.transform[5];
    const linha = linhas.find((l) => Math.abs(l.y - y) <= TOLERANCIA_LINHA);

    if (linha) {
      linha.celulas.push({ x, texto });
      linha.y = (linha.y + y) / 2;
    } else {
      linhas.push({ y, celulas: [{ x, texto }] });
    }
  }

  linhas.sort((a, b) => b.y - a.y); // PDF conta y de baixo para cima
  for (const linha of linhas) linha.celulas.sort((a, b) => a.x - b.x);
  return linhas;
}

/** Descobre as colunas a partir das posicoes x recorrentes na pagina inteira. */
function detectarColunas(linhas) {
  const posicoes = linhas.flatMap((l) => l.celulas.map((c) => c.x)).sort((a, b) => a - b);
  const colunas = [];

  for (const x of posicoes) {
    const ultima = colunas[colunas.length - 1];
    if (ultima && x - ultima.x <= TOLERANCIA_COLUNA) {
      ultima.x = (ultima.x * ultima.peso + x) / (ultima.peso + 1);
      ultima.peso++;
    } else {
      colunas.push({ x, peso: 1 });
    }
  }

  return colunas.map((c) => c.x);
}

function linhaParaMatriz(linha, colunas) {
  const celulas = new Array(colunas.length).fill('');

  for (const celula of linha.celulas) {
    let indice = 0;
    let menorDistancia = Infinity;
    colunas.forEach((x, i) => {
      const distancia = Math.abs(x - celula.x);
      if (distancia < menorDistancia) {
        menorDistancia = distancia;
        indice = i;
      }
    });
    // fragmentos da mesma celula chegam separados; junta preservando o espaco
    celulas[indice] = celulas[indice] ? `${celulas[indice]} ${celula.texto}` : celula.texto;
  }

  return celulas;
}

/** Percorre a lista de operadores da pagina rastreando a matriz corrente (CTM). */
async function extrairImagens(pagina, numeroPagina, linhas) {
  const imagens = [];

  let operadores;
  try {
    operadores = await pagina.getOperatorList();
  } catch {
    return imagens;
  }

  const { OPS } = pdfjs;
  let ctm = [1, 0, 0, 1, 0, 0];
  const pilha = [];

  const multiplicar = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];

  for (let i = 0; i < operadores.fnArray.length; i++) {
    const operador = operadores.fnArray[i];
    const argumentos = operadores.argsArray[i];

    if (operador === OPS.save) pilha.push([...ctm]);
    else if (operador === OPS.restore) ctm = pilha.pop() || [1, 0, 0, 1, 0, 0];
    else if (operador === OPS.transform) ctm = multiplicar(ctm, argumentos);
    else if (operador === OPS.paintImageXObject || operador === OPS.paintJpegXObject) {
      const nome = argumentos[0];
      try {
        const objeto = await new Promise((resolve, reject) => {
          try {
            pagina.objs.get(nome, resolve);
          } catch (erro) {
            reject(erro);
          }
        });
        const png = paraPng(objeto);
        if (!png) continue;

        // o canto inferior da imagem no espaco da pagina: serve para achar a linha da peca
        const y = ctm[5];
        const linhaMaisProxima = linhas.reduce(
          (melhor, linha) => (Math.abs(linha.y - y) < Math.abs(melhor.y - y) ? linha : melhor),
          linhas[0] || { y: Infinity, indice: null },
        );

        imagens.push({
          buffer: png,
          extensao: 'png',
          ancora: `pdf:pagina ${numeroPagina}`,
          ref: linhaMaisProxima?.indice != null ? `p${numeroPagina}!${linhaMaisProxima.indice}` : null,
        });
      } catch {
        // imagem em formato que o pdfjs nao decodifica sozinho (JPX, mascaras): segue o baile
      }
    }
  }

  return imagens;
}

/** Bitmap cru do pdfjs -> PNG. */
function paraPng(objeto) {
  if (!objeto?.data || !objeto.width || !objeto.height) return null;
  const { data, width, height, kind } = objeto;
  if (width < MIN_LADO_IMAGEM || height < MIN_LADO_IMAGEM) return null;

  // ImageKind: 1 = cinza 1bpp, 2 = RGB 24bpp, 3 = RGBA 32bpp
  if (kind === 1) return codificarPng(expandirMonocromatico(data, width, height), width, height, 1);
  if (kind === 2) return codificarPng(data, width, height, 3);
  if (kind === 3) return codificarPng(data, width, height, 4);

  // sem kind: assume RGBA se o tamanho bater, senao desiste
  if (data.length === width * height * 4) return codificarPng(data, width, height, 4);
  if (data.length === width * height * 3) return codificarPng(data, width, height, 3);
  return null;
}

async function parsePdf(caminho) {
  const documento = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(caminho)),
    // fontes padrao vem do proprio pacote: sem isso o pdfjs reclama a cada pagina
    standardFontDataUrl: `${path.dirname(require.resolve('pdfjs-dist/package.json'))}/standard_fonts/`,
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const totalPaginas = documento.numPages;
  const itens = [];
  const imagens = [];
  const avisos = [];
  const textoPaginas = [];

  for (let numeroPagina = 1; numeroPagina <= totalPaginas; numeroPagina++) {
    const pagina = await documento.getPage(numeroPagina);
    const conteudo = await pagina.getTextContent();
    const linhas = agruparEmLinhas(conteudo.items);

    textoPaginas.push(linhas.map((l) => l.celulas.map((c) => c.texto).join(' ')).join('\n'));

    if (linhas.length) {
      const colunas = detectarColunas(linhas);
      const matriz = linhas.map((linha) => linhaParaMatriz(linha, colunas));
      const cabecalho = detectarCabecalho(matriz, 20);

      if (!cabecalho) {
        avisos.push(`Pagina ${numeroPagina}: nenhuma tabela reconhecida.`);
      } else {
        for (let i = cabecalho.indice + 1; i < matriz.length; i++) {
          const item = linhaParaItem(matriz[i], cabecalho);
          if (!item) continue;
          item.origem = `pdf:pagina ${numeroPagina}:linha ${i + 1}`;
          item.ref = `p${numeroPagina}!${i}`;
          linhas[i].indice = i;
          itens.push(item);
        }
      }
    }

    imagens.push(...(await extrairImagens(pagina, numeroPagina, linhas.filter((l) => l.indice != null))));
    pagina.cleanup();
  }

  await documento.destroy();

  if (!itens.length) {
    avisos.push('Nenhuma peca reconhecida no PDF. O texto foi preservado para conferencia manual.');
  }

  return { itens, imagens, avisos, texto: textoPaginas.join('\n\n'), meta: { paginas: totalPaginas } };
}

module.exports = { parsePdf };
