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

module.exports = db;
