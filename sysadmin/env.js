/* ============================================================
   sysadmin/env.js — one .env, loaded the same way by every entry point

   This exists because the alternative bit. serve.js read .env and
   setup.js did not, so setting REGISTRY_DB in .env made the server open
   one registry while the CLI wrote the operator into another. Nothing
   errored: `setup.js init` reported success, the login then rejected
   every code, and the only clue was a path printed at startup.

   Any new entry point in this folder must require THIS, first — before
   requiring registry/db.js, which reads process.env.REGISTRY_DB at
   module load time and therefore has to be loaded after the file is
   parsed.

   Real environment variables always win: a value exported in the shell
   or set by the hosting platform is never overwritten by the file.
   ============================================================ */
const fs = require('fs');
const path = require('path');

/* sysadmin/.env first, then the project's own .env. First writer wins,
   so a control-plane setting can override a school-side one without
   editing the shared file. */
const FILES = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env')
];

let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  for (const file of FILES) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;                                  // blank line or # comment
      const key = m[1];
      let val = m[2].trim().replace(/\s+#.*$/, '');      // strip a trailing comment
      if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

load();

/** Which registry both halves will open. Printed by setup.js and serve.js
 *  so a mismatch is visible rather than inferred. */
function registryLabel() {
  return process.env.REGISTRY_DATABASE_URL
    ? 'postgres (REGISTRY_DATABASE_URL)'
    : `sqlite (sysadmin/data/${process.env.REGISTRY_DB || 'registry.db'})`;
}

module.exports = { load, registryLabel, FILES };
