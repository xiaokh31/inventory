const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
require('../server/config.cjs').loadEnv();
(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Configure it in .env or the environment.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try { await pool.query(fs.readFileSync(path.join(__dirname, '../db/migrations/001_inventory.sql'), 'utf8')); console.log('Inventory database schema initialized; no sample records were inserted.'); }
  finally { await pool.end(); }
})().catch(error => { console.error('Database initialization failed:', error.code || error.message); process.exitCode = 1; });
