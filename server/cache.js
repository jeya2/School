/* ============================================================
   cache.js — replay decisions the model has already made
   ------------------------------------------------------------
   In a roll call the same sentences repeat all day: "mark all
   present", "save the register", "roll twelve absent". Every one
   of those is currently a fresh API call re-deciding something
   already decided — and on a free tier with ~1,000 requests a day,
   that is the difference between lasting until 3pm and lasting
   all week.

   This is NOT a parser. It never interprets anything. It only
   replays a tool-call decision the model itself produced earlier
   for the same words, on the same screen, with the same controls
   available. A miss is always safe — it just costs an API call.

   What it refuses to cache is the interesting part; see below.
   ============================================================ */

const MAX_ENTRIES = 500;
const TTL_MS = 24 * 60 * 60 * 1000;   // a school day, generously

/* Utterances whose meaning depends on what was said before. "Change it to
   eleven" means nothing on its own, and replaying an old answer for it would
   be confidently wrong. */
const ANAPHORIC = /\b(it|its|that|this|those|these|them|they|there|same|again|also|too|another|next|previous|prior|last|instead|he|she|him|her|his|hers)\b/i;

/* Utterances anchored to the present. "Absent today" resolves to a different
   date tomorrow, so a cached answer would quietly rot overnight. */
const TIME_RELATIVE = /\b(today|tonight|tomorrow|yesterday|now|currently|current|this week|this month|this term|so far)\b/i;

/* A value that looks like a resolved date. Even when the wording looked safe,
   a decision that wrote a concrete date must not be replayed on another day. */
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v);

const store = new Map();          // insertion order gives us LRU for free
let hits = 0, misses = 0, skipped = 0;

const normalise = u => String(u || '')
  .toLowerCase()
  .replace(/[.,!?;:"'`]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * What the screen *offers*, not what it currently shows.
 *
 * Deliberately excludes current control values: "mark all present" is the same
 * decision whether the class filter reads X or XI, and keying on values would
 * collapse the hit rate to nothing. Option lists ARE included — if a dropdown's
 * choices changed, a cached value might no longer be selectable.
 */
function fingerprint(ctx = {}) {
  const routes   = (ctx.routes   || []).map(r => r.id).sort().join(',');
  const actions  = (ctx.actions  || []).map(a => a.id).sort().join(',');
  const controls = (ctx.controls || [])
    .map(c => `${c.id}:${(c.options || []).join('|')}`).sort().join(',');
  return `${ctx.screen || '?'}#${routes}#${actions}#${controls}`;
}

const keyFor = (utterance, ctx) => fingerprint(ctx) + '##' + normalise(utterance);

/** Is this utterance safe to answer from memory? */
function cacheable(utterance) {
  const n = normalise(utterance);
  if (n.length < 3) return false;
  if (ANAPHORIC.test(n)) return false;
  if (TIME_RELATIVE.test(n)) return false;
  return true;
}

/** Would replaying these calls later be wrong, whatever the wording looked like? */
function stable(calls) {
  if (!Array.isArray(calls) || calls.length === 0) return false;   // never cache a non-decision
  return calls.every(c =>
    c.tool !== 'set_controls' ||
    (c.input?.updates || []).every(u => !isDate(String(u.value ?? ''))));
}

/** A previous decision for these exact words on this exact screen, or null. */
function get(utterance, ctx) {
  if (!cacheable(utterance)) { skipped++; return null; }
  const k = keyFor(utterance, ctx);
  const entry = store.get(k);
  if (!entry) { misses++; return null; }
  if (Date.now() - entry.at > TTL_MS) { store.delete(k); misses++; return null; }
  store.delete(k); store.set(k, entry);        // touch: move to the young end
  hits++;
  return entry.calls;
}

/** Remember a decision, if it is one that can be safely repeated. */
function put(utterance, ctx, calls) {
  if (!cacheable(utterance) || !stable(calls)) return false;
  store.set(keyFor(utterance, ctx), { calls, at: Date.now() });
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);
  return true;
}

function stats() {
  const asked = hits + misses;
  return {
    entries: store.size,
    hits, misses, skipped,
    hit_rate: asked ? Math.round((hits / asked) * 100) : 0,
    calls_saved: hits
  };
}

function reset() { store.clear(); hits = misses = skipped = 0; }

module.exports = { get, put, stats, reset, cacheable, stable, fingerprint, normalise, MAX_ENTRIES };
