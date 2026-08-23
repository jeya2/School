/* ============================================================
   sysadmin console — fleet view

   Same idiom as the school portal: no modules, no bundler, no build
   step, top-level functions and globals. If you know assets/js/app.js
   you know this file.

   Stage 1 is read only. The only writes are to the control plane's own
   registry — recording where a deployment lives. Nothing here can change
   a school.
   ============================================================ */
const $ = id => document.getElementById(id);

/* Escape before interpolating. Everything below is remote text: a school's
   self-reported name, a storeError string, a user agent. None of it is
   trusted enough to put in innerHTML raw. */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  if (res.status === 401) { location.replace('index.html'); throw new Error('signed out'); }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw Object.assign(new Error((data && data.message) || ('HTTP ' + res.status)), { data });
  return data;
}

/* ---------- formatting ---------- */
function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

const VERDICT_TITLE = {
  ok: 'Serving a provisioned school',
  empty: 'Healthy, but no school imported yet',
  'no-db': 'Answering, but no storage adapter — every data route returns 503',
  down: 'No answer',
  unknown: 'Never polled'
};

/* ---------- fleet ---------- */
async function loadFleet() {
  const { schools } = await api('/api/fleet');
  const body = $('fleet');
  $('count').textContent = schools.length + (schools.length === 1 ? ' school' : ' schools');
  $('fleetEmpty').style.display = schools.length ? 'none' : '';

  let newest = null;
  body.innerHTML = schools.map(s => {
    const h = s.health || {};
    if (h.checked_at && (!newest || h.checked_at > newest)) newest = h.checked_at;

    /* storeError is the one worth surfacing in full. A school in that
       state loads its site perfectly and refuses every record — the
       office sees a working portal with no children in it. */
    const trouble = h.store_error
      ? `<div class="err-line">storeError: ${esc(h.store_error)}</div>`
      : (h.error ? `<div class="err-line">${esc(h.error)}</div>` : '');

    return `<tr>
      <td><span class="pill ${esc(s.verdict)}" title="${esc(VERDICT_TITLE[s.verdict] || '')}">${esc(s.verdict)}</span></td>
      <td class="mono">${esc(s.id)}</td>
      <td>${esc(h.school_name || s.name)}${trouble}</td>
      <td class="tiny"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.url.replace(/^https?:\/\//, ''))}</a></td>
      <td class="tiny mono">${esc(h.adapter || '—')}</td>
      <td class="tiny mono">${esc(h.version || '—')}</td>
      <td class="tiny">${esc(h.academic_year || '—')}</td>
      <td class="tiny mono">${h.latency_ms == null ? '—' : esc(h.latency_ms) + 'ms'}</td>
      <td class="tiny muted">${esc(ago(h.checked_at))}</td>
      <td><button class="btn btn-ghost tiny" data-forget="${esc(s.id)}">Forget</button></td>
    </tr>`;
  }).join('');

  $('lastPoll').textContent = newest ? 'last polled ' + ago(newest) : '';

  body.querySelectorAll('[data-forget]').forEach(b => {
    b.addEventListener('click', () => forget(b.dataset.forget));
  });
}

async function forget(id) {
  if (!confirm(
    `Remove "${id}" from the registry?\n\n` +
    'This only stops the control plane watching it. The deployment, its ' +
    'database and its records are untouched.'
  )) return;
  await api('/api/schools/' + encodeURIComponent(id), { method: 'DELETE' });
  await refresh();
}

async function poll() {
  const btn = $('poll');
  btn.disabled = true;
  btn.textContent = 'Polling…';
  try {
    await api('/api/fleet/poll', { method: 'POST' });
    await refresh();
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Poll now';
  }
}

async function add() {
  const id = $('nid').value.trim().toLowerCase();
  const name = $('nname').value.trim();
  const url = $('nurl').value.trim().replace(/\/+$/, '');
  if (!id || !name || !url) return alert('Id, name and URL are all required.');
  try {
    await api('/api/schools', { method: 'POST', body: { id, name, url } });
    $('nid').value = $('nname').value = $('nurl').value = '';
    await api('/api/fleet/poll', { method: 'POST' });
    await refresh();
  } catch (e) {
    alert(e.message);
  }
}

/* ---------- audit ---------- */
async function loadAudit() {
  const { entries } = await api('/api/audit');
  $('audit').innerHTML = entries.map(e => `<tr>
    <td class="muted">${esc(new Date(e.at).toLocaleString())}</td>
    <td>${esc(e.actor || '—')}</td>
    <td class="${e.ok ? 'yes' : 'no'}">${esc(e.action)}${e.ok ? '' : ' ✕'}</td>
    <td>${esc(e.target || '')}</td>
    <td class="muted">${esc(e.detail || '')}</td>
    <td class="muted">${esc(e.ip || '')}</td>
  </tr>`).join('');
}

async function refresh() {
  await Promise.all([loadFleet(), loadAudit()]);
}

/* ---------- boot ---------- */
(async function () {
  try {
    const me = await api('/api/me');
    $('who').textContent = me.operator.username;
  } catch { return; }

  if (sessionStorage.getItem('bnl.recoveryUsed')) {
    $('recoveryWarn').classList.add('show');
    sessionStorage.removeItem('bnl.recoveryUsed');
  }

  $('poll').addEventListener('click', poll);
  $('add').addEventListener('click', add);
  $('signout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    location.replace('index.html');
  });

  await refresh();

  /* Refresh the view every 30s. This re-reads the registry; it does not
     poll the schools — that stays an explicit action, so the fleet view
     never becomes a quiet source of traffic against every customer. */
  setInterval(() => refresh().catch(() => {}), 30000);
})();
