/* ============================================================
   server/db.js — SQLite adapter

   One instance serves one school, and its whole database is a single
   file under data/. Deploying a second school means a second file and
   a second deployment; nothing here is multi-tenant, on purpose.

   Both adapters (this and db_pg.js) implement the same contract, and
   every method is async even where SQLite is synchronous, so serve.js
   never needs to know which one it is talking to:

     init()                        create tables if absent
     getSchool() / setSchool(p)    the school profile
     getCollection(name)           one collection's JSON value
     setCollection(name, data)     replace one collection
     exportAll()                   profile + every collection
     importBundle(bundle)          replace everything, in one transaction
     wipe()                        drop all school data, keep users
     listUsers() / getUser(u) / putUser(u) / deleteUser(u)
     createSession(...) / getSession(t) / deleteSession(t) / purgeSessions()

   Collections are stored whole, as JSON, rather than a row per record.
   The portal saves a whole collection at a time, so this keeps the write
   path honest — what the browser holds after a save is exactly what is
   in the database. For a school-sized roll (hundreds to a few thousand
   students) the documents stay small; a district-sized deployment would
   want row-level storage and deltas instead.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, process.env.SCHOOL_DB || 'school.db');

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');   // a reader never blocks the office saving a record

const COLLECTIONS = ['students', 'marks', 'receipts', 'notices', 'staff',
                     'attendance', 'attHistory', 'attDays', 'applications'];

async function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS school (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collections (
      name TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT,
      role TEXT NOT NULL,
      sid TEXT,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);
  `);
}
init();

/* ---------- school profile ---------- */
async function getSchool() {
  const row = db.prepare('SELECT data FROM school WHERE id = 1').get();
  return row ? JSON.parse(row.data) : null;
}
async function setSchool(profile) {
  db.prepare('INSERT INTO school (id, data) VALUES (1, @d) ON CONFLICT(id) DO UPDATE SET data = @d')
    .run({ d: JSON.stringify(profile) });
  return profile;
}

/* ---------- collections ---------- */
async function getCollection(name) {
  const row = db.prepare('SELECT data FROM collections WHERE name = ?').get(name);
  return row ? JSON.parse(row.data) : null;
}
async function setCollection(name, data) {
  db.prepare(`INSERT INTO collections (name, data, updated_at) VALUES (@n, @d, @t)
              ON CONFLICT(name) DO UPDATE SET data = @d, updated_at = @t`)
    .run({ n: name, d: JSON.stringify(data), t: new Date().toISOString() });
  return data;
}
async function exportAll() {
  const out = { school: await getSchool() };
  const rows = db.prepare('SELECT name, data FROM collections').all();
  for (const r of rows) out[r.name] = JSON.parse(r.data);
  for (const c of COLLECTIONS) if (!(c in out)) out[c] = defaultFor(c);
  return out;
}
function defaultFor(name) {
  return ['marks', 'attendance', 'attHistory'].includes(name) ? {} : [];
}

/* ---------- provisioning ---------- */
/** Replace the school's entire dataset in one transaction: a failed import
 *  must never leave half a school behind. */
async function importBundle(bundle) {
  const now = new Date().toISOString();
  const txn = db.transaction(b => {
    db.prepare('DELETE FROM collections').run();
    if (b.school) {
      db.prepare('INSERT INTO school (id, data) VALUES (1, @d) ON CONFLICT(id) DO UPDATE SET data = @d')
        .run({ d: JSON.stringify(b.school) });
    }
    const ins = db.prepare('INSERT INTO collections (name, data, updated_at) VALUES (@n, @d, @t)');
    for (const c of COLLECTIONS) {
      ins.run({ n: c, d: JSON.stringify(c in b ? b[c] : defaultFor(c)), t: now });
    }
  });
  txn(bundle);
  return { collections: COLLECTIONS.length };
}

/** Clear school data but keep the accounts, so an operator who wipes a
 *  test import is not locked out of the instance they just cleared. */
async function wipe() {
  db.transaction(() => {
    db.prepare('DELETE FROM collections').run();
    db.prepare('DELETE FROM school').run();
  })();
}

/* ---------- users ---------- */
async function listUsers() {
  return db.prepare('SELECT username, name, title, role, sid, created_at FROM users ORDER BY username').all();
}
async function getUser(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
}
async function putUser(u) {
  db.prepare(`INSERT INTO users (username, name, title, role, sid, salt, hash, created_at)
              VALUES (@username, @name, @title, @role, @sid, @salt, @hash, @created_at)
              ON CONFLICT(username) DO UPDATE SET
                name = @name, title = @title, role = @role, sid = @sid, salt = @salt, hash = @hash`)
    .run({ title: null, sid: null, created_at: new Date().toISOString(), ...u });
  return u.username;
}
async function deleteUser(username) {
  db.prepare('DELETE FROM sessions WHERE username = ?').run(username);
  return db.prepare('DELETE FROM users WHERE username = ?').run(username).changes;
}
async function countUsers() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
}

/* ---------- sessions ---------- */
async function createSession(token, username, expiresAt) {
  db.prepare('INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, username, new Date().toISOString(), expiresAt);
  return token;
}
async function getSession(token) {
  return db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) || null;
}
async function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
async function purgeSessions() {
  return db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString()).changes;
}

module.exports = {
  adapter: 'sqlite',
  describe: () => `sqlite (data/${process.env.SCHOOL_DB || 'school.db'})`,
  init, getSchool, setSchool, getCollection, setCollection, exportAll,
  importBundle, wipe, listUsers, getUser, putUser, deleteUser, countUsers,
  createSession, getSession, deleteSession, purgeSessions, COLLECTIONS
};
