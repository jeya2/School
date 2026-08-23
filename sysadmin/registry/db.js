/* ============================================================
   sysadmin/registry/db.js — SQLite adapter for the control plane

   Both adapters (this and db_pg.js) implement one contract, so
   sysadmin/serve.js never learns which one it holds. Every method is
   async even where SQLite is synchronous. Adding a method means adding
   it to BOTH.

     init()
     describe()
     countOperators() / getOperator(u) / putOperator(op)
     bumpFailed(u) / clearFailed(u) / lockUntil(u, iso)
     setRecoveryCodes(u, codes) / listRecoveryCodes(u) / useRecoveryCode(id)
     listSchools() / getSchool(id) / putSchool(s) / deleteSchool(id)
     recordHealth(id, snap) / listHealth()
     createSession(s) / getSession(t) / touchSession(t, iso) / deleteSession(t) / purgeSessions()
     createChallenge(c) / getChallenge(t) / bumpChallenge(t) / deleteChallenge(t)
     audit(entry) / listAudit(limit)

   The registry is small — a few dozen schools, an audit trail. SQLite is
   the right shape for it and the whole thing is one file you can copy.
   Production still wants Postgres: see the note in ../README.md about
   better-sqlite3 being a native addon with prebuilds for only some Node
   ABIs, which is exactly why serve.js must survive this module failing
   to load.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, process.env.REGISTRY_DB || 'registry.db');

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');

async function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS operators (
      username TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      totp_secret TEXT,
      mobile TEXT,
      failed_count INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recovery_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS schools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      provider TEXT,
      provider_app TEXT,
      region TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS school_health (
      school_id TEXT PRIMARY KEY,
      checked_at TEXT NOT NULL,
      reachable INTEGER NOT NULL,
      http_status INTEGER,
      ok INTEGER,
      adapter TEXT,
      version TEXT,
      store_error TEXT,
      provisioned INTEGER,
      school_name TEXT,
      academic_year TEXT,
      latency_ms INTEGER,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      actor TEXT,
      action TEXT NOT NULL,
      target TEXT,
      ok INTEGER NOT NULL DEFAULT 1,
      detail TEXT,
      ip TEXT
    );
    CREATE INDEX IF NOT EXISTS audit_at_idx ON audit (at DESC);
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip TEXT,
      ua TEXT
    );
    CREATE TABLE IF NOT EXISTS challenges (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      ip TEXT,
      ua TEXT
    );
  `);
}

/* ---------- operators ---------- */
async function countOperators() {
  return db.prepare('SELECT COUNT(*) AS n FROM operators').get().n;
}
async function getOperator(username) {
  return db.prepare('SELECT * FROM operators WHERE username = ?').get(String(username || '').toLowerCase()) || null;
}
async function putOperator(op) {
  db.prepare(`INSERT INTO operators (username, name, salt, hash, totp_secret, mobile, failed_count, locked_until, created_at)
              VALUES (@username, @name, @salt, @hash, @totp_secret, @mobile, 0, NULL, @created_at)
              ON CONFLICT(username) DO UPDATE SET
                name = @name, salt = @salt, hash = @hash,
                totp_secret = COALESCE(@totp_secret, operators.totp_secret),
                mobile = COALESCE(@mobile, operators.mobile),
                /* Re-running setup is the documented way out of a lockout,
                   so it must clear one. db_pg.js does this; without it the
                   two adapters disagree and only SQLite traps you. */
                failed_count = 0, locked_until = NULL`).run({
    username: String(op.username).toLowerCase(),
    name: op.name || op.username,
    salt: op.salt,
    hash: op.hash,
    totp_secret: op.totp_secret || null,
    mobile: op.mobile || null,
    created_at: new Date().toISOString()
  });
}
async function bumpFailed(username) {
  db.prepare('UPDATE operators SET failed_count = failed_count + 1 WHERE username = ?').run(String(username).toLowerCase());
}
async function clearFailed(username) {
  db.prepare('UPDATE operators SET failed_count = 0, locked_until = NULL WHERE username = ?').run(String(username).toLowerCase());
}
async function lockUntil(username, iso) {
  db.prepare('UPDATE operators SET locked_until = ? WHERE username = ?').run(iso, String(username).toLowerCase());
}

/* ---------- recovery codes ---------- */
async function setRecoveryCodes(username, codes) {
  const u = String(username).toLowerCase();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM recovery_codes WHERE username = ?').run(u);
    const ins = db.prepare('INSERT INTO recovery_codes (username, salt, hash) VALUES (?, ?, ?)');
    for (const c of codes) ins.run(u, c.salt, c.hash);
  });
  tx();
}
async function listRecoveryCodes(username) {
  return db.prepare('SELECT * FROM recovery_codes WHERE username = ? AND used_at IS NULL')
    .all(String(username).toLowerCase());
}
async function useRecoveryCode(id) {
  db.prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .run(new Date().toISOString(), id);
}

/* ---------- schools ---------- */
async function listSchools() {
  return db.prepare('SELECT * FROM schools ORDER BY name').all();
}
async function getSchool(id) {
  return db.prepare('SELECT * FROM schools WHERE id = ?').get(id) || null;
}
async function putSchool(s) {
  db.prepare(`INSERT INTO schools (id, name, url, provider, provider_app, region, status, notes, created_at)
              VALUES (@id, @name, @url, @provider, @provider_app, @region, @status, @notes, @created_at)
              ON CONFLICT(id) DO UPDATE SET
                name = @name, url = @url, provider = @provider,
                provider_app = @provider_app, region = @region,
                status = @status, notes = @notes`).run({
    id: s.id,
    name: s.name,
    url: String(s.url || '').replace(/\/+$/, ''),
    provider: s.provider || null,
    provider_app: s.provider_app || null,
    region: s.region || null,
    status: s.status || 'active',
    notes: s.notes || null,
    created_at: new Date().toISOString()
  });
}
async function deleteSchool(id) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM school_health WHERE school_id = ?').run(id);
    db.prepare('DELETE FROM schools WHERE id = ?').run(id);
  });
  tx();
}

/* ---------- health ---------- */
async function recordHealth(id, s) {
  db.prepare(`INSERT INTO school_health (school_id, checked_at, reachable, http_status, ok, adapter,
                version, store_error, provisioned, school_name, academic_year, latency_ms, error)
              VALUES (@school_id, @checked_at, @reachable, @http_status, @ok, @adapter,
                @version, @store_error, @provisioned, @school_name, @academic_year, @latency_ms, @error)
              ON CONFLICT(school_id) DO UPDATE SET
                checked_at = @checked_at, reachable = @reachable, http_status = @http_status,
                ok = @ok, adapter = @adapter, version = @version, store_error = @store_error,
                provisioned = @provisioned, school_name = @school_name,
                academic_year = @academic_year, latency_ms = @latency_ms, error = @error`).run({
    school_id: id,
    checked_at: s.checked_at,
    reachable: s.reachable ? 1 : 0,
    http_status: s.http_status ?? null,
    ok: s.ok == null ? null : (s.ok ? 1 : 0),
    adapter: s.adapter ?? null,
    version: s.version ?? null,
    store_error: s.store_error ?? null,
    provisioned: s.provisioned == null ? null : (s.provisioned ? 1 : 0),
    school_name: s.school_name ?? null,
    academic_year: s.academic_year ?? null,
    latency_ms: s.latency_ms ?? null,
    error: s.error ?? null
  });
}
async function listHealth() {
  const rows = db.prepare('SELECT * FROM school_health').all();
  const out = {};
  for (const r of rows) {
    out[r.school_id] = {
      ...r,
      reachable: !!r.reachable,
      ok: r.ok == null ? null : !!r.ok,
      provisioned: r.provisioned == null ? null : !!r.provisioned
    };
  }
  return out;
}

/* ---------- sessions ---------- */
async function createSession(s) {
  db.prepare(`INSERT INTO sessions (token, username, created_at, last_seen, expires_at, ip, ua)
              VALUES (@token, @username, @created_at, @last_seen, @expires_at, @ip, @ua)`).run(s);
}
async function getSession(token) {
  return db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) || null;
}
async function touchSession(token, iso) {
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?').run(iso, token);
}
async function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
async function purgeSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('DELETE FROM challenges WHERE expires_at < ?').run(new Date().toISOString());
}

/* ---------- challenges ---------- */
async function createChallenge(c) {
  db.prepare(`INSERT INTO challenges (token, username, created_at, expires_at, attempts, ip, ua)
              VALUES (@token, @username, @created_at, @expires_at, 0, @ip, @ua)`).run(c);
}
async function getChallenge(token) {
  return db.prepare('SELECT * FROM challenges WHERE token = ?').get(token) || null;
}
async function bumpChallenge(token) {
  db.prepare('UPDATE challenges SET attempts = attempts + 1 WHERE token = ?').run(token);
}
async function deleteChallenge(token) {
  db.prepare('DELETE FROM challenges WHERE token = ?').run(token);
}

/* ---------- audit ----------
   Append only. There is no update and no delete, deliberately. */
async function audit(e) {
  db.prepare(`INSERT INTO audit (at, actor, action, target, ok, detail, ip)
              VALUES (@at, @actor, @action, @target, @ok, @detail, @ip)`).run({
    at: e.at || new Date().toISOString(),
    actor: e.actor || null,
    action: e.action,
    target: e.target || null,
    ok: e.ok === false ? 0 : 1,
    detail: e.detail || null,
    ip: e.ip || null
  });
}
async function listAudit(limit = 200) {
  return db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(Number(limit))
    .map(r => ({ ...r, ok: !!r.ok }));
}

module.exports = {
  adapter: 'sqlite',
  describe: () => `sqlite (sysadmin/data/${process.env.REGISTRY_DB || 'registry.db'})`,
  init,
  countOperators, getOperator, putOperator, bumpFailed, clearFailed, lockUntil,
  setRecoveryCodes, listRecoveryCodes, useRecoveryCode,
  listSchools, getSchool, putSchool, deleteSchool,
  recordHealth, listHealth,
  createSession, getSession, touchSession, deleteSession, purgeSessions,
  createChallenge, getChallenge, bumpChallenge, deleteChallenge,
  audit, listAudit
};
