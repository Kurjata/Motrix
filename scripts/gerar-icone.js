'use strict';

/**
 * Desenha o icone do Motrix e grava desktop/icone.ico (+ um PNG de 512 para outros usos).
 * Feito na unha com o codificador PNG do proprio projeto: nada de canvas ou binario nativo,
 * que quebrariam o empacotamento.
 *   node scripts/gerar-icone.js
 */

const fs = require('fs');
const path = require('path');
const { codificarPng } = require('../src/utils/png');

const TAMANHOS = [16, 24, 32, 48, 64, 128, 256];
const SUPERAMOSTRAGEM = 4; // 4x4 amostras por pixel: e o que da a borda suave

const FUNDO = [18, 22, 28];      // mesmo #12161c do tema escuro do app
const MARCA = [77, 141, 253];    // mesmo acento azul

/** O "M" em coordenadas de 0 a 1, como uma lista de poligonos preenchidos. */
const HASTE = 0.115;
const M = [
  // haste esquerda
  [[0.20, 0.24], [0.20, 0.78], [0.20 + HASTE, 0.78], [0.20 + HASTE, 0.24]],
  // haste direita
  [[0.80 - HASTE, 0.24], [0.80 - HASTE, 0.78], [0.80, 0.78], [0.80, 0.24]],
  // o V do meio como um poligono unico: duas diagonais separadas deixam
  // um entalhe no vertice, onde uma nao cobre o que falta na outra
  [[0.20, 0.24], [0.315, 0.24], [0.50, 0.565], [0.685, 0.24], [0.80, 0.24],
    [0.555, 0.695], [0.445, 0.695]],
];

function dentroDoPoligono(x, y, poligono) {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i];
    const [xj, yj] = poligono[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Canto arredondado do quadrado de fundo, no mesmo raio proporcional do app. */
function dentroDoQuadrado(x, y, raio = 0.22) {
  const dx = Math.max(raio - x, x - (1 - raio), 0);
  const dy = Math.max(raio - y, y - (1 - raio), 0);
  return dx * dx + dy * dy <= raio * raio;
}

function desenhar(lado) {
  const pixels = Buffer.alloc(lado * lado * 4);

  for (let py = 0; py < lado; py++) {
    for (let px = 0; px < lado; px++) {
      let cobertura = 0;
      let cobreMarca = 0;

      for (let sy = 0; sy < SUPERAMOSTRAGEM; sy++) {
        for (let sx = 0; sx < SUPERAMOSTRAGEM; sx++) {
          const x = (px + (sx + 0.5) / SUPERAMOSTRAGEM) / lado;
          const y = (py + (sy + 0.5) / SUPERAMOSTRAGEM) / lado;
          if (!dentroDoQuadrado(x, y)) continue;
          cobertura++;
          if (M.some((poligono) => dentroDoPoligono(x, y, poligono))) cobreMarca++;
        }
      }

      const amostras = SUPERAMOSTRAGEM * SUPERAMOSTRAGEM;
      const alfa = cobertura / amostras;
      const proporcaoMarca = cobertura ? cobreMarca / cobertura : 0;
      const i = (py * lado + px) * 4;

      for (let canal = 0; canal < 3; canal++) {
        pixels[i + canal] = Math.round(FUNDO[canal] * (1 - proporcaoMarca) + MARCA[canal] * proporcaoMarca);
      }
      pixels[i + 3] = Math.round(alfa * 255);
    }
  }

  return codificarPng(pixels, lado, lado, 4);
}

/** ICO com PNG embutido em cada tamanho (suportado do Windows Vista em diante). */
function montarIco(imagens) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0);              // reservado
  cabecalho.writeUInt16LE(1, 2);              // 1 = icone
  cabecalho.writeUInt16LE(imagens.length, 4);

  const entradas = [];
  let deslocamento = 6 + imagens.length * 16;

  for (const { lado, png } of imagens) {
    const entrada = Buffer.alloc(16);
    entrada[0] = lado >= 256 ? 0 : lado;      // 0 significa 256
    entrada[1] = lado >= 256 ? 0 : lado;
    entrada[2] = 0;                           // cores da paleta
    entrada[3] = 0;                           // reservado
    entrada.writeUInt16LE(1, 4);              // planos
    entrada.writeUInt16LE(32, 6);             // bits por pixel
    entrada.writeUInt32LE(png.length, 8);
    entrada.writeUInt32LE(deslocamento, 12);
    entradas.push(entrada);
    deslocamento += png.length;
  }

  return Buffer.concat([cabecalho, ...entradas, ...imagens.map((i) => i.png)]);
}

const destino = path.join(__dirname, '..', 'desktop');
fs.mkdirSync(destino, { recursive: true });

const imagens = TAMANHOS.map((lado) => ({ lado, png: desenhar(lado) }));
fs.writeFileSync(path.join(destino, 'icone.ico'), montarIco(imagens));
fs.writeFileSync(path.join(destino, 'icone-512.png'), desenhar(512));

console.log(`Ícone gerado em ${destino} (${TAMANHOS.join(', ')} e 512 px)`);
