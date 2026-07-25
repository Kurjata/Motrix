'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const imageSize = require('image-size');
const { MEDIA_DIR } = require('../config');

const EXT_IMAGEM = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff', '.emf', '.wmf']);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hashArquivo(caminho) {
  return sha256(fs.readFileSync(caminho));
}

function ehImagem(nome) {
  return EXT_IMAGEM.has(path.extname(nome).toLowerCase());
}

/**
 * Grava a imagem em data/media/<2 primeiros chars do hash>/<hash>.<ext>.
 * Deduplica por conteudo: dois arquivos identicos apontam para o mesmo caminho.
 */
function salvarImagem(buffer, extensao) {
  const hash = sha256(buffer);
  const ext = extensao.startsWith('.') ? extensao.toLowerCase() : `.${extensao.toLowerCase()}`;
  const subdir = path.join(MEDIA_DIR, hash.slice(0, 2));
  fs.mkdirSync(subdir, { recursive: true });

  const destino = path.join(subdir, `${hash}${ext}`);
  if (!fs.existsSync(destino)) fs.writeFileSync(destino, buffer);

  let largura = null;
  let altura = null;
  try {
    const dim = imageSize(buffer);
    largura = dim.width ?? null;
    altura = dim.height ?? null;
  } catch {
    // formatos como EMF/WMF nao sao suportados pelo image-size; seguimos sem dimensao
  }

  return {
    hash,
    caminho: path.relative(MEDIA_DIR, destino).split(path.sep).join('/'),
    largura,
    altura,
  };
}

module.exports = { sha256, hashArquivo, ehImagem, salvarImagem };
