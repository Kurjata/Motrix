'use strict';

const zlib = require('zlib');

/**
 * Codificador PNG minimo.
 * PDF e PSD entregam bitmap cru (RGB/RGBA/cinza); precisamos gravar como arquivo
 * de imagem sem depender de canvas nem de binario nativo.
 */

const TABELA_CRC = (() => {
  const tabela = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[i] = c;
  }
  return tabela;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i++) c = TABELA_CRC[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function bloco(tipo, dados) {
  const conteudo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(conteudo));
  return Buffer.concat([tamanho, conteudo, crc]);
}

/**
 * @param {Buffer|Uint8Array} pixels bitmap cru, sem filtro de linha
 * @param {number} largura
 * @param {number} altura
 * @param {number} canais 1 = cinza, 3 = RGB, 4 = RGBA
 */
function codificarPng(pixels, largura, altura, canais = 4) {
  const tipoCor = { 1: 0, 3: 2, 4: 6 }[canais];
  if (!tipoCor && tipoCor !== 0) throw new Error(`Numero de canais nao suportado: ${canais}`);

  const bytesPorLinha = largura * canais;
  // cada linha do PNG comeca com o byte de filtro (0 = nenhum)
  const cru = Buffer.alloc((bytesPorLinha + 1) * altura);
  for (let linha = 0; linha < altura; linha++) {
    cru[linha * (bytesPorLinha + 1)] = 0;
    Buffer.from(pixels.buffer ?? pixels, pixels.byteOffset ?? 0, pixels.length)
      .copy(cru, linha * (bytesPorLinha + 1) + 1, linha * bytesPorLinha, (linha + 1) * bytesPorLinha);
  }

  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(largura, 0);
  cabecalho.writeUInt32BE(altura, 4);
  cabecalho[8] = 8;          // bits por canal
  cabecalho[9] = tipoCor;
  cabecalho[10] = 0;         // compressao deflate
  cabecalho[11] = 0;         // filtro padrao
  cabecalho[12] = 0;         // sem entrelacamento

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', cabecalho),
    bloco('IDAT', zlib.deflateSync(cru, { level: 6 })),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

/** Converte 1 bit por pixel (preto e branco do PDF) para cinza de 8 bits. */
function expandirMonocromatico(dados, largura, altura) {
  const saida = Buffer.alloc(largura * altura);
  const bytesPorLinha = Math.ceil(largura / 8);

  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const byte = dados[y * bytesPorLinha + (x >> 3)];
      const bit = (byte >> (7 - (x & 7))) & 1;
      saida[y * largura + x] = bit ? 255 : 0;
    }
  }
  return saida;
}

module.exports = { codificarPng, expandirMonocromatico };
