/* ============================================================
   server/db_pg.js — Postgres adapter

   Implements exactly the contract documented at the top of db.js, so
   serve.js can hold either one without knowing the difference. Use this
   for a cloud deployment where the filesystem is ephemeral: on most
   platforms a container restart takes an SQLite file with it, while a
   managed Postgres survives.

   Selected at startup by DATABASE_URL / PG_CONNECTION / USE_PG=1.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || process.env.PG_CONNECTION;
const pool = new Pool({
  connectionString,
  /* Hosted Postgres almost always terminates TLS with a certificate the
     container does not have a root for. PGSSL=disable opts out entirely. */
  ssl: process.env.PGSSL === 'disable' ? false
     : /sslmode=require|render\.com|neon\.tech|supabase|amazonaws/.test(connectionString || '')
       ? { rejectUnauthorized: false } : undefined
});

const COLLECTIONS = ['students', 'marks', 'receipts', 'notices', 'staff',
                     'attendance', 'attHistory', 'attDays', 'applications'];

function defaultFor(name) {
  return ['marks', 'attendance', 'attHistory'].includes(name) ? {} : [];
}

/** Apply every migration in order. Each one is idempotent, so running the
 *  whole directory against an already-migrated database is a no-op. */
async function init() {
  const dir = path.join(__dirname, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) {
    await pool.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
}

/* ---------- school profile ---------- */
async function getSchool() {
  const r = await pool.query('SELECT data FROM school WHERE id = 1');
  return r.rows[0] ? r.rows[0].data : null;
}
async function setSchool(profile) {
  await pool.query(
    `INSERT INTO school (id, data) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [profile]);
  return profile;
}

/* ---------- collections ---------- */
async function getCollection(name) {
  const r = await pool.query('SELECT data FROM collections WHERE name = $1', [name]);
  return r.rows[0] ? r.rows[0].data : null;
}
async function setCollection(name, data) {
  await pool.query(
    `INSERT INTO collections (name, data, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [name, JSON.stringify(data)]);
  return data;
}
async function exportAll() {
  const out = { school: await getSchool() };
  const r = await pool.query('SELECT name, data FROM collections');
  for (const row of r.rows) out[row.name] = row.data;
  for (const c of COLLECTIONS) if (!(c in out)) out[c] = defaultFor(c);
  return out;
}

/* ---------- provisioning ---------- */
async function importBundle(bundle) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM collections');
    if (bundle.school) {
      await client.query(
        `INSERT INTO school (id, data) VALUES (1, $1)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [bundle.school]);
    }
    for (const c of COLLECTIONS) {
      const value = c in bundle ? bundle[c] : defaultFor(c);
      await client.query(
        'INSERT INTO collections (name, data, updated_at) VALUES ($1, $2, NOW())',
        [c, JSON.stringify(value)]);
    }
    await client.query('COMMIT');
    return { collections: COLLECTIONS.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function wipe() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM collections');
    await client.query('DELETE FROM school');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ---------- users ---------- */
async function listUsers() {
  const r = await pool.query(
    'SELECT username, name, title, role, sid, created_at FROM users ORDER BY username');
  return r.rows;
}
async function getUser(username) {
  const r = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return r.rows[0] || null;
}
async function putUser(u) {
  await pool.query(
    `INSERT INTO users (username, name, title, role, sid, salt, hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (username) DO UPDATE SET
       name = EXCLUDED.name, title = EXCLUDED.title, role = EXCLUDED.role,
       sid = EXCLUDED.sid, salt = EXCLUDED.salt, hash = EXCLUDED.hash`,
    [u.username, u.name, u.title || null, u.role, u.sid || null, u.salt, u.hash]);
  return u.username;
}
async function deleteUser(username) {
  await pool.query('DELETE FROM sessions WHERE username = $1', [username]);
  const r = await pool.query('DELETE FROM users WHERE username = $1', [username]);
  return r.rowCount;
}
async function countUsers() {
  const r = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  return r.rows[0].c;
}

/* ---------- sessions ---------- */
async function createSession(token, username, expiresAt) {
  await pool.query(
    'INSERT INTO sessions (token, username, created_at, expires_at) VALUES ($1, $2, NOW(), $3)',
    [token, username, expiresAt]);
  return token;
}
async function getSession(token) {
  const r = await pool.query('SELECT * FROM sessions WHERE token = $1', [token]);
  if (!r.rows[0]) return null;
  const s = r.rows[0];
  /* Normalise to the ISO strings the SQLite adapter returns, so callers
     compare like with like. */
  return { ...s, expires_at: new Date(s.expires_at).toISOString() };
}
async function deleteSession(token) {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}
async function purgeSessions() {
  const r = await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
  return r.rowCount;
}

module.exports = {
  adapter: 'postgres',
  describe: () => 'postgres (' + String(connectionString || '').replace(/:[^:@/]*@/, ':***@') + ')',
  init, getSchool, setSchool, getCollection, setCollection, exportAll,
  importBundle, wipe, listUsers, getUser, putUser, deleteUser, countUsers,
  createSession, getSession, deleteSession, purgeSessions, pool, COLLECTIONS
};
