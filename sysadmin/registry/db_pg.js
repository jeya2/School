/* ============================================================
   sysadmin/registry/db_pg.js — Postgres adapter for the control plane

   Same contract as db.js, documented there. Every method exists in both;
   adding one here without adding it there (or the reverse) is the bug
   this arrangement exists to make obvious.

   This is the production adapter. better-sqlite3 is a native addon with
   prebuilds for only some Node ABIs, and the control plane failing to
   start is how you stop noticing that a school went down.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const connectionString = process.env.REGISTRY_DATABASE_URL;

/* Verifies the server certificate by default — see the longer note in
   server/db_pg.js. If anything, it matters more here: this database holds
   the operator's password hash, TOTP secret and recovery-code hashes, the
   credentials guarding every school. PGSSL=no-verify downgrades it for a
   self-signed server; PGSSL=disable turns TLS off for local work. */
const wantsTls = /sslmode=(require|verify-ca|verify-full)|render\.com|neon\.tech|supabase|amazonaws|\.tech|\.cloud/
  .test(connectionString || '');

const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSL === 'disable' ? false
     : process.env.PGSSL === 'no-verify' ? { rejectUnauthorized: false }
     : wantsTls ? { rejectUnauthorized: true }
     : undefined
});

const q = (text, params) => pool.query(text, params);

async function init() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await q(sql);
}

/* ---------- operators ---------- */
async function countOperators() {
  const { rows } = await q('SELECT COUNT(*)::int AS n FROM operators');
  return rows[0].n;
}
async function getOperator(username) {
  const { rows } = await q('SELECT * FROM operators WHERE username = $1', [String(username || '').toLowerCase()]);
  return rows[0] || null;
}
async function putOperator(op) {
  await q(`INSERT INTO operators (username, name, salt, hash, totp_secret, mobile, failed_count, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 0, NOW())
           ON CONFLICT (username) DO UPDATE SET
             name = $2, salt = $3, hash = $4,
             totp_secret = COALESCE($5, operators.totp_secret),
             mobile = COALESCE($6, operators.mobile),
             failed_count = 0, locked_until = NULL`,
    [String(op.username).toLowerCase(), op.name || op.username, op.salt, op.hash,
     op.totp_secret || null, op.mobile || null]);
}
async function bumpFailed(username) {
  await q('UPDATE operators SET failed_count = failed_count + 1 WHERE username = $1', [String(username).toLowerCase()]);
}
async function clearFailed(username) {
  await q('UPDATE operators SET failed_count = 0, locked_until = NULL WHERE username = $1', [String(username).toLowerCase()]);
}
async function lockUntil(username, iso) {
  await q('UPDATE operators SET locked_until = $2 WHERE username = $1', [String(username).toLowerCase(), iso]);
}

/* ---------- recovery codes ---------- */
async function setRecoveryCodes(username, codes) {
  const u = String(username).toLowerCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM recovery_codes WHERE username = $1', [u]);
    for (const c of codes) {
      await client.query('INSERT INTO recovery_codes (username, salt, hash) VALUES ($1, $2, $3)', [u, c.salt, c.hash]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
async function listRecoveryCodes(username) {
  const { rows } = await q('SELECT * FROM recovery_codes WHERE username = $1 AND used_at IS NULL',
    [String(username).toLowerCase()]);
  return rows;
}
async function useRecoveryCode(id) {
  await q('UPDATE recovery_codes SET used_at = NOW() WHERE id = $1 AND used_at IS NULL', [id]);
}

/* ---------- schools ---------- */
async function listSchools() {
  const { rows } = await q('SELECT * FROM schools ORDER BY name');
  return rows;
}
async function getSchool(id) {
  const { rows } = await q('SELECT * FROM schools WHERE id = $1', [id]);
  return rows[0] || null;
}
async function putSchool(s) {
  await q(`INSERT INTO schools (id, name, url, provider, provider_app, region, status, notes, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (id) DO UPDATE SET
             name = $2, url = $3, provider = $4, provider_app = $5,
             region = $6, status = $7, notes = $8`,
    [s.id, s.name, String(s.url || '').replace(/\/+$/, ''), s.provider || null,
     s.provider_app || null, s.region || null, s.status || 'active', s.notes || null]);
}
async function deleteSchool(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM school_health WHERE school_id = $1', [id]);
    await client.query('DELETE FROM schools WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/* ---------- health ---------- */
async function recordHealth(id, s) {
  await q(`INSERT INTO school_health (school_id, checked_at, reachable, http_status, ok, adapter,
             version, store_error, provisioned, school_name, academic_year, latency_ms, error)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (school_id) DO UPDATE SET
             checked_at = $2, reachable = $3, http_status = $4, ok = $5, adapter = $6,
             version = $7, store_error = $8, provisioned = $9, school_name = $10,
             academic_year = $11, latency_ms = $12, error = $13`,
    [id, s.checked_at, !!s.reachable, s.http_status ?? null, s.ok ?? null, s.adapter ?? null,
     s.version ?? null, s.store_error ?? null, s.provisioned ?? null, s.school_name ?? null,
     s.academic_year ?? null, s.latency_ms ?? null, s.error ?? null]);
}
async function listHealth() {
  const { rows } = await q('SELECT * FROM school_health');
  const out = {};
  for (const r of rows) out[r.school_id] = r;
  return out;
}

/* ---------- sessions ---------- */
async function createSession(s) {
  await q(`INSERT INTO sessions (token, username, created_at, last_seen, expires_at, ip, ua)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [s.token, s.username, s.created_at, s.last_seen, s.expires_at, s.ip || null, s.ua || null]);
}
async function getSession(token) {
  const { rows } = await q('SELECT * FROM sessions WHERE token = $1', [token]);
  if (!rows[0]) return null;
  const r = rows[0];
  /* The rest of the code compares ISO strings; pg hands back Date objects. */
  return {
    ...r,
    created_at: new Date(r.created_at).toISOString(),
    last_seen: new Date(r.last_seen).toISOString(),
    expires_at: new Date(r.expires_at).toISOString()
  };
}
async function touchSession(token, iso) {
  await q('UPDATE sessions SET last_seen = $2 WHERE token = $1', [token, iso]);
}
async function deleteSession(token) {
  await q('DELETE FROM sessions WHERE token = $1', [token]);
}
async function purgeSessions() {
  await q('DELETE FROM sessions WHERE expires_at < NOW()');
  await q('DELETE FROM challenges WHERE expires_at < NOW()');
}

/* ---------- challenges ---------- */
async function createChallenge(c) {
  await q(`INSERT INTO challenges (token, username, created_at, expires_at, attempts, ip, ua)
           VALUES ($1, $2, $3, $4, 0, $5, $6)`,
    [c.token, c.username, c.created_at, c.expires_at, c.ip || null, c.ua || null]);
}
async function getChallenge(token) {
  const { rows } = await q('SELECT * FROM challenges WHERE token = $1', [token]);
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    ...r,
    created_at: new Date(r.created_at).toISOString(),
    expires_at: new Date(r.expires_at).toISOString()
  };
}
async function bumpChallenge(token) {
  await q('UPDATE challenges SET attempts = attempts + 1 WHERE token = $1', [token]);
}
async function deleteChallenge(token) {
  await q('DELETE FROM challenges WHERE token = $1', [token]);
}

/* ---------- audit ---------- */
async function audit(e) {
  await q(`INSERT INTO audit (at, actor, action, target, ok, detail, ip)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [e.at || new Date().toISOString(), e.actor || null, e.action, e.target || null,
     e.ok !== false, e.detail || null, e.ip || null]);
}
async function listAudit(limit = 200) {
  const { rows } = await q('SELECT * FROM audit ORDER BY id DESC LIMIT $1', [Number(limit)]);
  return rows;
}

module.exports = {
  adapter: 'postgres',
  describe: () => 'postgres (' + String(connectionString || '').replace(/:[^:@/]*@/, ':***@') + ')',
  init,
  countOperators, getOperator, putOperator, bumpFailed, clearFailed, lockUntil,
  setRecoveryCodes, listRecoveryCodes, useRecoveryCode,
  listSchools, getSchool, putSchool, deleteSchool,
  recordHealth, listHealth,
  createSession, getSession, touchSession, deleteSession, purgeSessions,
  createChallenge, getChallenge, bumpChallenge, deleteChallenge,
  audit, listAudit
};
