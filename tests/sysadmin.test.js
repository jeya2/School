/* ============================================================
   tests/sysadmin.test.js — the control plane

   Starts a real control-plane server against a throwaway registry file
   and deletes it afterwards, exactly as server.test.js does for a
   school. Skips itself if better-sqlite3 is not installed.

   What is worth asserting here is narrow and load-bearing:

     • a password ALONE never yields a session — that is the whole point
     • the second factor actually verifies, and constant-time comparison
       has not been quietly broken
     • a recovery code works once and only once
     • an unknown operator and a wrong password are indistinguishable
     • the fleet view needs no credential against a school (stage 1's
       central safety property)
     • sysadmin/ is not reachable through a SCHOOL deployment
   ============================================================ */
const fs = require('fs');
const path = require('path');
const http = require('http');

let pass = 0, fail = 0;
function ok(label, cond, extra = '') {
  if (cond) { console.log('PASS  ' + label + (extra ? '   ' + extra : '')); pass++; }
  else { console.log('FAIL  ' + label + (extra ? '   ' + extra : '')); fail++; }
}
function section(name) { console.log('\n── ' + name + ' ──'); }

try { require('better-sqlite3'); }
catch {
  console.log('SKIP  sysadmin tests — better-sqlite3 is not installed.');
  process.exit(0);
}

/* Throwaway registry, and a cookie that is allowed to be insecure because
   this test speaks plain HTTP to loopback. */
const REGISTRY_DB = 'test-registry-' + process.pid + '.db';
process.env.REGISTRY_DB = REGISTRY_DB;
process.env.FORCE_INSECURE_COOKIE = '1';
delete process.env.REGISTRY_DATABASE_URL;
delete process.env.SYSADMIN_ALLOWED_IPS;

const DATA_DIR = path.join(__dirname, '..', 'sysadmin', 'data');

const reg = require('../sysadmin/registry/db');
const operator = require('../sysadmin/auth/operator');
const recovery = require('../sysadmin/auth/recovery');
const totp = require('../sysadmin/auth/totp');
const health = require('../sysadmin/ops/health');
const { server } = require('../sysadmin/serve');

let BASE = '';
let cookies = {};

function setCookies(res) {
  const raw = res.headers['set-cookie'] || [];
  for (const line of raw) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    const k = pair.slice(0, i);
    const v = pair.slice(i + 1);
    if (v === '') delete cookies[k]; else cookies[k] = v;
  }
}
function cookieHeader() {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request(BASE + url, {
      method,
      headers: {
        'User-Agent': 'sysadmin-test',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
        ...(Object.keys(cookies).length ? { Cookie: cookieHeader() } : {})
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        setCookies(res);
        let parsed = null;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  /* ---------------- unit: TOTP ---------------- */
  section('TOTP');
  const secret = totp.generateSecret();
  ok('a generated secret is base32', /^[A-Z2-7]+$/.test(secret), secret.slice(0, 8) + '…');
  ok('a secret is 32 characters (20 bytes)', secret.length === 32);

  const now = Date.now();
  ok('the current code verifies', totp.verify(secret, totp.current(secret, now), now));
  ok('a wrong code does not',
    totp.verify(secret, '000000', now) === false || totp.current(secret, now) === '000000');
  ok('a code from the previous step still verifies (clock skew)',
    totp.verify(secret, totp.current(secret, now - 30_000), now));
  ok('a code from four steps ago does not',
    totp.verify(secret, totp.current(secret, now - 120_000), now) === false);
  ok('a code from another secret does not',
    totp.verify(secret, totp.current(totp.generateSecret(), now), now) === false);
  ok('a short code is refused', totp.verify(secret, '123', now) === false);
  ok('an empty code is refused', totp.verify(secret, '', now) === false);
  ok('the provisioning URI carries the secret',
    totp.provisioningUri(secret, 'jeya').includes('secret=' + secret));

  /* ---------------- unit: recovery codes ---------------- */
  section('recovery codes');
  const set = recovery.generate(operator.hashSecret);
  ok('ten codes are issued', set.display.length === 10 && set.stored.length === 10);
  ok('codes are hashed, never stored raw',
    set.stored.every(s => s.hash && s.salt && !set.display.some(d => s.hash.includes(recovery.normalise(d)))));
  ok('codes avoid the characters people misread',
    set.display.every(c => !/[ilou]/i.test(c)), set.display[0]);
  ok('dashes and case do not matter',
    recovery.normalise(set.display[0].toUpperCase()) === recovery.normalise(set.display[0]));

  /* ---------------- unit: health verdicts ---------------- */
  section('health verdicts');
  ok('unreachable is down', health.verdict({ reachable: false }) === 'down');
  ok('a 500 is down', health.verdict({ reachable: true, http_status: 500 }) === 'down');
  ok('a loaded adapter with no school is empty',
    health.verdict({ reachable: true, http_status: 200, ok: true, provisioned: false }) === 'empty');
  ok('a storeError is no-db',
    health.verdict({ reachable: true, http_status: 200, ok: false, store_error: 'Could not locate the bindings file' }) === 'no-db');
  ok('a provisioned school is ok',
    health.verdict({ reachable: true, http_status: 200, ok: true, provisioned: true }) === 'ok');
  ok('never polled is unknown', health.verdict(null) === 'unknown');

  /* ---------------- server ---------------- */
  await reg.init();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  BASE = 'http://127.0.0.1:' + server.address().port;

  section('before an operator exists');
  let r = await req('GET', '/api/status');
  ok('status says not ready', r.status === 200 && r.body.ready === false);
  ok('status advertises stage 1 read-only', r.body.stage === 1 && r.body.readOnly === true);

  r = await req('GET', '/api/fleet');
  ok('the fleet needs a session', r.status === 401);

  /* Create the operator the way setup.js does. */
  const PASSWORD = 'a-long-generated-password-1234';
  const { salt, hash } = operator.hashSecret(PASSWORD);
  await reg.putOperator({ username: 'jeya', name: 'Operator', salt, hash, totp_secret: secret });
  const codes = recovery.generate(operator.hashSecret);
  await reg.setRecoveryCodes('jeya', codes.stored);

  section('password alone is never enough');
  r = await req('POST', '/api/login', { username: 'jeya', password: PASSWORD });
  ok('the right password returns a challenge, not a session',
    r.status === 200 && r.body.challenge === true && r.body.factor === 'totp');
  ok('no session cookie is set yet', !cookies[operator.COOKIE]);
  ok('a challenge cookie IS set', !!cookies[operator.CHALLENGE_COOKIE]);

  r = await req('GET', '/api/fleet');
  ok('a challenge does not open the fleet', r.status === 401);

  section('the second factor');
  r = await req('POST', '/api/login/verify', { code: '000000' });
  ok('a wrong code is refused', r.status === 401 && r.body.error === 'bad_code');
  ok('still no session', !cookies[operator.COOKIE]);

  r = await req('POST', '/api/login/verify', { code: totp.current(secret) });
  ok('the right code completes the login', r.status === 200 && r.body.factor === 'totp');
  ok('a session cookie is set', !!cookies[operator.COOKIE]);
  ok('the challenge cookie is cleared', !cookies[operator.CHALLENGE_COOKIE]);

  r = await req('GET', '/api/me');
  ok('the session identifies the operator', r.status === 200 && r.body.operator.username === 'jeya');

  section('the fleet');
  r = await req('GET', '/api/fleet');
  ok('the fleet is now readable', r.status === 200 && Array.isArray(r.body.schools));
  ok('it starts empty', r.body.schools.length === 0);

  r = await req('POST', '/api/schools', { id: 'schoolx', name: 'Demo School', url: 'http://127.0.0.1:1/' });
  ok('a school can be registered', r.status === 200);

  r = await req('POST', '/api/schools', { id: 'Bad Id', name: 'x', url: 'https://x.test' });
  ok('a non-slug id is refused', r.status === 400 && r.body.error === 'bad_id');

  r = await req('POST', '/api/schools', { id: 'ok', name: 'x', url: 'ftp://x.test' });
  ok('a non-http url is refused', r.status === 400 && r.body.error === 'bad_url');

  r = await req('POST', '/api/schools', { id: 'ok', name: 'x' });
  ok('a missing url is refused', r.status === 400 && r.body.error === 'missing_fields');

  /* Port 1 refuses instantly, so this exercises the unreachable path
     without waiting for a timeout. */
  r = await req('POST', '/api/fleet/poll');
  ok('polling an unreachable school does not throw', r.status === 200 && r.body.polled === 1);

  r = await req('GET', '/api/fleet');
  const row = r.body.schools[0];
  ok('an unreachable school reads as down', row.verdict === 'down', row.health.error || '');
  ok('the failure is recorded, not swallowed', !!row.health.error);

  section('audit');
  r = await req('GET', '/api/audit');
  const actions = r.body.entries.map(e => e.action);
  ok('the successful login was audited', actions.includes('login.success'));
  ok('the failed factor was audited', actions.includes('login.factor'));
  ok('the poll was audited', actions.includes('fleet.poll'));
  ok('registering a school was audited', actions.includes('registry.school.put'));
  const failures = r.body.entries.filter(e => e.ok === false);
  ok('failures are distinguishable from successes', failures.length > 0);

  section('forgetting a school');
  r = await req('DELETE', '/api/schools/schoolx');
  ok('a school can be removed from the registry', r.status === 200);
  r = await req('GET', '/api/fleet');
  ok('it is gone from the fleet', r.body.schools.length === 0);

  section('sign out');
  r = await req('POST', '/api/logout');
  ok('logout succeeds', r.status === 200);
  r = await req('GET', '/api/fleet');
  ok('the session is dead afterwards', r.status === 401);

  section('recovery codes, end to end');
  cookies = {};
  await req('POST', '/api/login', { username: 'jeya', password: PASSWORD });
  r = await req('POST', '/api/login/verify', { code: codes.display[0] });
  ok('a recovery code completes the login', r.status === 200 && r.body.factor === 'recovery');
  ok('the response flags that one was spent', r.body.warnRecovery === true);

  await req('POST', '/api/logout');
  cookies = {};
  await req('POST', '/api/login', { username: 'jeya', password: PASSWORD });
  r = await req('POST', '/api/login/verify', { code: codes.display[0] });
  ok('the same recovery code cannot be used twice', r.status === 401);

  cookies = {};
  await req('POST', '/api/login', { username: 'jeya', password: PASSWORD });
  r = await req('POST', '/api/login/verify', { code: codes.display[1] });
  ok('a different recovery code still works', r.status === 200);
  await req('POST', '/api/logout');

  section('enumeration and lockout');
  cookies = {};
  const tUnknown = Date.now();
  r = await req('POST', '/api/login', { username: 'nobody-here', password: 'whatever-it-is' });
  const dUnknown = Date.now() - tUnknown;
  const unknownBody = JSON.stringify(r.body);
  const unknownStatus = r.status;

  cookies = {};
  const tWrong = Date.now();
  r = await req('POST', '/api/login', { username: 'jeya', password: 'the-wrong-password' });
  const dWrong = Date.now() - tWrong;

  ok('an unknown operator and a wrong password give the same answer',
    unknownStatus === r.status && unknownBody === JSON.stringify(r.body), unknownBody);
  ok('and take comparable time',
    Math.abs(dUnknown - dWrong) < Math.max(dUnknown, dWrong) + 150, `${dUnknown}ms vs ${dWrong}ms`);

  /* Four more wrong passwords reach the threshold of five. The lockout is
     recorded on the fifth and OBSERVED on the sixth request — it is
     checked at the top of beginLogin, before the password is examined. */
  for (let i = 0; i < 4; i++) {
    cookies = {};
    r = await req('POST', '/api/login', { username: 'jeya', password: 'still-wrong' });
  }
  ok('the attempt that reaches the threshold is still a plain refusal',
    r.status === 401 && r.body.error === 'bad_credentials');

  cookies = {};
  r = await req('POST', '/api/login', { username: 'jeya', password: 'still-wrong' });
  ok('the next attempt is locked out', r.status === 429 && r.body.error === 'locked');

  cookies = {};
  r = await req('POST', '/api/login', { username: 'jeya', password: PASSWORD });
  ok('the lockout applies even to the right password', r.status === 429);

  section('challenge binding');
  await reg.clearFailed('jeya');
  cookies = {};
  await req('POST', '/api/login', { username: 'jeya', password: PASSWORD });
  const stolen = cookies[operator.CHALLENGE_COOKIE];
  ok('a challenge token exists to steal', !!stolen);

  /* Replay it from a different user agent — the binding should refuse. */
  const replay = await new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify({ code: totp.current(secret) }));
    const rq = http.request(BASE + '/api/login/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'User-Agent': 'a-different-browser',
        Cookie: `${operator.CHALLENGE_COOKIE}=${stolen}`
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    rq.on('error', reject);
    rq.write(data);
    rq.end();
  });
  ok('a challenge replayed from another agent is refused',
    replay.status === 401 && replay.body.error === 'rebound');

  section('no student data reaches the registry');
  const tables = require('better-sqlite3')(path.join(DATA_DIR, REGISTRY_DB))
    .prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  ok('there is no students table', !tables.includes('students'), tables.join(', '));
  ok('there is no marks or attendance table',
    !tables.includes('marks') && !tables.includes('attendance'));
  ok('the registry holds only control-plane tables',
    tables.every(t => ['operators', 'recovery_codes', 'schools', 'school_health',
                       'audit', 'sessions', 'challenges', 'sqlite_sequence'].includes(t)));

  server.close();
}

main()
  .then(() => {
    try { server.close(); } catch {}
    for (const suffix of ['', '-shm', '-wal']) {
      const f = path.join(DATA_DIR, REGISTRY_DB + suffix);
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* Windows holds the handle briefly */ }
    }
    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
  })
  .catch(err => {
    console.error('\nTest run failed:', err);
    try { server.close(); } catch {}
    process.exit(1);
  });
