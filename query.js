require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='follows'`)
  .then(res => {
    console.log('Follows columns:', res.rows.map(r => r.column_name));
    pool.end();
  });
