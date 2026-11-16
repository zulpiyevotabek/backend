import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { config } from './config.js';

// NUMERIC (band) qiymatlarini string emas, son sifatida qaytarish
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
// BIGINT (id, count) ni songa o'tkazish — bizning hajmda xavfsiz
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => console.error('[db] kutilmagan pool xatosi:', err.message));

export const query = (text, params) => pool.query(text, params);

export async function migrate() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(path.join(dir, 'schema.sql'), 'utf8');
  await pool.query(sql);
}
