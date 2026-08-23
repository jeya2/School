/* ============================================================
   sysadmin/auth/recovery.js — one-time recovery codes

   Not optional, and not a nicety.

   One operator means a lost or stolen phone locks you out of every
   school you host, simultaneously, during whatever incident made you
   try to log in. Without these, the recovery path is redeploying the
   control plane to reset your own TOTP secret — while a school is down.

   Ten codes, shown exactly once at setup, stored as scrypt hashes so the
   registry database never contains a usable one. Checked only after TOTP
   fails, so a working authenticator never burns a code.
   ============================================================ */
const crypto = require('crypto');

const COUNT = 10;
const GROUPS = 3;
const GROUP_LEN = 4;

/* Crockford-ish: no I, L, O, U — they are the characters people misread
   off a printed sheet, which is where these are meant to live. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

function one() {
  const chars = [];
  for (let i = 0; i < GROUPS * GROUP_LEN; i++) {
    chars.push(ALPHABET[crypto.randomInt(ALPHABET.length)]);
  }
  const raw = chars.join('');
  const pretty = raw.match(new RegExp(`.{1,${GROUP_LEN}}`, 'g')).join('-');
  return { raw, pretty };
}

/** Normalise what someone types back in: case and dashes do not matter. */
function normalise(code) {
  return String(code || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Generate a fresh set.
 * Returns { display, stored } — `display` is shown once and never again,
 * `stored` is what goes in the registry.
 */
function generate(hashSecret) {
  const display = [];
  const stored = [];
  for (let i = 0; i < COUNT; i++) {
    const c = one();
    display.push(c.pretty);
    stored.push(hashSecret(c.raw));
  }
  return { display, stored };
}

module.exports = { generate, normalise, COUNT };
