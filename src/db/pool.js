const { Pool } = require('pg');

const dbUrl = (process.env.DATABASE_URL || '').replace(/['"]/g, '');
const isLocalhost = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');

const pool = new Pool({
  connectionString: dbUrl,
  ssl: isLocalhost ? false : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

module.exports = pool;
