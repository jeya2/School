-- ============================================================
-- sysadmin registry — the control plane's own schema.
--
-- Every statement is idempotent, so db_pg.init() can apply this file on
-- every boot, exactly as migrations/001_init.sql does for a school.
--
-- WHAT IS NOT HERE IS THE POINT: there is no students table, no marks,
-- no attendance, no guardian phone number. The control plane stores
-- metadata ABOUT deployments — where they are, whether they answered,
-- what version they run. Children's records stay in the school
-- deployment that owns them.
--
-- If a feature ever needs a student record in this database, that is a
-- design change, not an implementation detail. See ../README.md rule 4.
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- The operator. Expected to hold exactly one row.
CREATE TABLE IF NOT EXISTS operators (
  username TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  totp_secret TEXT,               -- base32; the primary second factor
  mobile TEXT,                    -- E.164, for stage 6 SMS fallback
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One-time recovery codes. Single operator means a lost phone locks you
-- out of every school at once, during whatever incident made you log in.
CREATE TABLE IF NOT EXISTS recovery_codes (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,             -- scrypt, same as a password
  used_at TIMESTAMPTZ
);

-- The fleet. One row per school deployment.
CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,            -- slug, e.g. 'schoolx'
  name TEXT NOT NULL,
  url TEXT NOT NULL,              -- https://schoolx.brightneuronlabs.ca
  provider TEXT,                  -- 'fly'
  provider_app TEXT,              -- the app name at the provider
  region TEXT,
  status TEXT NOT NULL DEFAULT 'active',   -- active | retired
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The latest health snapshot, one row per school, replaced on each poll.
-- Everything here comes from the school's PUBLIC /api/health and
-- /api/status, so stage 1 needs no credential against any school.
CREATE TABLE IF NOT EXISTS school_health (
  school_id TEXT PRIMARY KEY,
  checked_at TIMESTAMPTZ NOT NULL,
  reachable BOOLEAN NOT NULL,
  http_status INTEGER,
  ok BOOLEAN,                     -- health.ok — is a storage adapter loaded
  adapter TEXT,
  version TEXT,
  store_error TEXT,
  provisioned BOOLEAN,
  school_name TEXT,               -- as the deployment reports itself
  academic_year TEXT,
  latency_ms INTEGER,
  error TEXT
);

-- Append-only. Never UPDATE, never DELETE.
-- An audit log the control plane can rewrite is decoration; this table is
-- the local copy, and AUDIT_SINK ships the same entries off-box.
CREATE TABLE IF NOT EXISTS audit (
  id SERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor TEXT,
  action TEXT NOT NULL,
  target TEXT,
  ok BOOLEAN NOT NULL DEFAULT TRUE,
  detail TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit (at DESC);

-- Opaque server-side sessions. 30 min idle, 8 h absolute — not the
-- school app's 7 days. This session can reach every school you host.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  ip TEXT,
  ua TEXT
);

-- A password that has been accepted but not yet seconded by a factor.
-- Bound to IP and user agent, 5 minutes, 3 attempts.
CREATE TABLE IF NOT EXISTS challenges (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  ua TEXT
);
