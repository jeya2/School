/* ============================================================
   serve.js — static file server + the portal's data API

       node serve.js            -> http://localhost:5490
       node serve.js 8080       -> http://localhost:8080

   One process serves one school. It does two jobs:

   1. Serve the static app (index.html, app.html, assets/).

   2. Answer /api/* : sign-in, the school profile, the school's records,
      and provisioning. The database is the single source of truth — the
      browser caches nothing authoritative, so two members of staff on
      two machines always see the same school.

   Everything under /api except /api/health and /api/login requires a
   session. Provisioning and user management additionally require the
   admin role. Roles are checked here, on the server: the sidebar hiding
   a screen is a convenience, not a control.
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

/* ---------- .env ----------
   A shell variable set with `$env:X = ...` disappears when that window
   closes, which makes "set it and restart" a chore. If a .env file sits
   next to this script, read it — without overriding anything already
   set in the real environment. .env is gitignored; never commit secrets. */
(function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) return;                                   // blank line or # comment
    const key = m[1];
    let val = m[2].trim().replace(/\s+#.*$/, '');     // strip a trailing comment
    if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);   // strip matching quotes
    if (!(key in process.env)) process.env[key] = val;
  });
})();

const auth = require('./server/auth');
const importer = require('./server/importer');

/* ---------- storage adapter ----------
   Postgres when a connection string is present, SQLite otherwise.
   better-sqlite3 is an optionalDependency (it is a native addon with
   prebuilt binaries for only some Node ABIs), so a failure to load is
   reported and the data endpoints answer 503 — the process still starts
   and still serves the site. */
let store = null;
let storeError = null;
try {
  store = (process.env.DATABASE_URL || process.env.PG_CONNECTION || process.env.USE_PG === '1')
    ? require('./server/db_pg')
    : require('./server/db');
} catch (e) {
  storeError = String(e.message || e).split('\n')[0];
}

const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 5490;
/* Bind loopback for local work, every interface when a platform hands us a
   PORT — a container that listens only on 127.0.0.1 is unreachable. */
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');

/* Never serve these over HTTP, whatever the URL says. */
const PRIVATE = ['server', 'node_modules', 'tests', '.git', '.env', 'data', 'migrations'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2'
};

function json(res, code, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(text);
}

/* A school's whole dataset arrives in one request, so the cap is generous —
   but not unbounded, or a single POST could exhaust the container's memory. */
const MAX_BODY = Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { code: 'too_large' }));
        req.destroy();
        return;
      }
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
  if (url === '/api/health') {
    return json(res, 200, {
      ok: !!store,
      adapter: store ? store.adapter : null,
      storeError,
      version: require('./package.json').version
    });
  }

  if (!store) {
    return json(res, 503, {
      error: 'no_database',
      message: storeError || 'No storage adapter loaded.',
      hint: 'Run `npm install`, or set DATABASE_URL to use Postgres.'
    });
  }

  /* ---- sign in / out ---- */
  if (url === '/api/login' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = await auth.login(store, body.username, body.password);
    if (!result) return json(res, 401, { error: 'bad_credentials', message: 'That username and password do not match.' });
    return json(res, 200, { user: result.user }, { 'Set-Cookie': auth.cookieHeader(result.token, req) });
  }

  if (url === '/api/logout' && req.method === 'POST') {
    const token = auth.tokenFrom(req);
    if (token) await store.deleteSession(token);
    return json(res, 200, { ok: true }, { 'Set-Cookie': auth.cookieHeader('', req, { clear: true }) });
  }

  /* Whether this instance has been provisioned yet — the login screen asks
     before showing a password box, so a fresh deployment can say so. */
  if (url === '/api/status') {
    const [users, school] = await Promise.all([store.countUsers(), store.getSchool()]);
    return json(res, 200, {
      provisioned: users > 0 && !!school,
      hasUsers: users > 0,
      school: school ? { name: school.name, short: school.short, year: school.year } : null
    });
  }

  /* ---- everything below needs a session ---- */
  const user = await auth.currentUser(req, store);
  if (!user) return json(res, 401, { error: 'unauthenticated', message: 'Sign in first.' });

  const admin = user.role === 'admin';
  const denied = () => json(res, 403, { error: 'forbidden', message: 'Your role cannot do that.' });

  if (url === '/api/me') return json(res, 200, { user });

  /* Everything the portal needs to paint its first screen, in one round trip. */
  if (url === '/api/bootstrap') {
    const data = await store.exportAll();
    const school = data.school || {};
    delete data.school;
    return json(res, 200, { user, school: { ...school, provisioned: !!school.name }, data });
  }

  if (url === '/api/data') {
    return json(res, 200, await store.exportAll());
  }

  if (url.startsWith('/api/collection/')) {
    const name = decodeURIComponent(url.slice('/api/collection/'.length));
    if (!store.COLLECTIONS.includes(name)) return json(res, 404, { error: 'unknown_collection', name });

    if (req.method === 'GET') return json(res, 200, { name, data: await store.getCollection(name) });

    if (req.method === 'PUT') {
      /* Parents and students read their own child's record; they never write. */
      if (['parent', 'student'].includes(user.role)) return denied();
      const body = await readJsonBody(req);
      if (!('data' in body)) return json(res, 400, { error: 'missing_data' });
      await store.setCollection(name, body.data);
      return json(res, 200, { ok: true, name });
    }
    return json(res, 405, { error: 'method_not_allowed' });
  }

  if (url === '/api/students' && req.method === 'GET') {
    return json(res, 200, (await store.getCollection('students')) || []);
  }
  if (url.startsWith('/api/students/') && req.method === 'GET') {
    const id = decodeURIComponent(url.slice('/api/students/'.length));
    const list = (await store.getCollection('students')) || [];
    const found = list.find(s => s.id === id);
    if (!found) return json(res, 404, { error: 'not_found' });
    return json(res, 200, found);
  }

  /* ---- school profile ---- */
  if (url === '/api/school') {
    if (req.method === 'GET') return json(res, 200, (await store.getSchool()) || {});
    if (req.method === 'PUT') {
      if (!admin) return denied();
      const body = await readJsonBody(req);
      if (!body.name) return json(res, 400, { error: 'name_required' });
      return json(res, 200, await store.setSchool(body));
    }
  }

  /* ---- provisioning (admin only) ---- */
  if (url === '/api/provision/validate' && req.method === 'POST') {
    if (!admin) return denied();
    const body = await readJsonBody(req);
    const report = importer.validate(body);
    return json(res, 200, { ok: report.ok, errors: report.errors, warnings: report.warnings, summary: report.summary });
  }

  if (url === '/api/provision/import' && req.method === 'POST') {
    if (!admin) return denied();
    const body = await readJsonBody(req);
    const report = importer.validate(body);
    if (!report.ok) {
      return json(res, 422, { error: 'invalid_bundle', errors: report.errors, warnings: report.warnings, summary: report.summary });
    }
    await store.importBundle(report.bundle);
    const accounts = await auth.provisionAccounts(store, report.accounts);
    return json(res, 200, { ok: true, summary: report.summary, warnings: report.warnings, accounts });
  }

  if (url === '/api/provision/demo' && req.method === 'POST') {
    if (!admin) return denied();
    const demo = require('./server/demo');
    const bundle = demo.generate();
    const report = importer.validate({ ...bundle, accounts: demo.DEMO_ACCOUNTS });
    if (!report.ok) return json(res, 500, { error: 'demo_invalid', errors: report.errors });
    await store.importBundle(report.bundle);
    const accounts = await auth.provisionAccounts(store, demo.DEMO_ACCOUNTS);
    return json(res, 200, { ok: true, summary: report.summary, accounts });
  }

  if (url === '/api/provision/wipe' && req.method === 'POST') {
    if (!admin) return denied();
    await store.wipe();
    return json(res, 200, { ok: true });
  }

  /* ---- users (admin only) ---- */
  if (url === '/api/users') {
    if (!admin) return denied();
    if (req.method === 'GET') return json(res, 200, await store.listUsers());
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.username || !body.password || !body.role) {
        return json(res, 400, { error: 'missing_fields', message: 'username, password and role are required.' });
      }
      if (String(body.password).length < 8) {
        return json(res, 400, { error: 'weak_password', message: 'Use at least 8 characters.' });
      }
      await auth.putAccount(store, body);
      return json(res, 200, { ok: true, username: String(body.username).toLowerCase() });
    }
  }

  if (url.startsWith('/api/users/') && req.method === 'DELETE') {
    if (!admin) return denied();
    const username = decodeURIComponent(url.slice('/api/users/'.length));
    if (username === user.username) {
      return json(res, 400, { error: 'self_delete', message: 'You cannot delete the account you are signed in with.' });
    }
    const gone = await store.deleteUser(username);
    return json(res, gone ? 200 : 404, gone ? { ok: true } : { error: 'not_found' });
  }

  /* Change your own password; an admin may change anyone's. */
  if (url === '/api/password' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const target = body.username && admin ? String(body.username).toLowerCase() : user.username;
    if (String(body.password || '').length < 8) {
      return json(res, 400, { error: 'weak_password', message: 'Use at least 8 characters.' });
    }
    const existing = await store.getUser(target);
    if (!existing) return json(res, 404, { error: 'not_found' });
    await auth.putAccount(store, {
      username: target, name: existing.name, title: existing.title,
      role: existing.role, sid: existing.sid, password: body.password
    });
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'unknown_endpoint', url });
}

/* ---------- static files ---------- */
function handleStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  const normalised = path.normalize(rel).replace(/^([/\\])+/, '');
  const first = normalised.split(/[/\\]/)[0];
  if (PRIVATE.includes(first)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  const file = path.join(ROOT, normalised);
  if (!file.startsWith(ROOT)) {
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
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
}

function handle(req, res) {
  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) {
    return handleApi(req, res, url).catch(err => {
      if (res.headersSent) return;
      if (err.code === 'bad_json') return json(res, 400, { error: 'bad_json', message: 'The request body was not valid JSON.' });
      if (err.code === 'too_large') return json(res, 413, { error: 'too_large', message: `Larger than ${process.env.MAX_UPLOAD_MB || 25} MB.` });
      console.error('  api error:', err);
      json(res, 500, { error: 'server_error', message: String(err.message || err) });
    });
  }
  handleStatic(req, res);
}

const server = http.createServer(handle);

/* A second listener for IPv6 loopback.

   On Windows, `localhost` usually resolves to ::1 before 127.0.0.1, and a
   browser that picks ::1 gets ECONNREFUSED from a server bound only to the
   IPv4 loopback — the site looks dead while curl, which falls back to IPv4,
   says it is fine. Binding the unspecified address instead would fix it by
   exposing the school's records to the whole network, which is not a trade
   worth making. So: listen on both loopbacks, and on neither anything else.

   Only used for the local default. An explicit HOST, or the 0.0.0.0 that a
   platform-supplied PORT implies, is taken at its word. */
const server6 = http.createServer(handle);

async function start() {
  if (store) {
    try {
      await store.init();
      await store.purgeSessions();

      /* First-boot bootstrap for platforms where running a one-off command is
         awkward. Only ever fires on an instance with no accounts at all, so it
         cannot overwrite a password an operator has already set. */
      if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD && await store.countUsers() === 0) {
        await auth.putAccount(store, {
          username: process.env.ADMIN_USERNAME,
          password: process.env.ADMIN_PASSWORD,
          name: process.env.ADMIN_NAME || process.env.ADMIN_USERNAME,
          title: 'Administrator',
          role: 'admin'
        });
        console.log(`  Created the first administrator from ADMIN_USERNAME: ${process.env.ADMIN_USERNAME}`);
      }
    } catch (e) {
      storeError = String(e.message || e).split('\n')[0];
      console.error('  Database init failed:', storeError);
    }
  }

  /* Fail loudly on the usual "it just closed" causes rather than exiting silently. */
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${PORT} is already in use. Stop the other process, or run: node serve.js ${PORT + 1}\n`);
    } else {
      console.error('\n  Could not start:', err.message, '\n');
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, async () => {
    /* Cover IPv6 loopback too when we are serving locally. Not every machine
       has ::1, so a failure here is logged and shrugged off — the IPv4
       listener above is the one that must work. */
    if (HOST === '127.0.0.1') {
      server6.on('error', err => {
        if (!['EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EADDRINUSE'].includes(err.code)) {
          console.error('  IPv6 loopback unavailable:', err.message);
        }
      });
      try { server6.listen(PORT, '::1'); } catch { /* IPv4 only is fine */ }
    }

    const school = store && !storeError ? await store.getSchool().catch(() => null) : null;
    const users = store && !storeError ? await store.countUsers().catch(() => 0) : 0;
    console.log(`\n  ${school ? school.name : 'School Management Portal'} — running\n`);
    console.log(`    http://${HOST === '0.0.0.0' ? 'localhost' : HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}\n`);
    console.log(`  Database    : ${store ? store.describe() : 'none'}`);
    if (storeError) console.log(`  DB error    : ${storeError}`);
    if (store && !storeError) {
      console.log(`  School      : ${school ? school.name : 'not provisioned — import a school file to begin'}`);
      console.log(`  Accounts    : ${users}${users ? '' : ' — create the first admin with `node server/provision.js`'}`);
    }
    console.log(`  Press Ctrl+C to stop.\n`);
  });
}

start();
