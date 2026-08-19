-- ============================================================
-- 001_init — the whole schema for one school's instance.
--
-- Every statement is idempotent, so db_pg.init() can apply this file on
-- every boot and server/migrate.js can be re-run without checking what
-- has already been applied.
--
-- One deployment holds one school. There is no tenant column anywhere,
-- deliberately: isolating schools by deployment means a query can never
-- accidentally cross from one school's children to another's.
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- The school's identity and calendar settings, supplied in its data file.
CREATE TABLE IF NOT EXISTS school (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data JSONB NOT NULL
);

-- One row per collection (students, marks, receipts, …), each holding the
-- whole collection as JSON. The portal saves a collection at a time; see
-- the note in server/db.js for why this is stored whole rather than as rows.
CREATE TABLE IF NOT EXISTS collections (
  name TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Staff and parent accounts. Passwords are scrypt hashes with a per-user
-- salt; no plaintext password is ever stored or logged.
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT,
  role TEXT NOT NULL,
  sid TEXT,                       -- the student this parent/student account may see
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Server-side sessions. The browser only ever holds an opaque token.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);

INSERT INTO schema_migrations (version) VALUES ('001_init') ON CONFLICT DO NOTHING;
