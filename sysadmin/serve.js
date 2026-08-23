/* ============================================================
   sysadmin/serve.js — the control plane server

       node sysadmin/serve.js          -> http://localhost:5590
       node sysadmin/serve.js 8080

   A SEPARATE PROCESS AND A SEPARATE DEPLOYMENT from any school. It shares
   this repository and nothing else: no school's serve.js may require
   anything here, and this file requires nothing from server/. The
   dependency arrow points one way, so a school deployment cannot be made
   to execute control-plane code. `sysadmin` is in the school server's
   PRIVATE list, so /sysadmin/... is 403 there.

   STAGE 1 IS READ ONLY. It can look at the fleet and nothing else. There
   is no deploy, no destroy, no database maintenance and no route that
   writes to a school. That is deliberate: fleet visibility and backups
   are worth more than a deploy button and carry almost none of the risk,
   so they ship first.

   Everything except /api/health and the login pair requires a session,
   and a session requires two factors. Roles do not exist here — there is
   one operator.
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

/* ---------- .env ----------
   Must come before registry/db.js, which resolves its file path from
   process.env at module load. Shared with setup.js so the two can never
   open different registries. */
const env = require('./env');

const operator = require('./auth/operator');
const health = require('./ops/health');

/* ---------- registry adapter ----------
   Same discipline as the school's serve.js: a native addon that fails to
   load must not take the process down. Here it is more pointed — the
   control plane going dark is how you stop noticing that a school did. */
let reg = null;
let regError = null;
try {
  reg = process.env.REGISTRY_DATABASE_URL ? require('./registry/db_pg') : require('./registry/db');
} catch (e) {
  regError = String(e.message || e).split('\n')[0];
}

const PORT = Number(process.argv[2]) || Number(process.env.SYSADMIN_PORT) || 5590;
const HOST = process.env.SYSADMIN_HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const MAX_BODY = 256 * 1024;

function json(res, code, body, headers = {}) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...headers
  });
  res.end(buf);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); reject(Object.assign(new Error('too large'), { code: 'too_large' })); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('invalid JSON'), { code: 'bad_json' })); }
    });
    req.on('error', reject);
  });
}

/* ---------- API ---------- */
async function handleApi(req, res, url) {
  /* Liveness of the control plane itself. Says nothing about schools. */
  if (url === '/api/health') {
    return json(res, 200, { ok: !!reg, regError, stage: 1, readOnly: true });
  }

  if (!reg) {
    return json(res, 503, {
      error: 'no_registry',
      message: regError || 'No registry adapter loaded.',
      hint: 'npm install, or set REGISTRY_DATABASE_URL for Postgres.'
    });
  }

  /* The allowlist, when configured, applies before anything else. */
  if (!operator.ipAllowed(req)) {
    await reg.audit({ action: 'access.blocked', ok: false, detail: 'ip not allowlisted', ip: operator.clientIp(req) });
    return json(res, 403, { error: 'forbidden' });
  }

  /* Has an operator been created yet — the login screen asks first. */
  if (url === '/api/status') {
    return json(res, 200, {
      ready: (await reg.countOperators()) > 0,
      stage: 1,
      readOnly: true,
      /* So the login page can say so out loud. An insecure state that is
         not visible is one you forget you left on. */
      noSecondFactor: operator.bypassAllowed()
    });
  }

  /* ---- step 1: password -> challenge ---- */
  if (url === '/api/login' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const r = await operator.beginLogin(reg, body.username, body.password, req);
    if (!r.ok) {
      if (r.locked) return json(res, 429, { error: 'locked', message: 'Too many failed attempts. Try later.', until: r.until });
      /* Same answer for an unknown operator and a wrong password. */
      return json(res, 401, { error: 'bad_credentials', message: 'That username and password do not match.' });
    }
    /* SYSADMIN_SKIP_2FA — a session straight from the password. */
    if (r.bypassed) {
      return json(res, 200, { bypassed: true, operator: r.operator }, { 'Set-Cookie': r.cookie });
    }
    if (r.factor === 'none') {
      return json(res, 500, { error: 'no_second_factor', message: 'This operator has no TOTP secret. Re-run sysadmin/setup.js.' });
    }
    return json(res, 200, { challenge: true, factor: r.factor }, { 'Set-Cookie': r.cookie });
  }

  /* ---- step 2: second factor -> session ---- */
  if (url === '/api/login/verify' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const r = await operator.completeLogin(reg, body.code, req);
    if (!r.ok) {
      const map = {
        no_challenge: [401, 'Start again from the password.'],
        expired: [401, 'That challenge expired. Start again.'],
        rebound: [401, 'Start again from the password.'],
        exhausted: [429, 'Too many wrong codes. Start again.'],
        bad_code: [401, 'That code is not right.']
      };
      const [code, message] = map[r.reason] || [401, 'Sign in failed.'];
      return json(res, code, { error: r.reason, message });
    }
    return json(res, 200,
      { operator: r.operator, factor: r.factor, warnRecovery: r.warnRecovery },
      { 'Set-Cookie': [r.cookie, r.clearChallenge] });
  }

  /* ---- everything below needs a two-factor session ---- */
  const op = await operator.currentOperator(req, reg);
  if (!op) return json(res, 401, { error: 'unauthenticated', message: 'Sign in first.' });

  if (url === '/api/me') return json(res, 200, { operator: { username: op.username, name: op.name } });

  if (url === '/api/logout' && req.method === 'POST') {
    await reg.deleteSession(op.token);
    await reg.audit({ actor: op.username, action: 'logout', ok: true, ip: operator.clientIp(req) });
    return json(res, 200, { ok: true },
      { 'Set-Cookie': operator.cookieHeader(operator.COOKIE, '', req, { clear: true }) });
  }

  /* ---- the fleet ---- */
  if (url === '/api/fleet' && req.method === 'GET') {
    const [schools, snaps] = await Promise.all([reg.listSchools(), reg.listHealth()]);
    return json(res, 200, {
      schools: schools.map(s => ({
        ...s,
        health: snaps[s.id] || null,
        verdict: health.verdict(snaps[s.id])
      }))
    });
  }

  /* Poll now. A read against each school's public endpoints — the only
     outbound call stage 1 makes, and it carries no credential. */
  if (url === '/api/fleet/poll' && req.method === 'POST') {
    const results = await health.pollAll(reg);
    await reg.audit({ actor: op.username, action: 'fleet.poll', ok: true,
                      detail: `${results.length} schools`, ip: operator.clientIp(req) });
    return json(res, 200, { polled: results.length, results });
  }

  if (url === '/api/audit' && req.method === 'GET') {
    return json(res, 200, { entries: await reg.listAudit(200) });
  }

  /* Registry bookkeeping. This edits the control plane's own notes about
     where a school lives; it does not touch the school. Provisioning and
     retirement — which do — are stage 4, deliberately not here. */
  if (url === '/api/schools' && req.method === 'POST') {
    const body = await readJsonBody(req);
    if (!body.id || !body.name || !body.url) {
      return json(res, 400, { error: 'missing_fields', message: 'id, name and url are required.' });
    }
    if (!/^https?:\/\//i.test(body.url)) {
      return json(res, 400, { error: 'bad_url', message: 'url must start with http:// or https://' });
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(body.id)) {
      return json(res, 400, { error: 'bad_id', message: 'id must be a lowercase slug.' });
    }
    await reg.putSchool(body);
    await reg.audit({ actor: op.username, action: 'registry.school.put', target: body.id, ok: true,
                      detail: body.url, ip: operator.clientIp(req) });
    return json(res, 200, { ok: true });
  }

  /* Removes the row from the registry. It does NOT touch the deployment:
     retiring a school for real is stage 4, and it exports and verifies a
     backup before anything is destroyed. */
  if (url.startsWith('/api/schools/') && req.method === 'DELETE') {
    const id = decodeURIComponent(url.slice('/api/schools/'.length));
    await reg.deleteSchool(id);
    await reg.audit({ actor: op.username, action: 'registry.school.forget', target: id, ok: true,
                      detail: 'registry row only; deployment untouched', ip: operator.clientIp(req) });
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'unknown_endpoint', url });
}

/* ---------- static ---------- */
function handleStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  const normalised = path.normalize(rel).replace(/^([/\\])+/, '');
  const file = path.join(ROOT, 'ui', normalised);

  /* Only ui/ is servable. registry/, auth/, ops/ and data/ hold secrets
     and code and are never reachable over HTTP. */
  const uiRoot = path.join(ROOT, 'ui');
  if (!file.startsWith(uiRoot)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer'
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      if (err.code === 'too_large') return json(res, 413, { error: 'too_large' });
      if (err.code === 'bad_json') return json(res, 400, { error: 'bad_json' });
      console.error('  sysadmin error:', err);
      return json(res, 500, { error: 'server_error' });
    }
    return;
  }
  handleStatic(req, res);
});

async function start() {
  if (reg) {
    await reg.init();
    await reg.purgeSessions();
    if (await reg.countOperators() === 0) {
      console.log('  No operator yet. Create one:  node sysadmin/setup.js init <username>');
    }
  }
  server.listen(PORT, HOST, () => {
    console.log(`\n  Control plane   http://${HOST}:${PORT}`);
    console.log(`  Registry        ${reg ? reg.describe() : 'NONE — ' + regError}`);
    console.log('  Stage 1         read-only: fleet view, health, audit');
    if (operator.bypassAllowed()) {
      console.log('\n  ****  SYSADMIN_SKIP_2FA=1 — NO SECOND FACTOR  ****');
      console.log('  A password alone opens a session. Local testing only;');
      console.log('  this flag is refused when NODE_ENV=production.');
      console.log('  Unset it to restore two-factor sign-in.');
    }
    console.log('');
  });
}

if (require.main === module) {
  start().catch(err => { console.error('\n  Failed to start:', err.message, '\n'); process.exit(1); });
}

module.exports = { server, start };
