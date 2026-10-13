'use strict';
// Safe backup while the app is running: a consistent copy of the database plus the uploaded files.
//   node scripts/backup.js [destination-folder]
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const dbFile = path.join(dataDir, 'pamb.db');
if (!fs.existsSync(dbFile)) { console.error(`No database found at ${dbFile}`); process.exit(1); }

const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Manila' }).replace(/[: ]/g, (c) => (c === ' ' ? '_' : '-'));
const dest = path.resolve(process.argv[2] || path.join(dataDir, '..', 'backups'), `pamb-${stamp}`);
fs.mkdirSync(dest, { recursive: true });

const db = new DatabaseSync(dbFile);
db.exec(`VACUUM INTO '${path.join(dest, 'pamb.db').replace(/'/g, "''")}'`);
db.close();
const uploads = path.join(dataDir, 'uploads');
if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(dest, 'uploads'), { recursive: true });
console.log(`Backup written to ${dest}`);
