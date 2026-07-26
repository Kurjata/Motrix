'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DB_FILE, DATA_DIR, UPLOAD_DIR, MEDIA_DIR } = require('../config');

for (const dir of [DATA_DIR, UPLOAD_DIR, MEDIA_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

/**
 * Colunas acrescentadas depois que ja havia banco em uso — inclusive na maquina do usuario.
 * CREATE TABLE IF NOT EXISTS nao altera tabela existente, entao a adicao vem aqui,
 * conferindo antes para poder rodar em toda carga sem erro.
 */
function garantirColuna(tabela, coluna, definicao, preenchimento) {
  const existe = db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
  if (existe) return;

  db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
  if (preenchimento) db.exec(preenchimento);
}

// confirmado_em: data-base da ultima tabela em que o preco apareceu. Nos registros antigos,
// o melhor palpite e a propria vigencia — foi quando ele veio de uma tabela.
garantirColuna(
  'item_custos', 'confirmado_em', 'TEXT',
  'UPDATE item_custos SET confirmado_em = vigencia_inicio WHERE confirmado_em IS NULL',
);

module.exports = db;
