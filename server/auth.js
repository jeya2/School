/* ============================================================
   server/auth.js — accounts and sessions

   The portal holds children's names, addresses, phone numbers and
   Aadhaar. Under the DPDP Act 2023 that is personal data of children,
   and it may not sit behind a login that accepts any password. This
   module is what makes the deployment safe to put on a URL.

   Design:

   • Passwords are hashed with scrypt and a 16-byte per-user salt. scrypt
     is memory-hard and ships with Node, so there is no new dependency
     and no home-made hashing.
   • Comparison is constant time. A fast "wrong password" answer and a
     slow one leak the length of the common prefix.
   • Sessions are opaque 32-byte random tokens stored server-side. The
     browser gets an HttpOnly cookie, so a cross-site script cannot read
     it, and revoking a session is a DELETE rather than a hope.
   • Unknown username and wrong password give the same error and take
     about the same time, so the login cannot be used to enumerate staff.
   ============================================================ */
const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);
const COOKIE = 'ngss_session';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, SCRYPT).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expected) {
  const actual = crypto.scryptSync(String(password), salt, SCRYPT.keylen, SCRYPT);
  const want = Buffer.from(expected, 'hex');
  return actual.length === want.length && crypto.timingSafeEqual(actual, want);
}

/* A dummy verification for unknown usernames, so a missing account costs
   the same time as a wrong password. */
const DUMMY = hashPassword(crypto.randomBytes(8).toString('hex'));
function burnTime() { verifyPassword('x', DUMMY.salt, DUMMY.hash); }

function newToken() { return crypto.randomBytes(32).toString('hex'); }

function expiryFromNow(days = SESSION_DAYS) {
  return new Date(Date.now() + days * 86400_000).toISOString();
}

/** Read our cookie out of a request. */
function tokenFrom(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Cookie header value. Secure is set when the deployment is behind TLS —
 *  most platforms terminate it upstream and tell us via x-forwarded-proto. */
function cookieHeader(token, req, { clear = false } = {}) {
  const secure = process.env.FORCE_INSECURE_COOKIE === '1' ? false
    : (req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production');
  const bits = [
    `${COOKIE}=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    clear ? 'Max-Age=0' : `Max-Age=${SESSION_DAYS * 86400}`
  ];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/** Resolve the session on a request, or null. Expired sessions are removed. */
async function currentUser(req, store) {
  const token = tokenFrom(req);
  if (!token) return null;
  const session = await store.getSession(token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await store.deleteSession(token);
    return null;
  }
  const user = await store.getUser(session.username);
  if (!user) return null;
  return { username: user.username, name: user.name, title: user.title, role: user.role, sid: user.sid, token };
}

/** Sign in. Returns { user, token } or null — the caller must not tell the
 *  browser which half of the credentials was wrong. */
async function login(store, username, password) {
  const user = await store.getUser(String(username || '').trim().toLowerCase());
  if (!user) { burnTime(); return null; }
  if (!verifyPassword(password, user.salt, user.hash)) return null;
  const token = newToken();
  await store.createSession(token, user.username, expiryFromNow());
  return { token, user: { username: user.username, name: user.name, title: user.title, role: user.role, sid: user.sid } };
}

/** Create or replace an account. */
async function putAccount(store, { username, name, title, role, sid, password }) {
  const { salt, hash } = hashPassword(password);
  await store.putUser({
    username: String(username).trim().toLowerCase(),
    name, title: title || null, role, sid: sid || null, salt, hash
  });
}

/** Seed the accounts that come with an imported bundle. Existing accounts
 *  are left alone: an import must never silently reset a password an
 *  operator has already changed. */
async function provisionAccounts(store, accounts = []) {
  let created = 0, skipped = 0;
  for (const a of accounts) {
    if (await store.getUser(String(a.username).toLowerCase())) { skipped++; continue; }
    await putAccount(store, a);
    created++;
  }
  return { created, skipped };
}

module.exports = {
  COOKIE, hashPassword, verifyPassword, newToken, expiryFromNow,
  tokenFrom, cookieHeader, currentUser, login, putAccount, provisionAccounts
};
