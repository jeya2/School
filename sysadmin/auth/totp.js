/* ============================================================
   sysadmin/auth/totp.js — RFC 6238 time-based one-time passwords

   The primary second factor for the control plane.

   Why TOTP rather than SMS, when SMS was what was asked for:

   • SIM swap is the specific attack on this system. One phone number is
     the only barrier between an attacker and every school hosted here,
     and swapping it does not require touching a server. TOTP has no
     phone number to steal.
   • Indian transactional SMS requires DLT registration of the header and
     template with the operator (TRAI). Two to three weeks. TOTP works
     this week.
   • TOTP is offline. No SMS gateway sits between you and a production
     incident at 11pm.

   SMS remains in the design as a FALLBACK factor for stage 6, not as the
   only one. See ../README.md.

   No dependency: HMAC-SHA1 and randomBytes ship with Node. Base32 is
   thirty lines. A second factor implemented with a fresh npm package is
   a second factor you have not read.
   ============================================================ */
const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;        // seconds per code, per RFC 6238
const DIGITS = 6;

/* A code is accepted one step either side of now. That covers a clock a
   few seconds out and a person typing as the code rolls. Wider would
   meaningfully extend the window for a stolen code. */
const SKEW = 1;

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 20-byte secret, base32 encoded — what goes in the QR code. */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/** The code for one time counter. */
function codeFor(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) |
              ((hmac[offset + 1] & 0xff) << 16) |
              ((hmac[offset + 2] & 0xff) << 8) |
              (hmac[offset + 3] & 0xff);
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** The code right now — used by the tests and the setup CLI, not the server. */
function current(secret, at = Date.now()) {
  return codeFor(secret, Math.floor(at / 1000 / STEP));
}

/**
 * Verify a submitted code.
 * Comparison is constant time: a fast rejection and a slow one leak the
 * length of the common prefix, exactly as with a password.
 */
function verify(secret, submitted, at = Date.now()) {
  if (!secret || !submitted) return false;
  const clean = String(submitted).replace(/\D/g, '');
  if (clean.length !== DIGITS) return false;

  const counter = Math.floor(at / 1000 / STEP);
  const want = Buffer.from(clean);
  for (let i = -SKEW; i <= SKEW; i++) {
    const candidate = Buffer.from(codeFor(secret, counter + i));
    if (candidate.length === want.length && crypto.timingSafeEqual(candidate, want)) return true;
  }
  return false;
}

/** otpauth:// URI — paste into any authenticator, or render as a QR. */
function provisioningUri(secret, account, issuer = 'BNL Sysadmin') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP)
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = {
  generateSecret, current, verify, provisioningUri,
  base32Encode, base32Decode, STEP, DIGITS
};
