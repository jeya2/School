/* ============================================================
   Tests for the server: sessions, roles, provisioning, persistence.

       node tests/server.test.js

   Starts a real server on a spare port against a throwaway SQLite file,
   drives it over HTTP the way the browser does, and deletes the file
   afterwards. No mocks — the point is to prove the actual boundary,
   because everything these tests cover is what stands between a URL and
   a school's children's records.

   Skips itself with a clear message if better-sqlite3 could not load,
   since that is an optional native dependency.
   ============================================================ */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_FILE = 'test-' + process.pid + '.db';
const DB_PATH = path.join(ROOT, 'data', DB_FILE);
const PORT = 5600 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
function ok(label, cond, extra = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '   ' + extra : ''}`);
}
const section = t => console.log(`\n── ${t} ──`);

try { require('better-sqlite3'); }
catch {
  console.log('SKIP  server tests — better-sqlite3 is not installed (optional native dependency)');
  process.exit(0);
}

/* A minimal cookie jar: Node's fetch does not keep one. */
function jar() {
  let cookie = null;
  return {
    get header() { return cookie ? { Cookie: cookie } : {}; },
    take(res) {
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
    }
  };
}

async function call(session, method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...session.header },
    body: body ? JSON.stringify(body) : undefined
  });
  session.take(res);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

async function waitForServer(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

let child;
function cleanup() {
  if (child && !child.killed) child.kill();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch { /* already gone */ }
  }
}

(async () => {
  /* Provision an admin before the server starts, the way an operator would. */
  const env = { ...process.env, SCHOOL_DB: DB_FILE, FORCE_INSECURE_COOKIE: '1' };
  delete env.DATABASE_URL; delete env.PG_CONNECTION; delete env.USE_PG;

  const provision = spawn(process.execPath,
    [path.join('server', 'provision.js'), 'admin', 'headtchr', 'a-good-password'],
    { cwd: ROOT, env, stdio: 'ignore' });
  await new Promise(r => provision.on('exit', r));

  child = spawn(process.execPath, ['serve.js', String(PORT)], { cwd: ROOT, env, stdio: 'ignore' });
  if (!await waitForServer()) {
    console.error('FAIL  server did not start');
    cleanup();
    process.exit(1);
  }

  const admin = jar(), teacher = jar(), parent = jar(), anon = jar();

  /* ══════════════ unauthenticated ══════════════ */
  section('unauthenticated access');
  ok('health is public', (await call(anon, 'GET', '/api/health')).status === 200);
  ok('status is public', (await call(anon, 'GET', '/api/status')).status === 200);
  ok('bootstrap needs a session', (await call(anon, 'GET', '/api/bootstrap')).status === 401);
  ok('data needs a session', (await call(anon, 'GET', '/api/data')).status === 401);
  ok('users needs a session', (await call(anon, 'GET', '/api/users')).status === 401);
  ok('collection write needs a session',
    (await call(anon, 'PUT', '/api/collection/students', { data: [] })).status === 401);

  /* ══════════════ sign in ══════════════ */
  section('sign in');
  ok('wrong password is refused', (await call(anon, 'POST', '/api/login',
    { username: 'headtchr', password: 'nope' })).status === 401);
  ok('unknown user is refused', (await call(anon, 'POST', '/api/login',
    { username: 'nobody', password: 'nope' })).status === 401);

  const bad = await call(anon, 'POST', '/api/login', { username: 'nobody', password: 'x' });
  const wrong = await call(anon, 'POST', '/api/login', { username: 'headtchr', password: 'x' });
  ok('unknown user and wrong password are indistinguishable',
    bad.data.error === wrong.data.error, bad.data.error);

  const signedIn = await call(admin, 'POST', '/api/login', { username: 'headtchr', password: 'a-good-password' });
  ok('correct password signs in', signedIn.status === 200 && signedIn.data.user.role === 'admin');
  ok('the session works', (await call(admin, 'GET', '/api/me')).status === 200);

  /* ══════════════ provisioning ══════════════ */
  section('provisioning');
  const demo = await call(admin, 'POST', '/api/provision/demo');
  ok('the sample school imports', demo.status === 200, `${demo.data.summary?.students} students`);

  const boot = await call(admin, 'GET', '/api/bootstrap');
  ok('bootstrap returns the school', boot.data.school.name === 'School X');
  ok('bootstrap returns the roll', boot.data.data.students.length === 390);
  ok('bootstrap returns marks', Object.keys(boot.data.data.marks).length > 3000);
  ok('the anchor student survived the round trip',
    boot.data.data.students.some(s => s.id === 'S4102' && s.name === 'Karthik Raja'));

  const badFile = await call(admin, 'POST', '/api/provision/validate', {
    school: { short: 'No name' },
    students: [{ id: 'A', name: 'X', cls: 'X' }, { id: 'A', name: 'Y', cls: 'ZZZ' }]
  });
  ok('a broken file is reported, not accepted', badFile.data.ok === false);
  ok('duplicate ids are caught', badFile.data.errors.some(e => /duplicate/i.test(e)));
  ok('an unknown class is caught', badFile.data.errors.some(e => /class outside/i.test(e)));
  ok('a missing school name is caught', badFile.data.errors.some(e => /school\.name/i.test(e)));

  const refused = await call(admin, 'POST', '/api/provision/import', {
    school: { short: 'No name' }, students: []
  });
  ok('importing a broken file is refused', refused.status === 422);
  const after = await call(admin, 'GET', '/api/students');
  ok('a refused import changes nothing', after.data.length === 390, `${after.data.length} students`);

  /* ══════════════ persistence ══════════════ */
  section('persistence');
  const notices = [{ id: 'N1', title: 'Sports day', date: '2026-09-01', body: 'x', to: 'All', by: 'Office' }];
  ok('a collection saves', (await call(admin, 'PUT', '/api/collection/notices', { data: notices })).status === 200);
  const readBack = await call(admin, 'GET', '/api/collection/notices');
  ok('and reads back identically', JSON.stringify(readBack.data.data) === JSON.stringify(notices));
  ok('an unknown collection is refused',
    (await call(admin, 'PUT', '/api/collection/nonsense', { data: [] })).status === 404);

  /* ══════════════ roles ══════════════ */
  section('roles are enforced on the server');
  await call(admin, 'POST', '/api/users',
    { username: 'kavitha', password: 'teacher-password', name: 'M. Kavitha', role: 'teacher' });
  await call(admin, 'POST', '/api/users',
    { username: 'guardian', password: 'parent-password', name: 'S. Murugesan', role: 'parent', sid: 'S4102' });
  await call(teacher, 'POST', '/api/login', { username: 'kavitha', password: 'teacher-password' });
  await call(parent, 'POST', '/api/login', { username: 'guardian', password: 'parent-password' });

  ok('a teacher may read the school', (await call(teacher, 'GET', '/api/bootstrap')).status === 200);
  ok('a teacher may save a register',
    (await call(teacher, 'PUT', '/api/collection/attendance', { data: {} })).status === 200);
  ok('a teacher may not list accounts', (await call(teacher, 'GET', '/api/users')).status === 403);
  ok('a teacher may not import a school',
    (await call(teacher, 'POST', '/api/provision/demo')).status === 403);
  ok('a teacher may not wipe the school',
    (await call(teacher, 'POST', '/api/provision/wipe')).status === 403);
  ok('a parent may not write',
    (await call(parent, 'PUT', '/api/collection/students', { data: [] })).status === 403);
  ok('a parent may not edit the school profile',
    (await call(parent, 'PUT', '/api/school', { name: 'Mine now' })).status === 403);

  /* ══════════════ a parent reads ONE child ══════════════
     Refusing the write was only ever half the rule. The browser narrows
     the roll to the family's own child, but the browser is a
     convenience: every read route has to narrow it too, or a parent who
     opens the network tab reads every other child's Aadhaar, address and
     guardian's mobile number. Every read path is asserted separately —
     one of them being scoped is not the same as all of them being. */
  section('a parent reads one child and no more');
  const staffRoll = (await call(admin, 'GET', '/api/bootstrap')).data.data.students;
  ok('the school has a roll worth protecting', staffRoll.length > 1, `${staffRoll.length} students`);

  const pBoot = await call(parent, 'GET', '/api/bootstrap');
  ok('a parent may read', pBoot.status === 200);
  ok('bootstrap carries only their child',
    pBoot.data.data.students.length === 1 && pBoot.data.data.students[0].id === 'S4102',
    `${pBoot.data.data.students.length} of ${staffRoll.length}`);
  ok('no other child appears anywhere in the payload',
    !JSON.stringify(pBoot.data).includes(staffRoll.find(s => s.id !== 'S4102').id));

  const pData = await call(parent, 'GET', '/api/data');
  ok('/api/data is scoped too', pData.data.students.length === 1);
  const pColl = await call(parent, 'GET', '/api/collection/students');
  ok('/api/collection/students is scoped too', pColl.data.data.length === 1);
  const pList = await call(parent, 'GET', '/api/students');
  ok('/api/students is scoped too', pList.data.length === 1);

  const someoneElse = staffRoll.find(s => s.id !== 'S4102').id;
  ok('a parent may read their own child by id',
    (await call(parent, 'GET', '/api/students/S4102')).status === 200);
  ok('a parent may not read another child by id',
    (await call(parent, 'GET', `/api/students/${someoneElse}`)).status === 403);

  ok('marks are narrowed to their child',
    Object.keys(pBoot.data.data.marks).every(k => k.startsWith('S4102|')));
  ok('receipts are narrowed to their child',
    (pBoot.data.data.receipts || []).every(r => r.sid === 'S4102'));
  ok('the attendance history holds one child',
    Object.keys(pBoot.data.data.attHistory).every(k => k === 'S4102'));
  ok('class day-registers are withheld entirely',
    Object.keys(pBoot.data.data.attendance || {}).length === 0);
  ok('other families\' admission applications are withheld',
    (pBoot.data.data.applications || []).length === 0);

  ok('a teacher still sees the whole roll',
    (await call(teacher, 'GET', '/api/bootstrap')).data.data.students.length === staffRoll.length);

  /* ══════════════ passwords ══════════════ */
  section('passwords');
  ok('a short password is refused', (await call(admin, 'POST', '/api/users',
    { username: 'weak', password: 'short', name: 'W', role: 'teacher' })).status === 400);
  ok('a short password change is refused',
    (await call(teacher, 'POST', '/api/password', { password: 'short' })).status === 400);
  ok('a user may change their own password',
    (await call(teacher, 'POST', '/api/password', { password: 'a-longer-password' })).status === 200);
  const stale = await call(teacher, 'GET', '/api/me');
  ok('the existing session survives a password change', stale.status === 200);
  const fresh = jar();
  ok('the new password works',
    (await call(fresh, 'POST', '/api/login', { username: 'kavitha', password: 'a-longer-password' })).status === 200);
  ok('the old password no longer works',
    (await call(jar(), 'POST', '/api/login', { username: 'kavitha', password: 'teacher-password' })).status === 401);
  ok('an admin cannot delete their own account',
    (await call(admin, 'DELETE', '/api/users/headtchr')).status === 400);

  /* ══════════════ no student data leaks without a session ══════════════ */
  section('leakage');
  const pub = await call(jar(), 'GET', '/api/status');
  const text = JSON.stringify(pub.data);
  ok('the public status carries no student records',
    !/Karthik|S4102|aadhaar/i.test(text), text.slice(0, 80));

  /* ══════════════ sign out ══════════════ */
  section('sign out');
  ok('logout succeeds', (await call(admin, 'POST', '/api/logout')).status === 200);
  ok('the session is dead afterwards', (await call(admin, 'GET', '/api/me')).status === 401);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error('FAIL  the suite threw:', err);
  cleanup();
  process.exit(1);
});
