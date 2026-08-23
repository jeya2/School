/* ============================================================
   core.js — session, storage, formatters, toasts, theme, data access
   Shared by index.html (public site) and app.html (portal)

   Loads after domain.js, which owns every Tamil Nadu constant and the
   academic calendar. Nothing in this file redeclares those.

   The database on the server is the single source of truth. This file
   holds no seed data and generates nothing: DB.load() fetches the
   school's records over /api, and every mutation is written straight
   back through DB.save(). localStorage keeps only what belongs to this
   browser — the theme, and nothing else. Two members of staff on two
   machines see the same school.
   ============================================================ */

/* ---------- School identity ----------
   Filled from /api/bootstrap at load. The defaults below are only what
   an un-provisioned instance shows before a school file is imported. */
let SCHOOL = {
  name: 'School Management Portal',
  short: 'School Portal',
  tamil: '',
  addr: '',
  phone: '',
  email: '',
  code: '',
  udise: '',
  year: '',
  est: '',
  provisioned: false
};

/* The signed-in user, from the server session. */
let USER = null;

/* ---------- localStorage wrapper ----------
   Browser-local preferences only. School records never live here: they
   would go stale the moment another user saved, and a shared office
   machine would leak one school's data into the next session. */
const Store = {
  key: k => 'portal.' + k,
  get(k, fallback = null) {
    try { const v = localStorage.getItem(this.key(k)); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(this.key(k), JSON.stringify(v)); } catch (e) { console.warn(e); } },
  del(k) { localStorage.removeItem(this.key(k)); },
  clearAll() { Object.keys(localStorage).filter(k => k.startsWith('portal.')).forEach(k => localStorage.removeItem(k)); }
};

/* ---------- API helper ----------
   Every call carries the session cookie. A 401 means the session went
   away underneath us — bounce to the login rather than rendering a
   half-empty screen. */
async function api(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  if (res.status === 401 && !location.pathname.endsWith('index.html') && location.pathname !== '/') {
    location.replace('index.html');
    throw new Error('signed out');
  }
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || ('HTTP ' + res.status));
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/* ---------- Toast ---------- */
function toast(msg, kind = '', ms = 3200) {
  let host = document.getElementById('toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  const icon = { ok: '✅', err: '⚠️', warn: '⚡' }[kind] || 'ℹ️';
  el.innerHTML = `<span>${icon}</span><span>${msg}</span>`;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, ms);
}

/* ---------- Theme ----------
   Delegated so the toggle keeps working no matter when the button appears —
   views are re-rendered constantly, and a one-time binding would be lost. */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  Store.set('theme', t);
  document.querySelectorAll('#themeBtn').forEach(b => b.textContent = t === 'dark' ? '☀️' : '🌙');
}
applyTheme(Store.get('theme', 'light'));
document.addEventListener('click', e => {
  const b = e.target.closest('#themeBtn');
  if (!b) return;
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

/* ---------- Formatters ---------- */
const INRs = n => {
  const v = Number(n || 0);
  if (v >= 10000000) return '₹' + (v / 10000000).toFixed(2) + ' Cr';
  if (v >= 100000) return '₹' + (v / 100000).toFixed(2) + ' L';
  if (v >= 1000) return '₹' + Math.round(v / 1000) + 'K';
  return '₹' + v;
};
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return iso;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
const initials = n => (n || '?').trim().split(/\s+/).filter(w => w.length > 1)
  .slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => p + '-' + Math.random().toString(36).slice(2, 8);

/* ---------- Data access ----------
   The collections the portal reads. Each is stored server-side under the
   same name, and DB.save(name) writes the whole collection back. Saving
   whole collections rather than deltas keeps the write path honest: what
   the browser holds after a save is exactly what the database holds. */
const COLLECTIONS = ['students', 'marks', 'receipts', 'notices', 'staff',
                     'attendance', 'attHistory', 'attDays', 'applications'];

const DB = {
  students: [], marks: {}, receipts: [], notices: [], staff: [],
  attendance: {}, attHistory: {}, attDays: [], applications: [],
  loaded: false,

  /** Fetch the school profile, the signed-in user and every collection. */
  async load() {
    const boot = await api('/bootstrap');
    SCHOOL = Object.assign({}, SCHOOL, boot.school || {});
    USER = boot.user || null;

    const data = boot.data || {};
    this.students    = data.students || [];
    this.marks       = data.marks || {};
    this.receipts    = data.receipts || [];
    this.notices     = data.notices || [];
    this.staff       = data.staff || [];
    this.attendance  = data.attendance || {};   // key: date|cls|sec -> { sid: 'P'|'A'|'L' }
    this.attHistory  = data.attHistory || {};   // key: sid -> 'PPAPL…' one char per working day
    this.attDays     = data.attDays || [];      // the day each character maps to
    this.applications = data.applications || [];
    this.loaded = true;

    /* The school's own calendar drives the eligibility forecast, so push it
       into the domain layer before any AI engine reads those globals. */
    applyCalendar({
      yearStart: SCHOOL.yearStart,
      yearWorkingDays: SCHOOL.yearWorkingDays,
      minAttendance: SCHOOL.minAttendance,
      holidays: SCHOOL.holidays,
      workingDays: this.attDays
    });
    return this;
  },

  /** Persist one collection. Awaited by callers that need to know it stuck. */
  async save(k) {
    if (!COLLECTIONS.includes(k)) throw new Error('unknown collection: ' + k);
    try {
      await api('/collection/' + k, { method: 'PUT', body: { data: this[k] } });
    } catch (e) {
      /* A failed write is the one error a user must never miss — the screen
         would otherwise show a change the database never took. */
      toast('Could not save: ' + e.message, 'err', 6000);
      throw e;
    }
  },

  /* queries */
  student(id) { return this.students.find(s => s.id === id); },
  byClass(cls, sec) { return this.students.filter(s => s.cls === cls && (!sec || s.sec === sec)).sort((a, b) => a.roll - b.roll); },
  sections() {
    const set = new Map();
    this.students.forEach(s => set.set(s.cls + '-' + s.sec, { cls: s.cls, sec: s.sec }));
    return [...set.values()].sort((a, b) => CLASSES.indexOf(a.cls) - CLASSES.indexOf(b.cls) || a.sec.localeCompare(b.sec));
  },
  stats() {
    const st = this.students.filter(s => s.status === 'Active');
    const due = st.reduce((a, s) => a + Math.max(0, s.feeTotal - s.feePaid), 0);
    const paid = st.reduce((a, s) => a + s.feePaid, 0);
    const attP = st.reduce((a, s) => a + s.attPresent, 0);
    const attT = st.reduce((a, s) => a + s.attTotal, 0);
    return {
      total: st.length,
      boys: st.filter(s => s.gender === 'Male').length,
      girls: st.filter(s => s.gender === 'Female').length,
      rte: st.filter(s => s.rte).length,
      staff: this.staff.length,
      collected: paid,
      due,
      target: paid + due,
      attRate: attT ? (attP / attT * 100) : 0,
      defaulters: st.filter(s => s.feeTotal - s.feePaid > 0).length
    };
  }
};
