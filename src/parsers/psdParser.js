'use strict';

const fs = require('fs');
const { readPsd, initializeCanvas } = require('ag-psd');
const { codificarPng } = require('../utils/png');
const { detectarCabecalho, linhaParaItem, normalizar } = require('./columnMapper');

const MIN_LADO_IMAGEM = 48;

// O ag-psd usa canvas do navegador para montar o ImageData. No servidor nao ha canvas,
// entao entregamos um ImageData de mentira (so o buffer RGBA), que e tudo que precisamos.
initializeCanvas(
  () => {
    throw new Error('PSD com recurso que exige canvas (JPEG embutido); leitura parcial.');
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
);

/** ImageData (RGBA) do ag-psd -> PNG. */
function paraPng(imageData) {
  if (!imageData?.data || !imageData.width || !imageData.height) return null;
  if (imageData.width < MIN_LADO_IMAGEM || imageData.height < MIN_LADO_IMAGEM) return null;
  return codificarPng(Buffer.from(imageData.data.buffer ?? imageData.data), imageData.width, imageData.height, 4);
}

/** Percorre a arvore de camadas coletando arte e texto. */
function percorrerCamadas(camadas, saida, caminho = []) {
  for (const camada of camadas ?? []) {
    const nome = normalizar(camada.name);
    const trilha = [...caminho, nome].filter(Boolean);

    if (camada.text?.text) {
      saida.textos.push({
        texto: normalizar(camada.text.text),
        camada: trilha.join(' / '),
        topo: camada.top ?? camada.text?.transform?.[5] ?? 0,
      });
    }

    if (camada.children?.length) {
      percorrerCamadas(camada.children, saida, trilha);
      continue;
    }

    if (camada.hidden) continue;

    const png = paraPng(camada.imageData);
    if (png) saida.imagens.push({ buffer: png, extensao: 'png', ancora: `psd:${trilha.join(' / ') || 'camada'}`, ref: null });
  }
}

/**
 * PSD e arte, nao planilha: o que se aproveita e a imagem composta (a peca renderizada),
 * a arte de cada camada e o texto das camadas de texto, que costuma trazer codigo e descricao.
 */
async function parsePsd(caminho) {
  const psd = readPsd(fs.readFileSync(caminho), {
    useImageData: true,     // devolve RGBA cru, sem depender de canvas
    skipThumbnail: true,
    skipLinkedFilesData: true,
  });

  const coletado = { imagens: [], textos: [] };

  const composta = paraPng(psd.imageData);
  if (composta) {
    coletado.imagens.push({ buffer: composta, extensao: 'png', ancora: 'psd:imagem composta', ref: null });
  }

  percorrerCamadas(psd.children, coletado);

  // as camadas de texto formam uma "tabela": cada linha e uma camada.
  // A ordem das camadas no arquivo e arbitraria, entao vale a ordem visual (de cima para baixo).
  coletado.textos.sort((a, b) => a.topo - b.topo);

  const itens = [];
  const avisos = [];
  const matriz = coletado.textos.map((t) => t.texto.split(/\t|\s{2,}|\s*\|\s*/).map((c) => c.trim()));
  const cabecalho = matriz.length > 1 ? detectarCabecalho(matriz, 10) : null;

  if (cabecalho) {
    for (let i = cabecalho.indice + 1; i < matriz.length; i++) {
      const item = linhaParaItem(matriz[i], cabecalho);
      if (!item) continue;
      item.origem = `psd:camada de texto ${i + 1}`;
      itens.push(item);
    }
  }

  // arte de uma peca so: as imagens do arquivo pertencem a ela, nao precisam de curadoria
  if (itens.length === 1) {
    itens[0].ref = 'psd:peca';
    for (const imagem of coletado.imagens) imagem.ref = 'psd:peca';
  }

  if (!itens.length) {
    avisos.push(coletado.textos.length
      ? 'PSD sem tabela reconhecivel: as imagens entraram como fotos sem peca e o texto ficou guardado.'
      : 'PSD sem camadas de texto: as imagens entraram como fotos sem peca, para voce vincular.');
  }

  return {
    itens,
    imagens: coletado.imagens,
    avisos,
    texto: coletado.textos.map((t) => `${t.camada}: ${t.texto}`).join('\n'),
    meta: { largura: psd.width, altura: psd.height, camadas_texto: coletado.textos.length },
  };
}

module.exports = { parsePsd };
