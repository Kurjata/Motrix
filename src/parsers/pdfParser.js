'use strict';

const fs = require('fs');
const path = require('path');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const { detectarCabecalho, linhaParaItem } = require('./columnMapper');
const { itensPorLinha } = require('./listaPorLinha');
const { codificarPng, expandirMonocromatico } = require('../utils/png');

// tolerancias em pontos (1/72"): o PDF nao tem linhas nem colunas, so coordenadas
const TOLERANCIA_LINHA = 3;
const TOLERANCIA_COLUNA = 12;
const MIN_LADO_IMAGEM = 32; // ignora icone, marca d'agua e fio de tabela

/** Agrupa os fragmentos de texto por altura (y): cada grupo vira uma linha da tabela. */
function agruparEmLinhas(itens) {
  const linhas = [];

  for (const item of itens) {
    if (!item.str) continue;

    const x = item.transform[4];
    const y = item.transform[5];
    // a largura vem do proprio pdfjs e e o que permite saber se dois fragmentos
    // sao a mesma palavra ("Bra" + "ç" + "o") ou palavras vizinhas
    const fragmento = { x, texto: item.str, largura: item.width ?? 0 };
    const linha = linhas.find((l) => Math.abs(l.y - y) <= TOLERANCIA_LINHA);

    if (linha) {
      linha.celulas.push(fragmento);
      linha.y = (linha.y + y) / 2;
    } else {
      linhas.push({ y, celulas: [fragmento] });
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

/**
 * A linha inteira como se lê na página, sem passar pelas colunas.
 * O agrupamento em colunas é bom para tabela e péssimo para texto corrido: ele parte
 * "Braço" em duas colunas ("Bra" e "ço") só porque o acento vem como fragmento separado.
 */
function textoDaLinha(linha) {
  let texto = '';
  let anterior = null;

  for (const fragmento of linha.celulas) {
    const vao = anterior ? fragmento.x - (anterior.x + anterior.largura) : 0;
    texto += !anterior || vao < 0.8 ? fragmento.texto : ` ${fragmento.texto}`;
    anterior = fragmento;
  }

  return texto.replace(/\s+/g, ' ').trim();
}

function linhaParaMatriz(linha, colunas) {
  const celulas = new Array(colunas.length).fill('');
  const ultimo = new Array(colunas.length).fill(null);

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

    // fragmentos coladinhos são a mesma palavra; só entra espaço quando há vão de verdade
    const anterior = ultimo[indice];
    const vao = anterior ? celula.x - (anterior.x + anterior.largura) : 0;
    celulas[indice] += !anterior || vao < 0.8 ? celula.texto : ` ${celula.texto}`;
    ultimo[indice] = celula;
  }

  return celulas.map((texto) => texto.replace(/\s+/g, ' ').trim());
}

/**
 * Pega um objeto (imagem) da pagina, desistindo depois de um tempo.
 *
 * `objs.get(nome, callback)` so chama de volta quando o objeto e resolvido, e isso pode
 * nunca acontecer: nao renderizamos a pagina, so lemos. Sem o limite de tempo, o import
 * fica pendurado para sempre e a tela mostra "Importando..." sem fim.
 */
function objetoDaPagina(pagina, nome, limite = 1500) {
  return new Promise((resolve) => {
    const relogio = setTimeout(() => resolve(null), limite);
    try {
      pagina.objs.get(nome, (objeto) => {
        clearTimeout(relogio);
        resolve(objeto);
      });
    } catch {
      clearTimeout(relogio);
      resolve(null);
    }
  });
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
        const objeto = await objetoDaPagina(pagina, nome);
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

    const textoLinhas = linhas.map(textoDaLinha);
    textoPaginas.push(textoLinhas.join('\n'));

    if (linhas.length) {
      const colunas = detectarColunas(linhas);
      const matriz = linhas.map((linha) => linhaParaMatriz(linha, colunas));
      // Duas leituras concorrem: tabela com cabecalho e lista corrida (uma peca por linha).
      // O PDF nao diz qual dos dois formatos ele e — e o detector de cabecalho as vezes
      // casa por engano e devolve linha vazia. Roda as duas e fica com a que rende mais.
      const cabecalho = detectarCabecalho(matriz, 20);
      const daTabela = [];

      if (cabecalho) {
        for (let i = cabecalho.indice + 1; i < matriz.length; i++) {
          const item = linhaParaItem(matriz[i], cabecalho);
          if (!item) continue;
          item.origem = `pdf:pagina ${numeroPagina}:linha ${i + 1}`;
          item.ref = `p${numeroPagina}!${i}`;
          item.linha = i;
          daTabela.push(item);
        }
      }

      const daLista = itensPorLinha(textoLinhas, (i) => `pdf:pagina ${numeroPagina}:linha ${i + 1}`)
        .map((item, ordem) => {
          const linha = textoLinhas.findIndex((t, j) => j >= ordem && t.includes(item.descricao));
          return { ...item, linha, ref: linha >= 0 ? `p${numeroPagina}!${linha}` : null };
        });

      const uteis = (lista) => lista.filter((i) => i.codigo && (i.descricao || i.preco != null)).length;
      const escolhidos = uteis(daLista) > uteis(daTabela) ? daLista : daTabela;

      for (const item of escolhidos) {
        if (item.linha >= 0 && linhas[item.linha]) linhas[item.linha].indice = item.linha;
        delete item.linha;
        itens.push(item);
      }

      if (!escolhidos.length) avisos.push(`Página ${numeroPagina}: nenhuma peça reconhecida.`);
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
