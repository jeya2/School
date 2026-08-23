/* ============================================================
   sysadmin/auth/operator.js — the single operator's credentials

   One account stands between the internet and every school hosted here,
   and there is no colleague who would notice it being misused. That
   shapes every decision in this file.

   Two steps, always:

     1. username + password        → a CHALLENGE, not a session
     2. TOTP code or recovery code → a session

   Password alone never yields a session. A challenge is bound to the IP
   and user agent that created it, lives five minutes, and dies after
   three wrong codes.

   Inherited from server/auth.js, because they were right there:
   scrypt with a per-account salt, constant-time comparison, opaque
   server-side sessions, and an unknown username costing the same time as
   a wrong password.

   Different from server/auth.js on purpose:
   • sessions are 30 minutes idle / 8 hours absolute, not 7 days
   • a password is never sufficient
   • every attempt, successful or not, is audited
   ============================================================ */
const crypto = require('crypto');
const totp = require('./totp');
const recovery = require('./recovery');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const COOKIE = 'bnl_sys';
const CHALLENGE_COOKIE = 'bnl_sys_chal';

const CHALLENGE_MINUTES = 5;
const CHALLENGE_ATTEMPTS = 3;
const IDLE_MINUTES = Number(process.env.SYSADMIN_IDLE_MINUTES || 30);
const ABSOLUTE_HOURS = Number(process.env.SYSADMIN_ABSOLUTE_HOURS || 8);
const MAX_FAILED = 5;
const LOCKOUT_MINUTES = 15;

function hashSecret(secret, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(secret), salt, SCRYPT.keylen, SCRYPT).toString('hex');
  return { salt, hash };
}

function verifySecret(secret, salt, expected) {
  const actual = crypto.scryptSync(String(secret), salt, SCRYPT.keylen, SCRYPT);
  const want = Buffer.from(expected, 'hex');
  return actual.length === want.length && crypto.timingSafeEqual(actual, want);
}

/* An unknown username must cost what a wrong password costs. */
const DUMMY = hashSecret(crypto.randomBytes(8).toString('hex'));
function burnTime() { verifySecret('x', DUMMY.salt, DUMMY.hash); }

function newToken() { return crypto.randomBytes(32).toString('hex'); }
const minutesFromNow = m => new Date(Date.now() + m * 60_000).toISOString();
const hoursFromNow = h => new Date(Date.now() + h * 3_600_000).toISOString();

/* ---------- cookies ---------- */
function cookieHeader(name, value, req, { clear = false, maxAge } = {}) {
  const secure = process.env.FORCE_INSECURE_COOKIE === '1' ? false
    : (req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production');
  const bits = [
    `${name}=${clear ? '' : encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    /* Strict, not Lax. The school app uses Lax so a link into the portal
       still carries the session; nothing should ever link into this. */
    'SameSite=Strict',
    clear ? 'Max-Age=0' : `Max-Age=${maxAge}`
  ];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

function tokenFrom(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

/* ---------- optional IP allowlist ----------
   Off by default. Recommended against as a hard requirement: the day you
   need to fix a school from an airport, an allowlist is the thing that
   stops you. Recovery codes plus TOTP is the better trade for one
   operator. Available for anyone who disagrees. */
function ipAllowed(req) {
  const list = (process.env.SYSADMIN_ALLOWED_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!list.length) return true;
  const ip = clientIp(req).replace(/^::ffff:/, '');
  return list.includes(ip);
}

/* ---------- the second factor, switched off ----------
   SYSADMIN_SKIP_2FA=1 turns the login into a single step: a correct
   password yields a session outright.

   It is for local testing of the console, and it is refused when
   NODE_ENV=production, because the thing it disables is the only barrier
   between one stolen password and every school's children. Every login
   taken this way is audited as `login.success.NO_2FA` so the trail shows
   plainly which sessions were opened without a second factor. */
function bypassAllowed() {
  return process.env.SYSADMIN_SKIP_2FA === '1' && process.env.NODE_ENV !== 'production';
}

/* ---------- step 1: password ---------- */
async function beginLogin(reg, username, password, req) {
  const ip = clientIp(req);
  const op = await reg.getOperator(username);

  if (!op) {
    burnTime();
    await reg.audit({ action: 'login.password', target: String(username || ''), ok: false, detail: 'unknown operator', ip });
    return { ok: false };
  }

  if (op.locked_until && new Date(op.locked_until) > new Date()) {
    await reg.audit({ actor: op.username, action: 'login.password', ok: false, detail: 'locked out', ip });
    return { ok: false, locked: true, until: op.locked_until };
  }

  if (!verifySecret(password, op.salt, op.hash)) {
    await reg.bumpFailed(op.username);
    const failed = (op.failed_count || 0) + 1;
    if (failed >= MAX_FAILED) await reg.lockUntil(op.username, minutesFromNow(LOCKOUT_MINUTES));
    await reg.audit({
      actor: op.username, action: 'login.password', ok: false,
      detail: `wrong password (${failed}/${MAX_FAILED})`, ip
    });
    return { ok: false };
  }

  await reg.clearFailed(op.username);

  /* Password right. Normally that buys a challenge, not a session. */
  if (bypassAllowed()) {
    const session = newToken();
    const now = new Date().toISOString();
    await reg.createSession({
      token: session,
      username: op.username,
      created_at: now,
      last_seen: now,
      expires_at: hoursFromNow(ABSOLUTE_HOURS),
      ip,
      ua: String(req.headers['user-agent'] || '').slice(0, 300)
    });
    await reg.audit({
      actor: op.username, action: 'login.success.NO_2FA', ok: true,
      detail: 'SYSADMIN_SKIP_2FA=1 — second factor was not required', ip
    });
    return {
      ok: true,
      bypassed: true,
      operator: { username: op.username, name: op.name },
      cookie: cookieHeader(COOKIE, session, req, { maxAge: ABSOLUTE_HOURS * 3600 })
    };
  }

  const token = newToken();
  await reg.createChallenge({
    token,
    username: op.username,
    created_at: new Date().toISOString(),
    expires_at: minutesFromNow(CHALLENGE_MINUTES),
    ip,
    ua: String(req.headers['user-agent'] || '').slice(0, 300)
  });
  await reg.audit({ actor: op.username, action: 'login.password', ok: true, detail: 'challenge issued', ip });

  return {
    ok: true,
    token,
    /* Tells the UI which factor to ask for. There is no "no second
       factor" branch: an operator without a TOTP secret cannot sign in,
       and setup.js will not create one without it. */
    factor: op.totp_secret ? 'totp' : 'none',
    cookie: cookieHeader(CHALLENGE_COOKIE, token, req, { maxAge: CHALLENGE_MINUTES * 60 })
  };
}

/* ---------- step 2: second factor ---------- */
async function completeLogin(reg, code, req) {
  const ip = clientIp(req);
  const token = tokenFrom(req, CHALLENGE_COOKIE);
  if (!token) return { ok: false, reason: 'no_challenge' };

  const ch = await reg.getChallenge(token);
  if (!ch) return { ok: false, reason: 'no_challenge' };

  if (new Date(ch.expires_at) < new Date()) {
    await reg.deleteChallenge(token);
    await reg.audit({ actor: ch.username, action: 'login.factor', ok: false, detail: 'challenge expired', ip });
    return { ok: false, reason: 'expired' };
  }

  /* Bound to the browser that passed the password. A challenge cookie
     replayed from elsewhere is not a second factor. */
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  if (ch.ip !== ip || ch.ua !== ua) {
    await reg.deleteChallenge(token);
    await reg.audit({ actor: ch.username, action: 'login.factor', ok: false, detail: 'challenge rebound — ip or agent changed', ip });
    return { ok: false, reason: 'rebound' };
  }

  if (ch.attempts >= CHALLENGE_ATTEMPTS) {
    await reg.deleteChallenge(token);
    await reg.audit({ actor: ch.username, action: 'login.factor', ok: false, detail: 'attempts exhausted', ip });
    return { ok: false, reason: 'exhausted' };
  }

  const op = await reg.getOperator(ch.username);
  if (!op) return { ok: false, reason: 'no_challenge' };

  let used = null;
  if (totp.verify(op.totp_secret, code)) {
    used = 'totp';
  } else {
    /* Recovery codes are checked only after TOTP fails, so a valid TOTP
       code never burns one. */
    for (const rc of await reg.listRecoveryCodes(op.username)) {
      if (verifySecret(recovery.normalise(code), rc.salt, rc.hash)) {
        await reg.useRecoveryCode(rc.id);
        used = 'recovery';
        break;
      }
    }
  }

  if (!used) {
    await reg.bumpChallenge(token);
    await reg.audit({ actor: op.username, action: 'login.factor', ok: false, detail: 'wrong code', ip });
    return { ok: false, reason: 'bad_code' };
  }

  await reg.deleteChallenge(token);
  await reg.clearFailed(op.username);

  const session = newToken();
  const now = new Date().toISOString();
  await reg.createSession({
    token: session,
    username: op.username,
    created_at: now,
    last_seen: now,
    expires_at: hoursFromNow(ABSOLUTE_HOURS),
    ip,
    ua
  });
  await reg.audit({ actor: op.username, action: 'login.success', ok: true, detail: `factor: ${used}`, ip });

  return {
    ok: true,
    factor: used,
    operator: { username: op.username, name: op.name },
    cookie: cookieHeader(COOKIE, session, req, { maxAge: ABSOLUTE_HOURS * 3600 }),
    clearChallenge: cookieHeader(CHALLENGE_COOKIE, '', req, { clear: true }),
    /* A recovery code that has just been spent is worth saying out loud. */
    warnRecovery: used === 'recovery'
  };
}

/* ---------- resolving a session ---------- */
async function currentOperator(req, reg) {
  const token = tokenFrom(req, COOKIE);
  if (!token) return null;

  const s = await reg.getSession(token);
  if (!s) return null;

  const now = Date.now();
  if (new Date(s.expires_at).getTime() < now) { await reg.deleteSession(token); return null; }
  if (now - new Date(s.last_seen).getTime() > IDLE_MINUTES * 60_000) {
    await reg.deleteSession(token);
    await reg.audit({ actor: s.username, action: 'session.idle_timeout', ok: true, ip: clientIp(req) });
    return null;
  }

  await reg.touchSession(token, new Date(now).toISOString());
  const op = await reg.getOperator(s.username);
  return op ? { username: op.username, name: op.name, token } : null;
}

/**
 * Re-challenge inside a live session.
 *
 * Stage 1 is read-only so nothing calls this yet. It exists now because
 * the rule it enforces — a session is not a standing licence, every
 * destructive action re-checks the second factor — is much harder to add
 * once destructive actions are already shipping without it.
 */
async function stepUp(reg, username, code, req) {
  const op = await reg.getOperator(username);
  const ok = !!op && totp.verify(op.totp_secret, code);
  await reg.audit({
    actor: username, action: 'auth.step_up', ok,
    detail: ok ? 'second factor re-verified' : 'step-up failed', ip: clientIp(req)
  });
  return ok;
}

module.exports = {
  COOKIE, CHALLENGE_COOKIE,
  hashSecret, verifySecret, newToken, cookieHeader, tokenFrom, clientIp, ipAllowed,
  beginLogin, completeLogin, currentOperator, stepUp, bypassAllowed,
  IDLE_MINUTES, ABSOLUTE_HOURS, MAX_FAILED
};
