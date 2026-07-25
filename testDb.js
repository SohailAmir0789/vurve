const { Pool, Client } = require('pg');
require('dotenv').config();

async function main() {
  console.log('Testing connection to DB...');
  
  // Try connecting to the default 'postgres' database first to see if the server is up
  const client = new Client({
    connectionString: "postgresql://postgres:root@localhost:5432/postgres"
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL server successfully.');
    
    // Check if 'vurve' database exists
    const res = await client.query("SELECT datname FROM pg_database WHERE datname = 'vurve'");
    if (res.rows.length === 0) {
      console.log('Database "vurve" does not exist. Creating it...');
      await client.query('CREATE DATABASE vurve');
      console.log('✅ Database "vurve" created.');
    } else {
      console.log('✅ Database "vurve" already exists.');
    }
  } catch (err) {
    console.error('❌ Failed to connect to PostgreSQL server:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }

  // Now connect to the 'vurve' database
  console.log('\nConnecting to "vurve" database...');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    const tables = res.rows.map(r => r.table_name);
    console.log(`✅ Connected to "vurve". Found tables: ${tables.length ? tables.join(', ') : 'None'}`);
    
  } catch (err) {
    console.error('❌ Failed to query "vurve" database:', err.message);
  } finally {
    await pool.end();
  }
}

main();
