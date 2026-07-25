'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');

module.exports = {
  ROOT,
  DATA_DIR,
  DB_FILE: process.env.DB_FILE || path.join(DATA_DIR, 'catalogo.db'),
  UPLOAD_DIR: path.join(DATA_DIR, 'uploads'),
  MEDIA_DIR: path.join(DATA_DIR, 'media'),
  PORT: Number(process.env.PORT || 3000),
  // 200 MB: PSD e PDF de catalogo estouram facil os limites padrao
  MAX_UPLOAD_BYTES: Number(process.env.MAX_UPLOAD_BYTES || 200 * 1024 * 1024),
};
