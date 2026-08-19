const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const migrationsDir = path.join(__dirname, '..', 'migrations');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || process.env.PG_CONNECTION });

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const f of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      console.log('Applying', f);
      await client.query(sql);
    }
    await client.query('COMMIT');
    console.log('Migrations applied.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) run().catch(err => { console.error(err); process.exit(1); });
