/* ============================================================
   sysadmin/ops/health.js — polling the fleet

   Stage 1 reads only what a school publishes to anyone:

     GET /api/health   { ok, adapter, storeError, version }
     GET /api/status   { provisioned, hasUsers, school: { name, short, year } }

   Both are unauthenticated on the school side, by design — the login
   screen calls /api/status before anyone has signed in. So the fleet
   view needs NO credential against any school, and a compromise of the
   control plane at this stage yields no student data, because the
   control plane never asks for any.

   That property is worth keeping as long as possible. Anything needing a
   per-school AGENT_SECRET belongs in stage 2 and later, not here.

   The single most valuable thing on this screen is `storeError`. A
   school whose better-sqlite3 failed to load still serves its site
   perfectly and answers 503 on every data route — the office would see a
   portal that loads and then refuses to show a single child. From here
   that is one red row.
   ============================================================ */

const TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS || 8000);

async function fetchJson(url, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'bnl-sysadmin/1.0 health' },
      redirect: 'follow'
    });
    let body = null;
    try { body = await res.json(); } catch { /* not JSON — leave null */ }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** Poll one school. Never throws — an unreachable school is a result. */
async function check(school) {
  const started = Date.now();
  const base = String(school.url || '').replace(/\/+$/, '');
  const snap = {
    checked_at: new Date().toISOString(),
    reachable: false,
    http_status: null,
    ok: null,
    adapter: null,
    version: null,
    store_error: null,
    provisioned: null,
    school_name: null,
    academic_year: null,
    latency_ms: null,
    error: null
  };

  try {
    const health = await fetchJson(base + '/api/health');
    snap.latency_ms = Date.now() - started;
    snap.http_status = health.status;
    snap.reachable = true;

    if (health.body) {
      snap.ok = !!health.body.ok;
      snap.adapter = health.body.adapter || null;
      snap.version = health.body.version || null;
      snap.store_error = health.body.storeError || null;
    }

    /* Only worth asking if the deployment is answering at all. */
    try {
      const status = await fetchJson(base + '/api/status');
      if (status.body) {
        snap.provisioned = !!status.body.provisioned;
        snap.school_name = (status.body.school && status.body.school.name) || null;
        snap.academic_year = (status.body.school && status.body.school.year) || null;
      }
    } catch { /* health is the load-bearing one; status is detail */ }
  } catch (e) {
    snap.latency_ms = Date.now() - started;
    snap.error = e.name === 'AbortError' ? `no answer in ${TIMEOUT_MS}ms` : String(e.message || e);
  }

  return snap;
}

/** Poll every active school, in parallel, and store the snapshots. */
async function pollAll(reg) {
  const schools = (await reg.listSchools()).filter(s => s.status !== 'retired');
  const results = await Promise.all(schools.map(async s => {
    const snap = await check(s);
    await reg.recordHealth(s.id, snap);
    return { id: s.id, ...snap };
  }));
  return results;
}

/**
 * Reduce a snapshot to one word for the fleet view.
 *   down      nothing answered
 *   no-db     answering, but no storage adapter — 503 on every data route
 *   empty     healthy but no school imported yet
 *   ok        serving a provisioned school
 */
function verdict(snap) {
  if (!snap) return 'unknown';
  if (!snap.reachable) return 'down';
  if (snap.http_status >= 500) return 'down';
  if (snap.ok === false || snap.store_error) return 'no-db';
  if (snap.provisioned === false) return 'empty';
  return 'ok';
}

module.exports = { check, pollAll, verdict, TIMEOUT_MS };
