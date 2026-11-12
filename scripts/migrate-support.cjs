const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const db = require('../db');

async function migrate() {
  try {
    const sql = readFileSync(join(__dirname, '../migrations/005-support-ticket-messages.sql'), 'utf8');
    await db.query(sql);
    console.log('Migrasi percakapan tiket selesai.');
  } finally {
    await db.end();
  }
}

migrate().catch(error => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
