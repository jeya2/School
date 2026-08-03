/* ============================================================
   app.js — portal shell, router and all module views
   ============================================================ */

/* ───────────────────────── session ───────────────────────── */
const session = Store.get('session');
if (!session) location.replace('index.html');
const ROLE = session?.role || 'admin';
DB.load();

/* ───────────────────────── modal ─────────────────────────── */
function openModal({ title, body, actions = [], wide = false, onOpen }) {
  const host = document.getElementById('modalHost');
  host.innerHTML = `
    <div class="modal-back" id="mBack">
      <div class="modal ${wide ? 'modal-wide' : ''}">
        <div class="modal-head">
          <h3 style="font-size:1.05rem">${title}</h3>
          <button class="btn btn-quiet btn-icon" id="mX" aria-label="Close">✕</button>
        </div>
        <div class="modal-body" id="mBody">${body}</div>
        ${actions.length ? `<div class="modal-foot">${actions.map((a, i) =>
          `<button class="btn ${a.cls || 'btn-ghost'}" data-a="${i}">${a.label}</button>`).join('')}</div>` : ''}
      </div>
    </div>`;
  host.querySelector('#mX').onclick = closeModal;
  host.querySelector('#mBack').onclick = e => { if (e.target.id === 'mBack') closeModal(); };
  actions.forEach((a, i) => host.querySelector(`[data-a="${i}"]`).onclick = () => a.fn?.());
  onOpen?.(host.querySelector('#mBody'));
}
function closeModal() {
  document.getElementById('modalHost').innerHTML = '';
  if (Voice.container && !document.body.contains(Voice.container)) Voice.detach();
}
addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ───────────────────────── navigation ────────────────────── */
const NAV = [
  { group: 'Overview', items: [
    { id: 'dashboard', label: 'Dashboard', ico: '📊', roles: '*' },
  ]},
  { group: 'Students', items: [
    { id: 'students',  label: 'Student Master', ico: '👨‍🎓', roles: 'admin,principal,teacher,accountant' },
    { id: 'admission', label: 'New Admission',  ico: '➕', roles: 'admin,principal', tag: 'Voice' },
    { id: 'mychild',   label: 'My Record',      ico: '🎒', roles: 'parent,student' },
  ]},
  { group: 'Intelligence', items: [
    { id: 'insights',     label: 'Attendance Alerts', ico: '🧠', roles: 'admin,principal,teacher', tag: 'AI', ai: true },
    { id: 'dataquality',  label: 'Data Quality',      ico: '🩺', roles: 'admin,principal', tag: 'AI', ai: true },
    { id: 'scholarships', label: 'Scholarship Match', ico: '🎁', roles: 'admin,principal,accountant', tag: 'AI', ai: true },
  ]},
  { group: 'Daily Work', items: [
    { id: 'attendance', label: 'Attendance', ico: '📋', roles: 'admin,principal,teacher', tag: 'Voice' },
    { id: 'marks',      label: 'Mark Entry', ico: '✍️', roles: 'admin,principal,teacher', tag: 'Voice' },
    { id: 'exams',      label: 'Report Cards', ico: '📝', roles: 'admin,principal,teacher' },
  ]},
  { group: 'Finance', items: [
    { id: 'fees',      label: 'Fee Collection', ico: '💰', roles: 'admin,principal,accountant', tag: 'Voice' },
    { id: 'defaulters',label: 'Fee Dues',       ico: '⚠️', roles: 'admin,principal,accountant' },
  ]},
  { group: 'School', items: [
    { id: 'staff',   label: 'Staff',    ico: '👩‍🏫', roles: 'admin,principal' },
    { id: 'notices', label: 'Circulars', ico: '📢', roles: '*' },
    { id: 'reports', label: 'Reports & Govt.', ico: '🏛', roles: 'admin,principal' },
  ]},
  { group: 'System', items: [
    { id: 'settings', label: 'Settings', ico: '⚙️', roles: '*' },
  ]}
];
const allowed = it => it.roles === '*' || it.roles.split(',').includes(ROLE);

function paintNav() {
  document.getElementById('sideNav').innerHTML = NAV.map(g => {
    const items = g.items.filter(allowed);
    if (!items.length) return '';
    return `<div class="nav-group"><h6>${g.group}</h6>${items.map(it =>
      `<a class="nav-item" href="#${it.id}" data-nav="${it.id}">
        <span class="ico">${it.ico}</span><span>${it.label}</span>
        ${it.tag ? `<span class="tag ${it.ai ? 'ai' : ''}">${it.tag}</span>` : ''}
      </a>`).join('')}</div>`;
  }).join('');

  const u = DEMO_USERS[ROLE];
  document.getElementById('userAvatar').textContent = initials(u.name);
  document.getElementById('userName').textContent = u.name;
  document.getElementById('userRole').textContent = u.title;

  const map = {};
  NAV.forEach(g => g.items.filter(allowed).forEach(it => map[it.id] = it.label));
  map.dashboard = 'dashboard home';
  Voice.registerNav(map);
}

/* ───────────────────────── router ────────────────────────── */
const ROUTES = {};
function route() {
  const raw = location.hash.slice(1) || 'dashboard';
  const [id, qs] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  const item = NAV.flatMap(g => g.items).find(i => i.id === id);

  if (item && !allowed(item)) { toast('Your role cannot open that page.', 'warn'); location.hash = '#dashboard'; return; }
  const fn = ROUTES[id];
  if (!fn) { location.hash = '#dashboard'; return; }

  Voice.detach();
  Voice.onCommand = null;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === id));
  document.getElementById('appSide').classList.remove('open');
  document.querySelector('.side-scrim')?.remove();
  const view = document.getElementById('view');
  view.innerHTML = '';
  view.className = 'view fade-up';
  fn(view, params);
  scrollTo({ top: 0, behavior: 'instant' });
}
function setHead(title, crumb) {
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageCrumb').textContent = crumb || SCHOOL.name;
}

/* ───────────────────────── shared bits ───────────────────── */
const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;
function gradeOf(p) {
  if (p >= 90) return 'A+'; if (p >= 80) return 'A'; if (p >= 70) return 'B+';
  if (p >= 60) return 'B'; if (p >= 50) return 'C'; if (p >= 35) return 'D'; return 'RA';
}
const gradeCls = g => 'g-' + (g[0] === 'R' ? 'D' : g[0]);
const attCls = p => p >= 90 ? 'ok' : p >= 75 ? '' : p >= 60 ? 'warn' : 'danger';

function kpi(label, value, sub, ico, k = '') {
  return `<div class="kpi ${k}">
    <div class="kpi-top"><span class="kpi-label">${label}</span><span class="kpi-ico">${ico}</span></div>
    <b>${value}</b><div class="sub">${sub || ''}</div></div>`;
}
function donut(segs, centerVal, centerLbl) {
  const total = segs.reduce((a, s) => a + s.value, 0) || 1;
  const C = 2 * Math.PI * 54;
  let off = 0;
  const circles = segs.map(s => {
    const len = s.value / total * C;
    const c = `<circle r="54" cx="66" cy="66" fill="none" stroke="${s.color}" stroke-width="17"
       stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;
    off += len; return c;
  }).join('');
  return `<div class="donut"><svg width="132" height="132" viewBox="0 0 132 132">${circles}</svg>
    <div class="mid"><b>${centerVal}</b><span>${centerLbl}</span></div></div>`;
}
function legend(segs, total) {
  return `<div class="legend">${segs.map(s => `<div class="legend-row">
    <span class="sw" style="background:${s.color}"></span><span>${s.label}</span>
    <span class="v">${s.value}${total ? ` · ${pct(s.value, total)}%` : ''}</span></div>`).join('')}</div>`;
}
function bars(data, cls = '') {
  const max = Math.max(...data.map(d => d.v), 1);
  return `<div class="bars">${data.map((d, i) => `<div class="bar-col">
    <div class="bar ${cls}" style="height:${Math.max(4, d.v / max * 100)}%;animation-delay:${i * 40}ms">
      <span>${d.label2 ?? d.v}</span></div><small>${d.label}</small></div>`).join('')}</div>`;
}
function classSelect(id, val, allLabel = 'All Classes') {
  return `<select class="select" id="${id}">
    <option value="">${allLabel}</option>
    ${CLASSES.map(c => `<option ${val === c ? 'selected' : ''}>${c}</option>`).join('')}</select>`;
}
function secSelect(id, val) {
  return `<select class="select" id="${id}"><option value="">All Sections</option>
    ${SECTIONS.map(s => `<option ${val === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
}
function optList(arr, val) {
  return arr.map(o => {
    const v = typeof o === 'string' ? o : o.value, t = typeof o === 'string' ? o : o.text;
    return `<option value="${esc(v)}" ${val === v ? 'selected' : ''}>${esc(t)}</option>`;
  }).join('');
}
function studentRow(s) {
  const a = pct(s.attPresent, s.attTotal), due = Math.max(0, s.feeTotal - s.feePaid);
  return `<tr>
    <td><a href="#student?id=${s.id}" class="row" style="gap:.55rem;text-decoration:none">
      <span class="avatar avatar-sm" style="background:linear-gradient(135deg,${s.gender === 'Male' ? 'var(--navy-600),var(--navy-500)' : 'var(--rose-600),var(--rose-500)'})">${initials(s.name)}</span>
      <span><strong style="color:var(--text)">${esc(s.name)}</strong><br><span class="tiny muted mono">${s.adm}</span></span></a></td>
    <td>${s.cls}-${s.sec}<br><span class="tiny muted">Roll ${s.roll}</span></td>
    <td><span class="badge">${s.medium}</span></td>
    <td>${s.community}${s.rte ? ' <span class="badge badge-ok">RTE</span>' : ''}</td>
    <td class="c"><span class="badge ${a >= 75 ? 'badge-ok' : a >= 60 ? 'badge-warn' : 'badge-danger'}">${a}%</span></td>
    <td class="r">${due ? `<span style="color:var(--danger);font-weight:650">${INR(due)}</span>` : '<span class="badge badge-ok">Clear</span>'}</td>
    <td class="c"><a class="btn btn-ghost btn-sm" href="#student?id=${s.id}">View</a></td>
  </tr>`;
}

/* ═══════════════════════════ DASHBOARD ═══════════════════════════ */
ROUTES.dashboard = view => {
  setHead('Dashboard', `${SCHOOL.name} · Academic Year ${SCHOOL.year}`);
  if (ROLE === 'parent' || ROLE === 'student') return ROUTES.mychild(view);

  const st = DB.stats();
  const byClass = CLASSES.map(c => ({ label: c, v: DB.students.filter(s => s.cls === c).length }));
  const comm = COMMUNITIES.map((c, i) => ({
    label: c, value: DB.students.filter(s => s.community === c).length,
    color: ['#2c47a8', '#0f8a7e', '#e89b12', '#d63864', '#7c4dff', '#6b7590'][i]
  }));
  const recent = DB.receipts.slice(0, 6);

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${esc(DEMO_USERS[ROLE].name.split(' ').slice(-1)[0])}</h1>
        <p>${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · Working day 79 of the academic year</p>
      </div>
      <div class="row">
        <a class="btn btn-ghost" href="#attendance">📋 Take Attendance</a>
        <a class="btn btn-primary" href="#admission">➕ New Admission</a>
      </div>
    </div>

    ${aiBand()}

    <div class="grid g4 stagger" style="margin-bottom:1.15rem">
      ${kpi('Students on Roll', st.total.toLocaleString('en-IN'), `<span class="up">▲ 46</span> since last year`, '👨‍🎓')}
      ${kpi('Attendance Today', st.attRate.toFixed(1) + '%', `${Math.round(st.total * st.attRate / 100)} present`, '📋', 'k2')}
      ${kpi('Fees Collected', INRs(st.collected), `${pct(st.collected, st.target)}% of ${INRs(st.target)}`, '💰', 'k3')}
      ${kpi('Outstanding Dues', INRs(st.due), `${st.defaulters} students pending`, '⚠️', 'k4')}
    </div>

    <div class="grid" style="grid-template-columns:1.6fr 1fr;gap:1.15rem;margin-bottom:1.15rem">
      <div class="card">
        <div class="card-head"><h3>Enrolment by Standard</h3><span class="badge badge-brand">${st.total} students</span></div>
        <div class="card-body">${bars(byClass)}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Community Mix</h3></div>
        <div class="card-body">
          ${donut(comm, st.total, 'Students')}
          <div style="margin-top:1.1rem">${legend(comm, st.total)}</div>
        </div>
      </div>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr;gap:1.15rem;margin-bottom:1.15rem">
      <div class="card">
        <div class="card-head"><h3>Recent Fee Receipts</h3><a class="btn btn-ghost btn-sm" href="#fees">All →</a></div>
        <div class="table-scroll"><table class="table">
          <thead><tr><th>Receipt</th><th>Student</th><th>Head</th><th class="r">Amount</th></tr></thead>
          <tbody>${recent.map(r => `<tr>
            <td class="mono tiny">${r.no}<br><span class="muted">${fmtDate(r.date)}</span></td>
            <td>${esc(r.name)}<br><span class="tiny muted">${r.cls}-${r.sec}</span></td>
            <td><span class="badge">${r.head}</span></td>
            <td class="r"><strong>${INR(r.amount)}</strong><br><span class="tiny muted">${r.mode}</span></td>
          </tr>`).join('')}</tbody></table></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Notice Board</h3><a class="btn btn-ghost btn-sm" href="#notices">All →</a></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:.9rem">
          ${DB.notices.slice(0, 4).map(n => `<div style="border-left:3px solid var(--navy-500);padding-left:.8rem">
            <strong style="font-size:.9rem">${esc(n.title)}</strong>
            <div class="tiny muted">${fmtDate(n.date)} · ${n.by} · to ${n.to}</div></div>`).join('')}
        </div>
      </div>
    </div>

    <h3 style="margin-bottom:.8rem">Quick Actions</h3>
    <div class="grid g4">
      <a class="quick-tile" href="#admission"><span class="ico">➕</span><span><b>Admit a Student</b><small>Voice-enabled form</small></span></a>
      <a class="quick-tile" href="#attendance"><span class="ico">📋</span><span><b>Roll Call</b><small>Say present or absent</small></span></a>
      <a class="quick-tile" href="#marks"><span class="ico">✍️</span><span><b>Enter Marks</b><small>Speak the score</small></span></a>
      <a class="quick-tile" href="#reports"><span class="ico">🏛</span><span><b>EMIS / UDISE</b><small>Government returns</small></span></a>
    </div>`;
};

/* ═══════════════════════════ MY CHILD (parent / student) ═══════════════════════════ */
ROUTES.mychild = view => {
  setHead(ROLE === 'parent' ? 'My Child' : 'My Record', SCHOOL.name);
  const s = DB.student('S4102') || DB.students[0];
  const a = pct(s.attPresent, s.attTotal);
  const subs = subjectsFor(s.cls, s.group);
  const term = 'Quarterly';
  const rows = subs.map(sub => {
    const m = DB.marks[`${s.id}|${term}|${sub}`] ?? 0;
    return { sub, m, g: gradeOf(m) };
  });
  const total = rows.reduce((x, r) => x + r.m, 0);
  const due = Math.max(0, s.feeTotal - s.feePaid);

  view.innerHTML = `
    <div class="profile-hero">
      <div class="avatar avatar-xl">${initials(s.name)}</div>
      <div style="flex:1;min-width:200px;position:relative;z-index:1">
        <h2>${esc(s.name)}</h2>
        <div class="pill-row" style="margin-top:.5rem">
          <span class="badge">Std ${s.cls}-${s.sec} · Roll ${s.roll}</span>
          <span class="badge">Adm ${s.adm}</span>
          <span class="badge">${s.medium} Medium</span>
          <span class="badge">EMIS ${s.emis}</span>
        </div>
      </div>
    </div>

    <div class="grid g4 stagger" style="margin-bottom:1.15rem">
      ${kpi('Attendance', a + '%', `${s.attPresent} of ${s.attTotal} days`, '📋')}
      ${kpi('Quarterly Total', total + ' / ' + rows.length * 100, gradeOf(total / rows.length) + ' grade', '📝', 'k2')}
      ${kpi('Fee Status', due ? INR(due) : 'Clear', due ? 'Due — pay at the office' : 'Fully paid', '💰', due ? 'k4' : 'k3')}
      ${kpi('Class Teacher', 'M. Kavitha', 'Mathematics · 98430 12301', '👩‍🏫', 'k5')}
    </div>

    <div class="grid" style="grid-template-columns:1.4fr 1fr;gap:1.15rem">
      <div class="card">
        <div class="card-head"><h3>Quarterly Examination — Marks</h3><span class="badge badge-brand">${term}</span></div>
        <div class="table-scroll"><table class="table">
          <thead><tr><th>Subject</th><th class="c">Marks</th><th class="c">Grade</th><th>Performance</th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td><strong>${r.sub}</strong></td>
            <td class="c num">${r.m} / 100</td>
            <td class="c"><span class="grade ${gradeCls(r.g)}">${r.g}</span></td>
            <td style="min-width:120px"><div class="meter ${attCls(r.m)}"><i style="width:${r.m}%"></i></div></td>
          </tr>`).join('')}
          <tr style="background:var(--surface-2)"><td><strong>Total</strong></td>
            <td class="c num"><strong>${total} / ${rows.length * 100}</strong></td>
            <td class="c"><span class="grade ${gradeCls(gradeOf(total / rows.length))}">${gradeOf(total / rows.length)}</span></td>
            <td class="tiny muted">${(total / rows.length).toFixed(1)}% average</td></tr>
          </tbody></table></div>
        <div class="card-foot"><button class="btn btn-ghost btn-sm" onclick="location.hash='#exams?id=${s.id}'">🖨 View / Print Report Card</button></div>
      </div>

      <div class="col" style="gap:1.15rem">
        <div class="card">
          <div class="card-head"><h3>Attendance</h3></div>
          <div class="card-body">
            ${donut([
              { label: 'Present', value: s.attPresent, color: '#0f8a7e' },
              { label: 'Absent', value: s.attTotal - s.attPresent, color: '#d63864' }
            ], a + '%', 'Present')}
            <div style="margin-top:1rem">${legend([
              { label: 'Days present', value: s.attPresent, color: '#0f8a7e' },
              { label: 'Days absent', value: s.attTotal - s.attPresent, color: '#d63864' }
            ])}</div>
            ${a < 75 ? '<p class="small" style="color:var(--danger);margin-top:.8rem">⚠️ Below the 75% requirement for public exam eligibility.</p>' : ''}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Circulars</h3></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:.85rem">
            ${DB.notices.slice(0, 3).map(n => `<div style="border-left:3px solid var(--saffron-500);padding-left:.75rem">
              <strong style="font-size:.87rem">${esc(n.title)}</strong>
              <p class="tiny muted">${fmtDate(n.date)}</p></div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
};

/* ═══════════════════════════ STUDENT MASTER ═══════════════════════════ */
let stuFilter = { cls: '', sec: '', q: '', medium: '', community: '' };
ROUTES.students = view => {
  setHead('Student Master', `${DB.students.length} students on roll`);
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Student Master</h1><p>Search, filter and open any student record.</p></div>
      <div class="row">
        <button class="btn btn-ghost" id="expBtn">⬇ Export CSV</button>
        ${['admin','principal'].includes(ROLE) ? `<a class="btn btn-primary" href="#admission">➕ New Admission</a>` : ''}
      </div>
    </div>
    <div class="toolbar">
      <input class="input grow" id="fq" placeholder="Search name or admission number…" value="${esc(stuFilter.q)}">
      ${classSelect('fc', stuFilter.cls)}
      ${secSelect('fs', stuFilter.sec)}
      <select class="select" id="fm"><option value="">All Media</option>${optList(MEDIUMS, stuFilter.medium)}</select>
      <select class="select" id="fk"><option value="">All Communities</option>${optList(COMMUNITIES, stuFilter.community)}</select>
      <button class="btn btn-ghost btn-sm" id="fclear">Clear</button>
    </div>
    <div class="card"><div class="table-scroll" style="max-height:64vh">
      <table class="table"><thead><tr>
        <th>Student</th><th>Class</th><th>Medium</th><th>Community</th>
        <th class="c">Attendance</th><th class="r">Fee Due</th><th class="c">Action</th>
      </tr></thead><tbody id="stuBody"></tbody></table>
    </div><div class="card-foot"><span class="small muted" id="stuCount"></span></div></div>`;

  const apply = () => {
    const q = stuFilter.q.toLowerCase();
    const list = DB.students.filter(s =>
      (!stuFilter.cls || s.cls === stuFilter.cls) &&
      (!stuFilter.sec || s.sec === stuFilter.sec) &&
      (!stuFilter.medium || s.medium === stuFilter.medium) &&
      (!stuFilter.community || s.community === stuFilter.community) &&
      (!q || s.name.toLowerCase().includes(q) || s.adm.toLowerCase().includes(q)));
    const shown = list.slice(0, 300);
    document.getElementById('stuBody').innerHTML = shown.length
      ? shown.map(studentRow).join('')
      : `<tr><td colspan="7"><div class="empty"><div class="ico">🔍</div>No student matches those filters.</div></td></tr>`;
    document.getElementById('stuCount').textContent =
      `Showing ${shown.length} of ${list.length} matching students (${DB.students.length} total).`;
  };
  const bind = (id, key) => {
    const el = document.getElementById(id);
    el.oninput = el.onchange = () => { stuFilter[key] = el.value; apply(); };
  };
  bind('fq', 'q'); bind('fc', 'cls'); bind('fs', 'sec'); bind('fm', 'medium'); bind('fk', 'community');
  document.getElementById('fclear').onclick = () => {
    stuFilter = { cls: '', sec: '', q: '', medium: '', community: '' };
    ROUTES.students(view);
  };
  document.getElementById('expBtn').onclick = () => exportCSV();
  apply();

  Voice.onCommand = n => {
    const m = n.match(/^(?:search|find|look for)\s+(.+)$/);
    if (m) { stuFilter.q = m[1]; document.getElementById('fq').value = m[1]; apply(); return true; }
    const c = n.match(/^(?:show|filter)?\s*(?:class|standard)\s+([ivx]+)$/i);
    if (c) {
      const cls = c[1].toUpperCase();
      if (CLASSES.includes(cls)) { stuFilter.cls = cls; document.getElementById('fc').value = cls; apply(); return true; }
    }
    return false;
  };
};

function exportCSV() {
  const cols = ['adm','emis','name','gender','cls','sec','roll','medium','group','dob','community','religion','father','mother','phone','address','rte','feeTotal','feePaid'];
  const csv = [cols.join(','), ...DB.students.map(s =>
    cols.map(c => `"${String(s[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = `newgen-students-${todayISO()}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast('Exported ' + DB.students.length + ' student records.', 'ok');
}

/* ═══════════════════════════ STUDENT PROFILE ═══════════════════════════ */
ROUTES.student = (view, p) => {
  const s = DB.student(p.id);
  if (!s) { view.innerHTML = `<div class="empty"><div class="ico">🤷</div>Student not found.</div>`; return; }
  setHead(s.name, `Admission ${s.adm} · Std ${s.cls}-${s.sec}`);
  const a = pct(s.attPresent, s.attTotal), due = Math.max(0, s.feeTotal - s.feePaid);
  const subs = subjectsFor(s.cls, s.group);
  const receipts = DB.receipts.filter(r => r.sid === s.id);

  view.innerHTML = `
    <a href="#students" class="btn btn-quiet btn-sm" style="margin-bottom:.8rem">← Back to Student Master</a>
    <div class="profile-hero">
      <div class="avatar avatar-xl">${initials(s.name)}</div>
      <div style="flex:1;min-width:220px;position:relative;z-index:1">
        <h2>${esc(s.name)}</h2>
        <div class="pill-row" style="margin-top:.55rem">
          <span class="badge">Std ${s.cls}-${s.sec} · Roll ${s.roll}</span>
          <span class="badge">${s.adm}</span>
          <span class="badge">${s.medium}</span>
          <span class="badge">${s.community}</span>
          ${s.group ? `<span class="badge">${s.group}</span>` : ''}
          ${s.rte ? `<span class="badge">RTE 25%</span>` : ''}
        </div>
      </div>
      <div class="row no-print" style="position:relative;z-index:1">
        <button class="btn btn-ghost" style="border-color:rgba(255,255,255,.4);color:#fff" onclick="tcModal('${s.id}')">📄 Certificates</button>
        <a class="btn btn-accent" href="#exams?id=${s.id}">📝 Report Card</a>
      </div>
    </div>

    <div class="grid g4 stagger" style="margin-bottom:1.2rem">
      ${kpi('Attendance', a + '%', `${s.attPresent}/${s.attTotal} days`, '📋', a >= 75 ? 'k2' : 'k4')}
      ${kpi('Fee Paid', INR(s.feePaid), due ? `${INR(due)} outstanding` : 'Fully paid', '💰', 'k3')}
      ${kpi('Age', age(s.dob) + ' yrs', fmtDate(s.dob), '🎂')}
      ${kpi('Admitted', fmtDate(s.admitted), s.status, '📅', 'k5')}
    </div>

    <div class="tabs" id="pTabs">
      <button class="on" data-t="info">Personal & Family</button>
      <button data-t="acad">Academics</button>
      <button data-t="fee">Fees (${receipts.length})</button>
      <button data-t="att">Attendance</button>
    </div>
    <div id="pBody"></div>`;

  const panes = {
    info: () => `<div class="grid g2" style="gap:1.15rem">
      <div class="card"><div class="card-head"><h3>Student Details</h3></div><div class="card-body info-grid">
        ${[['Full Name', s.name], ['Gender', s.gender], ['Date of Birth', fmtDate(s.dob)],
           ['Blood Group', s.blood], ['Community', s.community], ['Religion', s.religion],
           ['Medium', s.medium], ['Mother Tongue', 'Tamil'], ['EMIS ID', s.emis],
           ['Aadhaar', s.aadhaar || '— not captured —'], ['UDISE Pupil ID', s.emis],
           ['Status', s.status]]
          .map(([k, v]) => `<div class="info-item"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}
      </div></div>
      <div class="card"><div class="card-head"><h3>Parent / Guardian</h3></div><div class="card-body info-grid">
        ${[['Father', s.father], ['Occupation', s.fatherOcc], ['Mother', s.mother],
           ['Contact Number', s.phone], ['Address', s.address],
           ['Transport', s.transport || 'Own arrangement'], ['Hostel', s.hostel ? 'Yes' : 'No'],
           ['RTE 25% Seat', s.rte ? 'Yes' : 'No']]
          .map(([k, v]) => `<div class="info-item"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}
      </div></div></div>`,

    acad: () => {
      const rows = subs.map(sub => ({
        sub,
        u: DB.marks[`${s.id}|Unit Test 1|${sub}`] ?? '—',
        q: DB.marks[`${s.id}|Quarterly|${sub}`] ?? '—'
      }));
      return `<div class="card"><div class="card-head"><h3>Subject-wise Performance</h3>
        <span class="badge badge-brand">${s.group || levelOf(s.cls) + ' level'}</span></div>
        <div class="table-scroll"><table class="table">
        <thead><tr><th>Subject</th><th class="c">Unit Test 1 (50)</th><th class="c">Quarterly (100)</th><th class="c">Grade</th><th>Trend</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td><strong>${r.sub}</strong></td>
          <td class="c num">${r.u}</td><td class="c num">${r.q}</td>
          <td class="c"><span class="grade ${gradeCls(gradeOf(+r.q || 0))}">${gradeOf(+r.q || 0)}</span></td>
          <td style="min-width:130px"><div class="meter ${attCls(+r.q || 0)}"><i style="width:${+r.q || 0}%"></i></div></td></tr>`).join('')}
        </tbody></table></div></div>`;
    },

    fee: () => `<div class="grid" style="grid-template-columns:1fr 320px;gap:1.15rem">
      <div class="card"><div class="card-head"><h3>Receipts</h3>
        ${['admin','accountant','principal'].includes(ROLE) ? `<button class="btn btn-primary btn-sm" onclick="collectModal('${s.id}')">➕ Collect Fee</button>` : ''}</div>
        <div class="table-scroll"><table class="table">
        <thead><tr><th>Receipt No.</th><th>Date</th><th>Head</th><th>Mode</th><th class="r">Amount</th></tr></thead>
        <tbody>${receipts.length ? receipts.map(r => `<tr><td class="mono">${r.no}</td><td>${fmtDate(r.date)}</td>
          <td><span class="badge">${r.head}</span></td><td>${r.mode}</td><td class="r"><strong>${INR(r.amount)}</strong></td></tr>`).join('')
          : `<tr><td colspan="5"><div class="empty"><div class="ico">🧾</div>No payments recorded yet.</div></td></tr>`}
        </tbody></table></div></div>
      <div class="card"><div class="card-head"><h3>Summary</h3></div><div class="card-body">
        <div class="stat-line"><span>Annual fee</span><b>${INR(s.feeTotal)}</b></div>
        <div class="stat-line"><span>Paid</span><b style="color:var(--ok)">${INR(s.feePaid)}</b></div>
        <div class="stat-line"><span>Balance</span><b style="color:${due ? 'var(--danger)' : 'var(--ok)'}">${INR(due)}</b></div>
        ${s.rte ? '<p class="small" style="margin-top:.8rem;color:var(--ok)">✅ RTE 25% seat — exempt from all fees.</p>' : ''}
        <div class="meter ${due ? 'warn' : 'ok'}" style="margin-top:.9rem"><i style="width:${s.feeTotal ? pct(s.feePaid, s.feeTotal) : 100}%"></i></div>
        <p class="tiny muted" style="margin-top:.4rem">${s.feeTotal ? pct(s.feePaid, s.feeTotal) : 100}% collected</p>
      </div></div></div>`,

    att: () => {
      const months = ['Jun','Jul','Aug'];
      const r = rng(s.roll * 97 + CLASSES.indexOf(s.cls));
      const data = months.map(m => ({ label: m, v: Math.round(70 + r() * 30), label2: null }));
      data.forEach(d => d.label2 = d.v + '%');
      return `<div class="grid" style="grid-template-columns:1.4fr 1fr;gap:1.15rem">
        <div class="card"><div class="card-head"><h3>Monthly Attendance</h3></div>
          <div class="card-body">${bars(data, 'ok')}</div></div>
        <div class="card"><div class="card-head"><h3>Overall</h3></div><div class="card-body">
          ${donut([{ label: 'Present', value: s.attPresent, color: '#0f8a7e' },
                   { label: 'Absent', value: s.attTotal - s.attPresent, color: '#d63864' }], a + '%', 'Present')}
          <div style="margin-top:1rem">${legend([
            { label: 'Present', value: s.attPresent, color: '#0f8a7e' },
            { label: 'Absent', value: s.attTotal - s.attPresent, color: '#d63864' }])}</div>
          ${a < 75 ? `<p class="small" style="color:var(--danger);margin-top:.9rem">⚠️ Below 75% — not eligible for the public examination unless condoned.</p>` : ''}
        </div></div></div>`;
    }
  };
  const paint = t => {
    document.getElementById('pBody').innerHTML = panes[t]();
    document.querySelectorAll('#pTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  };
  document.querySelectorAll('#pTabs button').forEach(b => b.onclick = () => paint(b.dataset.t));
  paint('info');
};

function tcModal(id) {
  const s = DB.student(id);
  openModal({
    title: 'Generate Certificate',
    body: `<div class="grid" style="gap:.8rem">
      <p class="small muted">For <strong>${esc(s.name)}</strong> · ${s.adm}</p>
      ${[['📄','Transfer Certificate (TC)','On leaving the school'],
         ['🪪','Bonafide Certificate','For scholarships and passport'],
         ['⭐','Conduct Certificate','Character and conduct'],
         ['🏠','Nativity Certificate Request','For district-level applications']]
        .map(([i, t, d]) => `<button class="quick-tile" onclick="closeModal();toast('${t} generated for ${esc(s.name)}','ok')">
          <span class="ico">${i}</span><span><b>${t}</b><small>${d}</small></span></button>`).join('')}
    </div>`,
    actions: [{ label: 'Close', fn: closeModal }]
  });
}

/* ═══════════════════════════ NEW ADMISSION (voice showcase) ═══════════════════════════ */
ROUTES.admission = view => {
  setHead('New Admission', 'Voice-enabled admission form');
  view.innerHTML = `
    <div class="page-head">
      <div><h1>New Admission</h1><p>Academic year ${SCHOOL.year} · every field accepts voice or keyboard.</p></div>
      <div class="row">
        <button class="btn btn-ghost" id="demoFill">⚡ Fill sample</button>
        <button class="btn btn-voice" id="startVoice">🎙 Start guided voice entry</button>
      </div>
    </div>

    <div class="v-banner">
      <span class="em">🎙</span>
      <p><strong>Voice entry is on.</strong> Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> and the form will ask you
      each question aloud — just answer. Or say a field by name any time, e.g.
      <em>“father name Murugesan”</em>, <em>“date of birth twelfth March two thousand ten”</em>, <em>“community M B C”</em>, then <em>“save”</em>.</p>
    </div>

    <form id="admForm" class="grid" style="gap:1.15rem" onsubmit="return false">
      <div class="card">
        <div class="card-head"><h3>1 · Student Details</h3><span class="badge badge-voice">🎙 8 fields</span></div>
        <div class="card-body grid g3">
          <div class="field"><label class="req" for="a_name">Student Name</label>
            <input class="input" id="a_name" data-v="student name|name|pupil name|child name|full name" data-v-ta="மாணவர் பெயர்" required></div>
          <div class="field"><label class="req" for="a_gender">Gender</label>
            <select class="select" id="a_gender" data-v="gender|sex" data-v-ta="பாலினம்"><option value="">—</option><option>Male</option><option>Female</option><option>Transgender</option></select></div>
          <div class="field"><label class="req" for="a_dob">Date of Birth</label>
            <input class="input" type="date" id="a_dob" data-v="date of birth|dob|birth date|born on" data-v-ta="பிறந்த தேதி"></div>
          <div class="field"><label for="a_blood">Blood Group</label>
            <select class="select" id="a_blood" data-v="blood group|blood"><option value="">—</option>${optList(BLOOD)}</select></div>
          <div class="field"><label class="req" for="a_comm">Community</label>
            <select class="select" id="a_comm" data-v="community|caste|category" data-v-ta="சமூகம்"><option value="">—</option>${optList(COMMUNITIES)}</select></div>
          <div class="field"><label for="a_rel">Religion</label>
            <select class="select" id="a_rel" data-v="religion" data-v-ta="மதம்"><option value="">—</option>${optList(RELIGIONS)}</select></div>
          <div class="field"><label for="a_aadhaar">Aadhaar Number</label>
            <input class="input" id="a_aadhaar" data-v="aadhaar|aadhar|aadhaar number|uid" maxlength="12" inputmode="numeric" placeholder="12 digits"></div>
          <div class="field"><label for="a_emis">EMIS ID</label>
            <input class="input" id="a_emis" data-v="emis|emis id|emis number" placeholder="auto if left blank"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>2 · Parent / Guardian</h3><span class="badge badge-voice">🎙 6 fields</span></div>
        <div class="card-body grid g3">
          <div class="field"><label class="req" for="a_father">Father Name</label>
            <input class="input" id="a_father" data-v="father name|father|fathers name|guardian name" data-v-ta="தந்தை பெயர்"></div>
          <div class="field"><label for="a_focc">Father Occupation</label>
            <select class="select" id="a_focc" data-v="father occupation|occupation|fathers job"><option value="">—</option>${optList(OCCUPATIONS)}</select></div>
          <div class="field"><label class="req" for="a_mother">Mother Name</label>
            <input class="input" id="a_mother" data-v="mother name|mother|mothers name" data-v-ta="தாய் பெயர்"></div>
          <div class="field"><label class="req" for="a_phone">Contact Number</label>
            <input class="input" type="tel" id="a_phone" data-v="phone|phone number|mobile|contact number|cell number" data-v-ta="தொலைபேசி எண்" maxlength="10" inputmode="numeric"></div>
          <div class="field" style="grid-column:span 2"><label class="req" for="a_addr">Address</label>
            <input class="input" id="a_addr" data-v="address|residence|door number|street" data-v-ta="முகவரி"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>3 · Academic Placement</h3><span class="badge badge-voice">🎙 5 fields</span></div>
        <div class="card-body grid g3">
          <div class="field"><label class="req" for="a_cls">Standard</label>
            <select class="select" id="a_cls" data-v="standard|class|std|grade" data-v-ta="வகுப்பு"><option value="">—</option>${optList(CLASSES)}</select></div>
          <div class="field"><label class="req" for="a_sec">Section</label>
            <select class="select" id="a_sec" data-v="section|division"><option value="">—</option>${optList(SECTIONS)}</select></div>
          <div class="field"><label class="req" for="a_med">Medium</label>
            <select class="select" id="a_med" data-v="medium|medium of instruction|language" data-v-ta="பயிற்று மொழி"><option value="">—</option>${optList(MEDIUMS)}</select></div>
          <div class="field"><label for="a_group">Group (Std XI–XII)</label>
            <select class="select" id="a_group" data-v="group|subject group|stream"><option value="">—</option>${optList(GROUPS)}</select></div>
          <div class="field"><label for="a_prev">Previous School</label>
            <input class="input" id="a_prev" data-v="previous school|last school|old school"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>4 · Concessions & Facilities</h3><span class="badge badge-voice">🎙 3 fields</span></div>
        <div class="card-body grid g3">
          <div class="field"><label for="a_transport">Transport Route</label>
            <select class="select" id="a_transport" data-v="transport|bus route|route"><option value="">Own arrangement</option>
              ${optList(['Route 1 · Chithode','Route 2 · Thindal','Route 3 · Nasiyanur','Route 4 · Perundurai'])}</select></div>
          <div class="field"><label for="a_rte">RTE 25% Seat</label>
            <select class="select" id="a_rte" data-v="r t e|rte|rte seat|free seat"><option value="No">No</option><option value="Yes">Yes</option></select></div>
          <div class="field"><label for="a_sibling">Sibling in this school</label>
            <select class="select" id="a_sibling" data-v="sibling|brother or sister|sibling concession"><option value="No">No</option><option value="Yes">Yes</option></select></div>
        </div>
        <div class="card-foot row" style="justify-content:space-between">
          <span class="small muted" id="admProgress">0 of 22 fields completed</span>
          <div class="row">
            <button type="button" class="btn btn-ghost js-cancel" id="admCancel">Cancel</button>
            <button type="button" class="btn btn-primary js-save" id="admSave">💾 Save Admission</button>
          </div>
        </div>
      </div>
    </form>`;

  const form = document.getElementById('admForm');
  const save = () => {
    const g = id => document.getElementById(id).value.trim();
    const required = [['a_name','Student Name'],['a_dob','Date of Birth'],['a_father','Father Name'],
                      ['a_mother','Mother Name'],['a_phone','Contact Number'],['a_cls','Standard'],
                      ['a_sec','Section'],['a_med','Medium'],['a_comm','Community']];
    const missing = required.filter(([id]) => !g(id));
    if (missing.length) {
      missing.forEach(([id]) => document.getElementById(id).closest('.field').classList.add('invalid'));
      toast(`Please complete: ${missing.map(m => m[1]).join(', ')}`, 'err', 5000);
      Voice.say('Missing ' + missing.map(m => m[1]).join(', '));
      document.getElementById(missing[0][0]).focus();
      return;
    }
    const adm = 4000 + DB.students.length + 1;
    const cls = g('a_cls');
    const s = {
      id: 'S' + adm, adm: 'NG' + adm, emis: g('a_emis') || '331' + (7120000 + adm),
      name: g('a_name'), gender: g('a_gender') || 'Male', cls, sec: g('a_sec'),
      roll: DB.byClass(cls, g('a_sec')).length + 1, group: g('a_group'),
      medium: g('a_med'), dob: g('a_dob'), community: g('a_comm'), religion: g('a_rel') || 'Hindu',
      blood: g('a_blood') || '—', aadhaar: g('a_aadhaar'),
      father: g('a_father'), fatherOcc: g('a_focc') || '—', mother: g('a_mother'),
      phone: g('a_phone'), address: g('a_addr'), admitted: todayISO(),
      rte: g('a_rte') === 'Yes', transport: g('a_transport'), hostel: false,
      feeTotal: g('a_rte') === 'Yes' ? 0 : FEE_BY_CLASS[cls] * (g('a_sibling') === 'Yes' ? .9 : 1),
      feePaid: 0, attPresent: 0, attTotal: 0, status: 'Active'
    };
    DB.students.push(s); DB.save('students');
    DB.attHistory[s.id] = ''; DB.save('attHistory');
    AI.bust();
    Voice.stop();
    toast(`Admission ${s.adm} created for ${s.name}.`, 'ok', 4500);
    openModal({
      title: '✅ Admission Saved',
      body: `<div style="text-align:center;padding:1rem 0">
        <div class="avatar avatar-xl" style="margin:0 auto 1rem">${initials(s.name)}</div>
        <h3>${esc(s.name)}</h3>
        <p class="muted small">admitted to Std ${s.cls}-${s.sec} · ${s.medium} medium</p>
        <div class="grid g2" style="margin-top:1.2rem;text-align:left">
          <div class="info-item"><span>Admission Number</span><b class="mono">${s.adm}</b></div>
          <div class="info-item"><span>EMIS ID</span><b class="mono">${s.emis}</b></div>
          <div class="info-item"><span>Roll Number</span><b>${s.roll}</b></div>
          <div class="info-item"><span>Annual Fee</span><b>${INR(s.feeTotal)}</b></div>
        </div></div>`,
      actions: [
        { label: 'Admit another', cls: 'btn-ghost', fn: () => { closeModal(); ROUTES.admission(view); } },
        { label: 'Open record →', cls: 'btn-primary', fn: () => { closeModal(); location.hash = '#student?id=' + s.id; } }
      ]
    });
  };

  const progress = () => {
    const fs = [...form.querySelectorAll('[data-v]')];
    const done = fs.filter(f => f.value.trim()).length;
    document.getElementById('admProgress').textContent = `${done} of ${fs.length} fields completed`;
  };
  form.addEventListener('input', e => {
    e.target.closest('.field')?.classList.remove('invalid');
    progress();
  });
  document.getElementById('admSave').onclick = save;
  document.getElementById('admCancel').onclick = () => { Voice.stop(); location.hash = '#students'; };
  document.getElementById('startVoice').onclick = () => Voice.startGuided();
  document.getElementById('demoFill').onclick = () => {
    const d = { a_name:'Karthik Raja', a_gender:'Male', a_dob:'2010-03-12', a_blood:'O+',
      a_comm:'MBC', a_rel:'Hindu', a_aadhaar:'482913756240', a_father:'Murugesan',
      a_focc:'Weaver', a_mother:'Amutha', a_phone:'9843045678',
      a_addr:'42, Perundurai Road, Erode', a_cls:'X', a_sec:'A', a_med:'Tamil',
      a_prev:'Govt. Middle School, Thindal', a_transport:'Route 2 · Thindal', a_rte:'No', a_sibling:'Yes' };
    Object.entries(d).forEach(([k, v]) => { const el = document.getElementById(k); if (el) el.value = v; });
    progress();
    toast('Sample data filled — now try editing a field by voice.', 'ok');
  };

  Voice.attach(form, { onSave: save, onCancel: () => { Voice.stop(); location.hash = '#students'; } });
  progress();
};

/* ═══════════════════════════ ATTENDANCE ═══════════════════════════ */
let attState = { cls: 'X', sec: 'A', date: todayISO(), marks: {}, cursor: 0 };
ROUTES.attendance = view => {
  setHead('Attendance', 'Daily roll call');
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Attendance</h1><p>Mark by tapping, or run a voice roll call — say <em>present</em>, <em>absent</em> or <em>late</em>.</p></div>
      <button class="btn btn-voice" id="rollVoice">🎙 Voice roll call</button>
    </div>
    <div class="v-banner">
      <span class="em">🎙</span>
      <p><strong>Voice roll call.</strong> The engine reads each name aloud and waits. Say
      <em>present</em> / <em>absent</em> / <em>late</em> to mark and move on, or jump anywhere with
      <em>“roll twelve absent”</em>. Say <em>“mark all present”</em> to start from a full class, then correct the exceptions.</p>
    </div>
    <div class="toolbar">
      <label class="lbl">Standard</label>${classSelect('ac', attState.cls, 'Select')}
      <label class="lbl">Section</label>${secSelect('as', attState.sec)}
      <label class="lbl">Date</label><input class="input" type="date" id="ad" value="${attState.date}">
      <button class="btn btn-ghost btn-sm" id="allP">✓ All Present</button>
      <div class="spacer"></div>
      <span id="attSummary" class="small muted"></span>
      <button class="btn btn-primary btn-sm" id="attSave">💾 Save Register</button>
    </div>
    <div class="card"><div id="rollList" style="max-height:62vh;overflow-y:auto"></div></div>`;

  const key = () => `${attState.date}|${attState.cls}|${attState.sec}`;
  const list = () => DB.byClass(attState.cls, attState.sec);

  function paint() {
    const students = list();
    const host = document.getElementById('rollList');
    if (!students.length) {
      host.innerHTML = `<div class="empty"><div class="ico">📋</div>Choose a standard and section.</div>`;
      document.getElementById('attSummary').textContent = ''; return;
    }
    host.innerHTML = students.map((s, i) => {
      const v = attState.marks[s.id];
      return `<div class="roll-row ${i === attState.cursor ? 'cur' : ''}" data-i="${i}">
        <div class="roll-no">${s.roll}</div>
        <div class="roll-name">${esc(s.name)}<small>${s.adm} · ${s.gender} · overall ${pct(s.attPresent, s.attTotal)}%</small></div>
        <div class="pab" data-sid="${s.id}">
          ${['P','A','L'].map(x => `<button data-s="${x}" class="${v === x ? 'on' : ''}">${x}</button>`).join('')}
        </div></div>`;
    }).join('');
    host.querySelectorAll('.pab button').forEach(b => b.onclick = () => {
      mark(b.parentElement.dataset.sid, b.dataset.s);
    });
    host.querySelectorAll('.roll-row').forEach(r => r.onclick = e => {
      if (e.target.closest('.pab')) return;
      attState.cursor = +r.dataset.i; paint();
    });
    const vals = Object.values(attState.marks);
    const p = vals.filter(v => v === 'P').length, a = vals.filter(v => v === 'A').length, l = vals.filter(v => v === 'L').length;
    document.getElementById('attSummary').innerHTML =
      `<span class="badge badge-ok">${p} present</span> <span class="badge badge-danger">${a} absent</span>
       <span class="badge badge-warn">${l} late</span> <span class="badge">${students.length - vals.length} unmarked</span>`;
  }

  function mark(sid, v) {
    attState.marks[sid] = v;
    const i = list().findIndex(s => s.id === sid);
    if (i === attState.cursor) attState.cursor = Math.min(list().length - 1, attState.cursor + 1);
    paint();
    scrollCursor();
  }
  function scrollCursor() {
    document.querySelector('.roll-row.cur')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function promptCursor() {
    const s = list()[attState.cursor];
    if (!s) { Voice.say('Roll call complete. Say save to record the register.'); return; }
    scrollCursor();
    Voice.say(`Roll ${s.roll}. ${s.name}.`);
    Voice.setStatus(`Roll ${s.roll} — ${s.name}. Say present, absent or late.`, 'live');
  }

  const reload = () => {
    attState.marks = Store.get('attendance', {})[key()] || {};
    attState.cursor = 0; paint();
  };
  ['ac','as','ad'].forEach((id, i) => {
    document.getElementById(id).onchange = e => {
      attState[['cls','sec','date'][i]] = e.target.value; reload();
    };
  });
  document.getElementById('allP').onclick = () => {
    list().forEach(s => attState.marks[s.id] = 'P'); paint();
    toast('All marked present — now correct the exceptions.', 'ok');
  };
  document.getElementById('attSave').onclick = () => {
    const students = list();
    if (!students.length) return;
    const store = Store.get('attendance', {});
    const prev = store[key()] || {};

    /* Re-saving the same register must correct the totals, not double-count them. */
    students.forEach(s => {
      const now = attState.marks[s.id];
      if (!now) return;
      const was = prev[s.id];
      const nowPresent = now !== 'A';
      if (!was) {
        s.attTotal += 1;
        if (nowPresent) s.attPresent += 1;
      } else if ((was !== 'A') !== nowPresent) {
        s.attPresent += nowPresent ? 1 : -1;
      }
    });

    /* Append to the day-level history the AI engines read, but only once per date. */
    if (!DB.attDays.includes(attState.date)) {
      DB.attDays.push(attState.date);
      const at = DB.attDays.length - 1;
      DB.students.forEach(s => {
        const h = DB.attHistory[s.id] || '';
        DB.attHistory[s.id] = h.padEnd(at, 'P') + (attState.marks[s.id] || 'P');
      });
      DB.save('attDays'); DB.save('attHistory');
    }

    store[key()] = { ...attState.marks };
    Store.set('attendance', store);
    DB.attendance = store;
    DB.save('students');
    AI.bust();

    const absent = students.filter(s => attState.marks[s.id] === 'A');
    toast(`Register saved for ${attState.cls}-${attState.sec} · ${absent.length} absentee SMS queued.`, 'ok', 4500);
    Voice.say('Register saved.');
  };
  document.getElementById('rollVoice').onclick = () => {
    attState.cursor = 0;
    Voice.mode = 'free';
    Voice.start('free');
    Voice.say(`Roll call for standard ${attState.cls} ${attState.sec}. ${list().length} students.`, promptCursor);
  };

  Voice.attach(view, {
    hint: 'Roll call ready — say “present”, “absent”, “late”, “roll twelve absent” or “mark all present”.',
    onSave: () => document.getElementById('attSave').click()
  });
  Voice.onCommand = n => {
    const students = list();
    if (!students.length) return false;

    if (/^(mark )?all present$/.test(n)) { document.getElementById('allP').click(); return true; }

    // "roll twelve absent" / "roll number 12 present"
    const rm = n.match(/^roll(?:\s+number)?\s+(.+?)\s+(present|absent|late|here|leave)$/);
    if (rm) {
      const num = Voice.parse.wordsToNumber(rm[1]);
      const s = students.find(x => x.roll === num);
      if (s) {
        mark(s.id, rm[2].startsWith('a') ? 'A' : rm[2].startsWith('l') ? 'L' : 'P');
        Voice.pushLog('did', `Roll ${num} · ${s.name} → ${rm[2]}`);
        return true;
      }
      Voice.setStatus(`No roll number ${num} in ${attState.cls}-${attState.sec}.`, 'warn');
      return true;
    }
    // bare status for the current student
    const bare = n.match(/^(present|here|absent|leave|late|சரி|இல்லை)$/);
    if (bare) {
      const s = students[attState.cursor];
      if (!s) return true;
      const v = /absent|leave|இல்லை/.test(bare[1]) ? 'A' : /late/.test(bare[1]) ? 'L' : 'P';
      mark(s.id, v);
      Voice.pushLog('did', `${s.name} → ${v === 'P' ? 'Present' : v === 'A' ? 'Absent' : 'Late'}`);
      setTimeout(promptCursor, 260);
      return true;
    }
    return false;
  };
  reload();
};

/* ═══════════════════════════ MARK ENTRY ═══════════════════════════ */
let mkState = { cls: 'X', sec: 'A', term: 'Quarterly', subject: 'Mathematics', cursor: 0 };
ROUTES.marks = view => {
  setHead('Mark Entry', 'Examination marks');
  const maxOf = t => t.startsWith('Unit') ? 50 : 100;

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Mark Entry</h1><p>Type the score, or speak it — the cursor advances by itself.</p></div>
      <button class="btn btn-voice" id="mkVoice">🎙 Voice mark entry</button>
    </div>
    <div class="v-banner">
      <span class="em">🎙</span>
      <p><strong>Speak the marks.</strong> Start voice entry and simply say <em>“eighty seven”</em> for the highlighted
      student — it fills and moves to the next. Jump about with <em>“roll fourteen ninety two”</em>, correct with
      <em>“undo”</em>, finish with <em>“save”</em>.</p>
    </div>
    <div class="toolbar">
      <label class="lbl">Standard</label>${classSelect('mc', mkState.cls, 'Select')}
      <label class="lbl">Section</label>${secSelect('ms', mkState.sec)}
      <label class="lbl">Exam</label><select class="select" id="mt">${optList(EXAM_TERMS, mkState.term)}</select>
      <label class="lbl">Subject</label><select class="select" id="msub"></select>
      <div class="spacer"></div>
      <span class="small muted" id="mkStat"></span>
      <button class="btn btn-primary btn-sm" id="mkSave">💾 Save Marks</button>
    </div>
    <div class="card"><div class="table-scroll" style="max-height:62vh">
      <table class="table"><thead><tr>
        <th style="width:70px">Roll</th><th>Student</th>
        <th class="c" style="width:130px">Marks <span id="mkMax" class="tiny muted"></span></th>
        <th class="c" style="width:90px">Grade</th><th style="width:150px">Bar</th>
      </tr></thead><tbody id="mkBody"></tbody></table>
    </div></div>`;

  function subjOptions() {
    const sample = DB.byClass(mkState.cls, mkState.sec)[0];
    const subs = sample ? subjectsFor(sample.cls, sample.group) : SUBJECTS_BY_LEVEL.secondary;
    const sel = document.getElementById('msub');
    sel.innerHTML = optList(subs, subs.includes(mkState.subject) ? mkState.subject : subs[0]);
    mkState.subject = sel.value;
  }
  const list = () => DB.byClass(mkState.cls, mkState.sec);
  const mkey = s => `${s.id}|${mkState.term}|${mkState.subject}`;

  function paint() {
    const students = list(), max = maxOf(mkState.term);
    document.getElementById('mkMax').textContent = `/ ${max}`;
    const body = document.getElementById('mkBody');
    if (!students.length) { body.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="ico">✍️</div>Select a class.</div></td></tr>`; return; }
    body.innerHTML = students.map((s, i) => {
      const v = DB.marks[mkey(s)] ?? '';
      const p = v === '' ? 0 : v / max * 100;
      return `<tr class="${i === mkState.cursor ? 'cur-row' : ''}" style="${i === mkState.cursor ? 'background:var(--violet-100)' : ''}">
        <td><div class="roll-no">${s.roll}</div></td>
        <td><strong>${esc(s.name)}</strong><br><span class="tiny muted mono">${s.adm}</span></td>
        <td class="c"><input class="input mark-in ${v !== '' && p < 35 ? 'fail' : p >= 90 ? 'top' : ''}"
              type="number" min="0" max="${max}" value="${v}" data-i="${i}" data-sid="${s.id}"></td>
        <td class="c">${v === '' ? '—' : `<span class="grade ${gradeCls(gradeOf(p))}">${gradeOf(p)}</span>`}</td>
        <td><div class="meter ${attCls(p)}"><i style="width:${p}%"></i></div></td></tr>`;
    }).join('');
    body.querySelectorAll('input').forEach(inp => {
      inp.onfocus = () => { mkState.cursor = +inp.dataset.i; };
      inp.onchange = () => setMark(inp.dataset.sid, inp.value);
    });
    const done = students.filter(s => DB.marks[mkey(s)] !== undefined).length;
    const vals = students.map(s => DB.marks[mkey(s)]).filter(v => v !== undefined);
    const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—';
    const fails = vals.filter(v => v / max * 100 < 35).length;
    document.getElementById('mkStat').innerHTML =
      `<span class="badge badge-brand">${done}/${students.length} entered</span>
       <span class="badge">avg ${avg}</span> <span class="badge ${fails ? 'badge-danger' : 'badge-ok'}">${fails} below 35%</span>`;
  }
  function setMark(sid, val) {
    const max = maxOf(mkState.term), n = Math.max(0, Math.min(max, +val || 0));
    if (val === '') delete DB.marks[`${sid}|${mkState.term}|${mkState.subject}`];
    else DB.marks[`${sid}|${mkState.term}|${mkState.subject}`] = n;
    paint();
  }
  function focusCursor(speak) {
    paint();
    const inp = document.querySelector(`#mkBody input[data-i="${mkState.cursor}"]`);
    inp?.focus({ preventScroll: true });
    inp?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const s = list()[mkState.cursor];
    if (s) {
      Voice.setStatus(`Roll ${s.roll} — ${s.name}. Say the marks out of ${maxOf(mkState.term)}.`, 'live');
      if (speak) Voice.say(`Roll ${s.roll}. ${s.name}.`);
    }
  }

  document.getElementById('mc').onchange = e => { mkState.cls = e.target.value; subjOptions(); mkState.cursor = 0; paint(); };
  document.getElementById('ms').onchange = e => { mkState.sec = e.target.value; mkState.cursor = 0; paint(); };
  document.getElementById('mt').onchange = e => { mkState.term = e.target.value; paint(); };
  document.getElementById('msub').onchange = e => { mkState.subject = e.target.value; mkState.cursor = 0; paint(); };
  document.getElementById('mkSave').onclick = () => {
    DB.save('marks');
    toast(`Marks saved — ${mkState.cls}-${mkState.sec} · ${mkState.subject} · ${mkState.term}.`, 'ok');
    Voice.say('Marks saved.');
  };
  document.getElementById('mkVoice').onclick = () => {
    mkState.cursor = 0;
    Voice.start('free');
    Voice.say(`Mark entry. ${mkState.subject}, ${mkState.term}, out of ${maxOf(mkState.term)}.`, () => focusCursor(true));
  };

  Voice.attach(view, {
    hint: 'Say the marks for the highlighted student, or “roll fourteen ninety two”.',
    onSave: () => document.getElementById('mkSave').click()
  });
  Voice.onCommand = n => {
    const students = list();
    if (!students.length) return false;

    const rm = n.match(/^roll(?:\s+number)?\s+(.+?)\s+(?:gets?|scored?|marks?)?\s*([\w\s]+)$/);
    if (rm) {
      const roll = Voice.parse.wordsToNumber(rm[1]);
      const val = Voice.parse.wordsToNumber(rm[2]);
      const i = students.findIndex(s => s.roll === roll);
      if (i >= 0 && val !== null) {
        mkState.cursor = i; setMark(students[i].id, val);
        Voice.pushLog('did', `Roll ${roll} · ${students[i].name} → ${val}`);
        mkState.cursor = Math.min(students.length - 1, i + 1);
        focusCursor(false);
        return true;
      }
    }
    if (/^(absent|a b|not written|missing)$/.test(n)) {
      const s = students[mkState.cursor];
      if (s) { setMark(s.id, 0); Voice.pushLog('did', `${s.name} → Absent (0)`);
        mkState.cursor = Math.min(students.length - 1, mkState.cursor + 1); focusCursor(true); }
      return true;
    }
    const bare = Voice.parse.wordsToNumber(n);
    if (bare !== null && bare >= 0 && bare <= maxOf(mkState.term)) {
      const s = students[mkState.cursor];
      if (!s) return true;
      setMark(s.id, bare);
      Voice.pushLog('did', `${s.name} → ${bare}`);
      mkState.cursor = Math.min(students.length - 1, mkState.cursor + 1);
      setTimeout(() => focusCursor(true), 200);
      return true;
    }
    return false;
  };

  subjOptions(); paint();
};

/* ═══════════════════════════ REPORT CARDS ═══════════════════════════ */
ROUTES.exams = (view, p) => {
  setHead('Report Cards', 'Progress reports');
  const sid = p.id || DB.students[0].id;
  const s = DB.student(sid) || DB.students[0];
  const term = 'Quarterly', max = 100;
  const subs = subjectsFor(s.cls, s.group);
  const rows = subs.map(sub => {
    const m = DB.marks[`${s.id}|${term}|${sub}`] ?? 0;
    return { sub, m, p: m / max * 100, g: gradeOf(m / max * 100) };
  });
  const total = rows.reduce((a, r) => a + r.m, 0);
  const avg = total / rows.length;
  const cls = DB.byClass(s.cls, s.sec);
  const ranked = cls.map(x => ({
    id: x.id, t: subjectsFor(x.cls, x.group).reduce((a, sub) => a + (DB.marks[`${x.id}|${term}|${sub}`] ?? 0), 0)
  })).sort((a, b) => b.t - a.t);
  const rank = ranked.findIndex(r => r.id === s.id) + 1;

  view.innerHTML = `
    <div class="page-head no-print">
      <div><h1>Report Card</h1><p>Quarterly Examination · ${SCHOOL.year}</p></div>
      <div class="row">
        <select class="select" id="rcStudent" style="min-width:240px">
          ${DB.students.slice(0, 400).map(x => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${esc(x.name)} · ${x.cls}-${x.sec} · Roll ${x.roll}</option>`).join('')}
        </select>
        <button class="btn btn-primary" onclick="print()">🖨 Print</button>
      </div>
    </div>

    <div class="report">
      <div class="report-head">
        <h2>${SCHOOL.name}</h2>
        <p>${SCHOOL.addr} · School Code ${SCHOOL.code} · UDISE ${SCHOOL.udise}</p>
        <p style="margin-top:.5rem"><strong>PROGRESS REPORT — QUARTERLY EXAMINATION ${SCHOOL.year}</strong></p>
      </div>
      <div class="report-meta">
        <div><span>Student Name</span>${esc(s.name)}</div>
        <div><span>Admission No.</span>${s.adm}</div>
        <div><span>Standard / Section</span>${s.cls}-${s.sec}</div>
        <div><span>Roll Number</span>${s.roll}</div>
        <div><span>Father's Name</span>${esc(s.father)}</div>
        <div><span>Medium</span>${s.medium}</div>
        <div><span>EMIS ID</span>${s.emis}</div>
        <div><span>Attendance</span>${pct(s.attPresent, s.attTotal)}% (${s.attPresent}/${s.attTotal})</div>
      </div>
      <table class="table" style="border:1px solid var(--line)">
        <thead><tr><th>Subject</th><th class="c">Max</th><th class="c">Obtained</th><th class="c">Grade</th><th>Remarks</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td><strong>${r.sub}</strong></td><td class="c">${max}</td><td class="c num">${r.m}</td>
          <td class="c"><span class="grade ${gradeCls(r.g)}">${r.g}</span></td>
          <td class="small muted">${r.p >= 90 ? 'Outstanding' : r.p >= 75 ? 'Very good' : r.p >= 60 ? 'Good' : r.p >= 35 ? 'Needs improvement' : 'Reappear'}</td>
        </tr>`).join('')}
        <tr style="background:var(--surface-2)">
          <td><strong>TOTAL</strong></td><td class="c"><strong>${rows.length * max}</strong></td>
          <td class="c num"><strong>${total}</strong></td>
          <td class="c"><span class="grade ${gradeCls(gradeOf(avg))}">${gradeOf(avg)}</span></td>
          <td class="small"><strong>${avg.toFixed(1)}%</strong></td></tr>
        </tbody>
      </table>
      <div class="grid g3" style="margin-top:1.2rem">
        <div class="info-item"><span>Class Rank</span><b>${rank} of ${cls.length}</b></div>
        <div class="info-item"><span>Result</span><b style="color:${rows.some(r => r.p < 35) ? 'var(--danger)' : 'var(--ok)'}">${rows.some(r => r.p < 35) ? 'REAPPEAR' : 'PASS'}</b></div>
        <div class="info-item"><span>Overall Grade</span><b class="grade ${gradeCls(gradeOf(avg))}">${gradeOf(avg)}</b></div>
      </div>
      <div class="row-between" style="margin-top:2.6rem;padding-top:1rem;border-top:1px dashed var(--line-strong)">
        <div class="small muted">Class Teacher</div>
        <div class="small muted">Parent's Signature</div>
        <div class="small muted">Principal</div>
      </div>
      <p class="tiny muted" style="margin-top:1.4rem;text-align:center">
        Grading — A+ 90+ · A 80–89 · B+ 70–79 · B 60–69 · C 50–59 · D 35–49 · RA below 35.
        Minimum 75% attendance is required for public examination eligibility.</p>
    </div>`;

  document.getElementById('rcStudent').onchange = e => location.hash = '#exams?id=' + e.target.value;
};

/* ═══════════════════════════ FEES ═══════════════════════════ */
ROUTES.fees = view => {
  setHead('Fee Collection', 'Counter and receipts');
  const st = DB.stats();
  const byMonth = ['Apr','May','Jun','Jul','Aug'].map((m, i) => {
    const v = DB.receipts.filter(r => +r.date.slice(5, 7) === i + 4).reduce((a, r) => a + r.amount, 0);
    return { label: m, v, label2: INRs(v) };
  });

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Fee Collection</h1><p>Academic year ${SCHOOL.year} · ${DB.receipts.length} receipts issued.</p></div>
      <button class="btn btn-primary" id="collectBtn">➕ Collect Fee</button>
    </div>
    <div class="grid g4 stagger" style="margin-bottom:1.15rem">
      ${kpi('Collected', INRs(st.collected), `${pct(st.collected, st.target)}% of demand`, '💰', 'k2')}
      ${kpi('Outstanding', INRs(st.due), `${st.defaulters} students`, '⚠️', 'k4')}
      ${kpi('Total Demand', INRs(st.target), `${st.total} students`, '📊')}
      ${kpi('RTE Exempt', st.rte, 'no fee payable', '🏛', 'k5')}
    </div>
    <div class="grid" style="grid-template-columns:1.5fr 1fr;gap:1.15rem;margin-bottom:1.15rem">
      <div class="card"><div class="card-head"><h3>Monthly Collection</h3></div>
        <div class="card-body">${bars(byMonth, 'alt')}</div></div>
      <div class="card"><div class="card-head"><h3>Collection Status</h3></div><div class="card-body">
        ${donut([{ label: 'Collected', value: st.collected, color: '#0f8a7e' },
                 { label: 'Outstanding', value: st.due, color: '#d63864' }], pct(st.collected, st.target) + '%', 'Collected')}
        <div style="margin-top:1.1rem">
          <div class="stat-line"><span>Collected</span><b style="color:var(--ok)">${INR(st.collected)}</b></div>
          <div class="stat-line"><span>Outstanding</span><b style="color:var(--danger)">${INR(st.due)}</b></div>
          <div class="stat-line"><span>Total demand</span><b>${INR(st.target)}</b></div>
        </div></div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Receipt Register</h3>
        <input class="input" id="rcSearch" placeholder="Search name or receipt no…" style="width:240px"></div>
      <div class="table-scroll" style="max-height:52vh"><table class="table">
        <thead><tr><th>Receipt</th><th>Date</th><th>Student</th><th>Class</th><th>Head</th><th>Mode</th><th class="r">Amount</th></tr></thead>
        <tbody id="rcBody"></tbody></table></div>
      <div class="card-foot"><span class="small muted" id="rcTotal"></span></div>
    </div>`;

  const paint = (q = '') => {
    const list = DB.receipts.filter(r =>
      !q || r.name.toLowerCase().includes(q) || r.no.toLowerCase().includes(q)).slice(0, 200);
    document.getElementById('rcBody').innerHTML = list.map(r => `<tr>
      <td class="mono">${r.no}</td><td>${fmtDate(r.date)}</td>
      <td><a href="#student?id=${r.sid}">${esc(r.name)}</a></td>
      <td>${r.cls}-${r.sec}</td><td><span class="badge">${r.head}</span></td><td>${r.mode}</td>
      <td class="r"><strong>${INR(r.amount)}</strong></td></tr>`).join('')
      || `<tr><td colspan="7"><div class="empty"><div class="ico">🧾</div>No receipts found.</div></td></tr>`;
    document.getElementById('rcTotal').textContent =
      `${list.length} receipts shown · ${INR(list.reduce((a, r) => a + r.amount, 0))}`;
  };
  document.getElementById('rcSearch').oninput = e => paint(e.target.value.toLowerCase());
  document.getElementById('collectBtn').onclick = () => collectModal();
  paint();

  Voice.attach(view);
  Voice.onCommand = n => {
    if (/^(collect fee|new receipt|collect)$/.test(n)) { collectModal(); return true; }
    const m = n.match(/^(?:search|find)\s+(.+)$/);
    if (m) { document.getElementById('rcSearch').value = m[1]; paint(m[1].toLowerCase()); return true; }
    return false;
  };
};

function collectModal(sid) {
  const students = DB.students.filter(s => s.feeTotal - s.feePaid > 0 || s.id === sid);
  openModal({
    title: '💰 Collect Fee',
    wide: true,
    body: `<div class="v-banner"><span class="em">🎙</span>
        <p><strong>Voice enabled.</strong> Say <em>“student Karthik Raja”</em>, <em>“head term fee”</em>,
        <em>“amount five thousand”</em>, <em>“mode U P I”</em>, then <em>“save”</em>.</p></div>
      <form id="feeForm" class="grid g2" style="gap:1rem" onsubmit="return false">
        <div class="field" style="grid-column:span 2"><label class="req" for="f_stu">Student</label>
          <select class="select" id="f_stu" data-v="student|student name|name|pupil">
            <option value="">—</option>
            ${students.slice(0, 400).map(s => `<option value="${s.id}" ${s.id === sid ? 'selected' : ''}>${esc(s.name)} · ${s.cls}-${s.sec} · due ${INR(s.feeTotal - s.feePaid)}</option>`).join('')}
          </select></div>
        <div class="field"><label class="req" for="f_head">Fee Head</label>
          <select class="select" id="f_head" data-v="head|fee head|towards|for"><option value="">—</option>${optList(FEE_HEADS)}</select></div>
        <div class="field"><label class="req" for="f_amt">Amount (₹)</label>
          <input class="input" type="number" id="f_amt" data-v="amount|rupees|sum|fee amount" min="1"></div>
        <div class="field"><label class="req" for="f_mode">Payment Mode</label>
          <select class="select" id="f_mode" data-v="mode|payment mode|paid by|method"><option value="">—</option>${optList(['Cash','UPI','Net Banking','Cheque','DD'])}</select></div>
        <div class="field"><label for="f_date">Date</label>
          <input class="input" type="date" id="f_date" data-v="date|receipt date" value="${todayISO()}"></div>
        <div class="field" style="grid-column:span 2"><label for="f_note">Remarks</label>
          <input class="input" id="f_note" data-v="remarks|note|comment" placeholder="optional"></div>
      </form>`,
    actions: [
      { label: 'Cancel', cls: 'btn-ghost js-cancel', fn: () => { Voice.stop(); closeModal(); } },
      { label: '🎙 Guided voice', cls: 'btn-voice', fn: () => Voice.startGuided() },
      { label: '💾 Save Receipt', cls: 'btn-primary js-save', fn: saveFee }
    ],
    onOpen: body => Voice.attach(body.querySelector('#feeForm'),
      { onSave: saveFee, onCancel: () => { Voice.stop(); closeModal(); } })
  });

  function saveFee() {
    const g = id => document.getElementById(id).value;
    const s = DB.student(g('f_stu'));
    const amt = +g('f_amt');
    if (!s || !amt || !g('f_head') || !g('f_mode')) {
      toast('Student, head, amount and mode are all required.', 'err');
      Voice.say('Please complete student, head, amount and mode.');
      return;
    }
    const no = 'RC' + (2000 + DB.receipts.length);
    DB.receipts.unshift({ id: uid('r'), no, sid: s.id, name: s.name, cls: s.cls, sec: s.sec,
      date: g('f_date') || todayISO(), head: g('f_head'), mode: g('f_mode'), amount: amt });
    s.feePaid += amt;
    DB.save('receipts'); DB.save('students');
    Voice.stop(); closeModal();
    toast(`Receipt ${no} — ${INR(amt)} from ${s.name}.`, 'ok', 4500);
    if (location.hash.startsWith('#fees')) route(); else if (location.hash.startsWith('#student')) route();
  }
}

/* ═══════════════════════════ DEFAULTERS ═══════════════════════════ */
ROUTES.defaulters = view => {
  setHead('Fee Dues', 'Outstanding balances');
  const list = DB.students.filter(s => s.feeTotal - s.feePaid > 0)
    .sort((a, b) => (b.feeTotal - b.feePaid) - (a.feeTotal - a.feePaid));
  const totalDue = list.reduce((a, s) => a + s.feeTotal - s.feePaid, 0);

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Fee Dues</h1><p>${list.length} students with an outstanding balance of ${INR(totalDue)}.</p></div>
      <button class="btn btn-accent" onclick="toast('Reminder SMS queued to ${list.length} parents.','ok')">📱 Send SMS Reminders</button>
    </div>
    <div class="card"><div class="table-scroll" style="max-height:70vh"><table class="table">
      <thead><tr><th>Student</th><th>Class</th><th>Contact</th><th class="r">Demand</th><th class="r">Paid</th><th class="r">Balance</th><th>Progress</th><th class="c">Action</th></tr></thead>
      <tbody>${list.slice(0, 250).map(s => {
        const due = s.feeTotal - s.feePaid;
        return `<tr>
          <td><a href="#student?id=${s.id}"><strong>${esc(s.name)}</strong></a><br><span class="tiny muted mono">${s.adm}</span></td>
          <td>${s.cls}-${s.sec}</td><td class="mono tiny">${s.phone}</td>
          <td class="r">${INR(s.feeTotal)}</td><td class="r">${INR(s.feePaid)}</td>
          <td class="r"><strong style="color:var(--danger)">${INR(due)}</strong></td>
          <td style="min-width:110px"><div class="meter ${pct(s.feePaid, s.feeTotal) > 60 ? 'warn' : 'danger'}"><i style="width:${pct(s.feePaid, s.feeTotal)}%"></i></div></td>
          <td class="c"><button class="btn btn-primary btn-sm" onclick="collectModal('${s.id}')">Collect</button></td></tr>`;
      }).join('')}</tbody></table></div></div>`;
};

/* ═══════════════════════════ STAFF ═══════════════════════════ */
ROUTES.staff = view => {
  setHead('Staff', `${DB.staff.length} members`);
  view.innerHTML = `
    <div class="page-head"><div><h1>Staff Register</h1><p>Teaching and non-teaching staff.</p></div></div>
    <div class="grid g4 stagger" style="margin-bottom:1.15rem">
      ${kpi('Total Staff', DB.staff.length, 'on roll', '👥')}
      ${kpi('Teaching', DB.staff.filter(s => s.role === 'Teacher').length, 'class & subject teachers', '👩‍🏫', 'k2')}
      ${kpi('Pupil–Teacher Ratio', '1 : ' + Math.round(DB.students.length / DB.staff.filter(s => s.role === 'Teacher').length), 'against 1:30 norm', '📐', 'k3')}
      ${kpi('Non-Teaching', DB.staff.filter(s => s.role !== 'Teacher').length, 'office & support', '🗂', 'k5')}
    </div>
    <div class="card"><div class="table-scroll"><table class="table">
      <thead><tr><th>Staff</th><th>Role</th><th>Subject</th><th>Class</th><th>Qualification</th><th>Contact</th><th>Joined</th></tr></thead>
      <tbody>${DB.staff.map(s => `<tr>
        <td><div class="row" style="gap:.55rem"><span class="avatar avatar-sm">${initials(s.name)}</span>
          <span><strong>${esc(s.name)}</strong><br><span class="tiny muted mono">${s.id}</span></span></div></td>
        <td><span class="badge ${s.role === 'Teacher' ? 'badge-brand' : ''}">${s.role}</span></td>
        <td>${s.subject}</td><td>${s.cls}</td><td class="small">${s.qual}</td>
        <td class="mono tiny">${s.phone}</td><td class="small">${fmtDate(s.joined)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
};

/* ═══════════════════════════ NOTICES ═══════════════════════════ */
ROUTES.notices = view => {
  setHead('Circulars', 'Notice board');
  const canPost = ['admin','principal'].includes(ROLE);
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Circulars & Notices</h1><p>Broadcast to parents, students and staff.</p></div>
      ${canPost ? `<button class="btn btn-primary" id="newNotice">➕ New Circular</button>` : ''}
    </div>
    <div class="grid" style="gap:.9rem">
      ${DB.notices.map(n => `<div class="card card-pad">
        <div class="row-between" style="margin-bottom:.5rem">
          <h3 style="font-size:1.02rem">${esc(n.title)}</h3>
          <span class="badge badge-brand">${esc(n.to)}</span></div>
        <p class="small" style="color:var(--text-soft)">${esc(n.body)}</p>
        <div class="row" style="gap:.5rem;margin-top:.7rem">
          <span class="tiny muted">📅 ${fmtDate(n.date)}</span>
          <span class="tiny muted">· issued by ${esc(n.by)}</span></div>
      </div>`).join('')}
    </div>`;

  if (!canPost) return;
  document.getElementById('newNotice').onclick = () => openModal({
    title: '📢 New Circular',
    body: `<div class="v-banner"><span class="em">🎙</span>
        <p><strong>Dictate it.</strong> Say <em>“title parent teacher meeting”</em>, then
        <em>“body meeting on Saturday at ten a m”</em>, choose the audience and say <em>“save”</em>.</p></div>
      <form id="ntForm" class="grid" style="gap:1rem" onsubmit="return false">
        <div class="field"><label class="req" for="n_title">Title</label>
          <input class="input" id="n_title" data-v="title|subject|heading|circular title"></div>
        <div class="field"><label class="req" for="n_body">Message</label>
          <textarea class="textarea" id="n_body" data-v="body|message|content|text|details"></textarea></div>
        <div class="grid g2">
          <div class="field"><label for="n_to">Audience</label>
            <select class="select" id="n_to" data-v="audience|to|send to|recipients">
              ${optList(['All','Parents','Staff','Std X, XII','Std XI, XII','Primary Section'])}</select></div>
          <div class="field"><label for="n_date">Date</label>
            <input class="input" type="date" id="n_date" data-v="date" value="${todayISO()}"></div>
        </div>
      </form>`,
    actions: [
      { label: 'Cancel', cls: 'btn-ghost js-cancel', fn: () => { Voice.stop(); closeModal(); } },
      { label: '🎙 Guided voice', cls: 'btn-voice', fn: () => Voice.startGuided() },
      { label: '📢 Publish', cls: 'btn-primary js-save', fn: publish }
    ],
    onOpen: b => Voice.attach(b.querySelector('#ntForm'), { onSave: publish, onCancel: () => { Voice.stop(); closeModal(); } })
  });

  function publish() {
    const t = document.getElementById('n_title').value.trim();
    const bd = document.getElementById('n_body').value.trim();
    if (!t || !bd) { toast('Title and message are required.', 'err'); Voice.say('Title and message are required.'); return; }
    DB.notices.unshift({ id: uid('n'), date: document.getElementById('n_date').value || todayISO(),
      title: t, body: bd, to: document.getElementById('n_to').value, by: DEMO_USERS[ROLE].name });
    DB.save('notices');
    Voice.stop(); closeModal();
    toast('Circular published — SMS queued.', 'ok');
    route();
  }
};

/* ═══════════════════════════ REPORTS / GOVT ═══════════════════════════ */
ROUTES.reports = view => {
  setHead('Reports & Government Returns', 'EMIS · UDISE+ · schemes');
  const st = DB.stats();
  const byComm = COMMUNITIES.map(c => ({ c, n: DB.students.filter(s => s.community === c).length }));
  const byMedium = MEDIUMS.map(m => ({ m, n: DB.students.filter(s => s.medium === m).length }));

  view.innerHTML = `
    <div class="page-head"><div><h1>Reports & Government Returns</h1>
      <p>Statutory data for the Directorate of School Education, Tamil Nadu.</p></div></div>

    <div class="grid g4 stagger" style="margin-bottom:1.2rem">
      ${kpi('Total Enrolment', st.total, `${st.boys} boys · ${st.girls} girls`, '👨‍🎓')}
      ${kpi('RTE 25% Seats', st.rte, 'exempt from all fees', '🏛', 'k2')}
      ${kpi('Noon Meal Beneficiaries', DB.students.filter(s => CLASSES.indexOf(s.cls) <= 7).length, 'Std I–VIII', '🍛', 'k3')}
      ${kpi('Free Textbook Sets', st.total, 'issued this year', '📚', 'k5')}
    </div>

    <div class="grid g2" style="gap:1.15rem;margin-bottom:1.15rem">
      <div class="card"><div class="card-head"><h3>Community-wise Strength</h3><span class="badge">EMIS Annexure II</span></div>
        <div class="table-scroll"><table class="table"><thead><tr><th>Community</th><th class="r">Boys</th><th class="r">Girls</th><th class="r">Total</th><th class="r">%</th></tr></thead>
        <tbody>${byComm.map(x => {
          const b = DB.students.filter(s => s.community === x.c && s.gender === 'Male').length;
          const g = x.n - b;
          return `<tr><td><strong>${x.c}</strong></td><td class="r">${b}</td><td class="r">${g}</td>
            <td class="r"><strong>${x.n}</strong></td><td class="r">${pct(x.n, st.total)}%</td></tr>`;
        }).join('')}</tbody></table></div></div>

      <div class="card"><div class="card-head"><h3>Medium of Instruction</h3><span class="badge">UDISE+ 8.1</span></div>
        <div class="card-body">
          ${donut(byMedium.map((x, i) => ({ label: x.m, value: x.n, color: ['#2c47a8','#0f8a7e'][i] })), st.total, 'Students')}
          <div style="margin-top:1.1rem">${legend(byMedium.map((x, i) => ({ label: x.m + ' medium', value: x.n, color: ['#2c47a8','#0f8a7e'][i] })), st.total)}</div>
        </div></div>
    </div>

    <h3 style="margin-bottom:.8rem">Downloadable Returns</h3>
    <div class="grid g3">
      ${[['📊','EMIS Student Data','Full student master in EMIS upload format'],
         ['🏫','UDISE+ Annual Return','Infrastructure, enrolment and staff'],
         ['🏛','RTE 25% Admission Register','Section 12(1)(c) claim statement'],
         ['🍛','Noon Meal Daily Register','Headcount and cost statement'],
         ['🎓','Scholarship Nominal Roll','SC/ST, BC/MBC, minority & first-graduate'],
         ['📚','Free Supply Distribution','Textbooks, uniforms, footwear, bus pass'],
         ['📝','Public Exam Nominal Roll','Std X and XII CoE data'],
         ['👥','Staff Return','Teaching and non-teaching particulars'],
         ['📈','Board Result Analysis','Subject-wise pass percentage']]
        .map(([i, t, d]) => `<button class="quick-tile" onclick="toast('${t} prepared — download queued.','ok')">
          <span class="ico">${i}</span><span><b>${t}</b><small>${d}</small></span></button>`).join('')}
    </div>`;
};

/* ═══════════════════════════ SETTINGS ═══════════════════════════ */
ROUTES.settings = view => {
  setHead('Settings', 'Preferences and demo data');
  view.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><p>Appearance, voice and demo data.</p></div></div>
    <div class="grid g2" style="gap:1.15rem">
      <div class="card"><div class="card-head"><h3>Appearance</h3></div><div class="card-body col" style="gap:1rem">
        <div class="row-between"><span>Theme</span>
          <div class="seg" id="themeSeg">
            <button data-t="light" class="${document.documentElement.dataset.theme === 'light' ? 'on' : ''}">Light</button>
            <button data-t="dark" class="${document.documentElement.dataset.theme === 'dark' ? 'on' : ''}">Dark</button>
          </div></div>
      </div></div>

      <div class="card"><div class="card-head"><h3>🎙 Voice Entry</h3></div><div class="card-body col" style="gap:1rem">
        <div class="row-between"><span>Recognition language</span>
          <select class="select" id="setLang" style="width:auto">
            <option value="en-IN" ${Voice.lang === 'en-IN' ? 'selected' : ''}>English (India)</option>
            <option value="ta-IN" ${Voice.lang === 'ta-IN' ? 'selected' : ''}>தமிழ் (Tamil)</option>
          </select></div>
        <div class="row-between"><span>Speak prompts aloud</span>
          <label class="check"><input type="checkbox" id="setTTS" ${Voice.speakPrompts ? 'checked' : ''}> Enabled</label></div>
        <div class="row-between"><span>Browser support</span>
          <span class="badge ${Voice.supported ? 'badge-ok' : 'badge-warn'}">${Voice.supported ? 'Speech recognition available' : 'Not available — typed console'}</span></div>
        <button class="btn btn-ghost btn-sm" onclick="Voice.showHelp()">📖 Voice command reference</button>
      </div></div>

      <div class="card"><div class="card-head"><h3>School Profile</h3></div><div class="card-body info-grid">
        ${[['Name', SCHOOL.name], ['Address', SCHOOL.addr], ['School Code', SCHOOL.code],
           ['UDISE Code', SCHOOL.udise], ['Academic Year', SCHOOL.year], ['Established', SCHOOL.est],
           ['Phone', SCHOOL.phone], ['Email', SCHOOL.email]]
          .map(([k, v]) => `<div class="info-item"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}
      </div></div>

      <div class="card"><div class="card-head"><h3>Demo Data</h3></div><div class="card-body col" style="gap:.9rem">
        <p class="small muted">All records live in this browser's local storage. Nothing leaves your machine.</p>
        <div class="stat-line"><span>Students</span><b>${DB.students.length}</b></div>
        <div class="stat-line"><span>Mark entries</span><b>${Object.keys(DB.marks).length}</b></div>
        <div class="stat-line"><span>Receipts</span><b>${DB.receipts.length}</b></div>
        <div class="row" style="margin-top:.5rem">
          <button class="btn btn-ghost btn-sm" onclick="exportCSV()">⬇ Export students CSV</button>
          <button class="btn btn-danger btn-sm" id="resetBtn">↺ Reset demo data</button>
        </div>
      </div></div>
    </div>`;

  document.querySelectorAll('#themeSeg button').forEach(b => b.onclick = () => {
    applyTheme(b.dataset.t);
    document.querySelectorAll('#themeSeg button').forEach(x => x.classList.toggle('on', x === b));
  });
  document.getElementById('setLang').onchange = e => {
    Voice.lang = e.target.value; Store.set('voiceLang', Voice.lang);
    if (Voice.rec) Voice.rec.lang = Voice.lang;
    document.getElementById('vLang').value = Voice.lang;
    toast('Voice language updated.', 'ok');
  };
  document.getElementById('setTTS').onchange = e => {
    Voice.speakPrompts = e.target.checked; Store.set('voiceTTS', Voice.speakPrompts);
  };
  document.getElementById('resetBtn').onclick = () => openModal({
    title: 'Reset demo data?',
    body: `<p>This clears every student, mark, receipt and attendance record you have entered and restores the original sample data.</p>`,
    actions: [
      { label: 'Keep my data', cls: 'btn-ghost', fn: closeModal },
      { label: 'Reset everything', cls: 'btn-danger', fn: () => { DB.reset(); AI.bust(); closeModal(); toast('Demo data restored.', 'ok'); route(); } }
    ]
  });
};

/* ═══════════════════════════ AI SHARED UI ═══════════════════════════ */

const AI_CHIP = '<span class="ai-chip"><span class="spark">✦</span>AI</span>';

/** The intelligence band on the dashboard. */
function aiBand() {
  const s = AI.summary();
  const critical = s.att.critical;
  const blockers = s.quality.blockers;
  const value = s.scholarships.value;

  const card = (href, ico, label, figure, caption, go, urgent, beacon) => `
    <a class="ai-card ${urgent ? 'urgent' : ''}" href="#${href}">
      <div class="ai-card-top">
        <span class="label">${beacon ? `<span class="beacon ${beacon}"></span>` : ''}${label}</span>
        <span class="ico">${ico}</span>
      </div>
      <b class="figure">${figure}</b>
      <div class="caption">${caption}</div>
      <span class="go">Open →</span>
    </a>`;

  return `
  <div class="ai-band">
    <div class="ai-band-inner">
      <div class="ai-band-head">
        ${AI_CHIP}
        <h3>Intelligence</h3>
        <span class="sub">Computed on this device from ${DB.students.length} student records · no data left the browser</span>
        <div class="spacer"></div>
        <span class="tiny muted mono">engine v${AI.VERSION}</span>
      </div>
      <div class="ai-cards">
        ${card('insights', '🧠', 'Attendance Alerts',
          s.att.flagged,
          critical
            ? `<strong style="color:var(--danger)">${critical} need action today</strong> — including ${s.att.stopped} who have stopped attending altogether.`
            : `${s.att.high} high priority. No child has stopped attending.`,
          '', critical > 0, critical > 0 ? 'beacon' : '')}

        ${card('dataquality', '🩺', 'Data Quality',
          s.quality.score + '<span style="font-size:1rem">/100</span>',
          blockers
            ? `<strong style="color:var(--danger)">${blockers} blocking defects</strong> would fail the UDISE+ upload right now.`
            : `Clean. ${s.quality.warnings} warnings remain, none blocking.`,
          '', blockers > 0, blockers > 0 ? 'beacon-warn' : 'beacon-ok')}

        ${card('scholarships', '🎁', 'Unclaimed Entitlements',
          INRs(value),
          `${s.scholarships.matched} students match at least one scheme.` +
          (s.scholarships.recoverable ? ` A further <strong>${INRs(s.scholarships.recoverable)}</strong> unlocks if attendance recovers.` : ''),
          '', false, 'beacon-ai')}
      </div>
    </div>
  </div>`;
}

/** Day-by-day attendance rendered as a strip — the pattern is the point. */
function attStrip(sid, from = 0) {
  const h = (DB.attHistory[sid] || '').slice(from);
  if (!h) return '<span class="tiny muted">No daily record</span>';
  return `<div class="att-strip" title="${h.length} working days — green present, amber late, red absent">
    ${[...h].map((c, i) => `<i class="${c.toLowerCase()}" title="${fmtDate(DB.attDays[from + i])} · ${c === 'P' ? 'Present' : c === 'L' ? 'Late' : 'Absent'}"></i>`).join('')}
  </div>`;
}

function gauge(score) {
  const C = 2 * Math.PI * 70;
  const len = C * Math.max(0, Math.min(100, score)) / 100;
  const color = score >= 90 ? '#0f8a7e' : score >= 75 ? '#e89b12' : '#d63864';
  return `<div class="gauge">
    <svg width="168" height="168" viewBox="0 0 168 168">
      <circle r="70" cx="84" cy="84" fill="none" stroke="var(--surface-3)" stroke-width="14"/>
      <circle r="70" cx="84" cy="84" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"
              stroke-dasharray="${len.toFixed(1)} ${(C - len).toFixed(1)}"/>
    </svg>
    <div class="val"><b style="color:${color}">${score}</b><span>Data Health</span></div>
  </div>`;
}

const AI_DISCLOSURE = `
  <div class="ai-note">
    <strong>How this works.</strong> Every figure on this screen is computed locally in your browser from
    the school's own records — no student data is sent anywhere, which is what the DPDP Act requires for
    children's data. These are <strong>flags for a human to act on, not decisions</strong>: nothing here
    fails a student, cancels an entitlement or files a return. Each finding shows the evidence that
    produced it, so you can disagree with it.
  </div>`;

/* ═══════════════════════════ 1 · ATTENDANCE ALERTS ═══════════════════════════ */
let insFilter = { sev: '', cls: '' };
ROUTES.insights = view => {
  setHead('Attendance Alerts', 'Pattern detection & eligibility forecasting');
  const all = AI.attendance.all();
  const s = AI.attendance.summary();

  view.innerHTML = `
    <div class="ai-hero"><div class="ai-hero-inner">
      <div class="row" style="gap:.6rem">${AI_CHIP}<span class="badge badge-voice">On-device</span></div>
      <h1>Attendance Alerts</h1>
      <p>Aggregate attendance hides what matters. A child at 68% who is drifting down week by week and a
      child at 68% who missed one illness block are the same number and completely different problems.
      This reads each student's day-by-day record, names the pattern, and projects whether the 75%
      public-exam threshold is still reachable.</p>
    </div></div>

    <div class="grid g4 stagger" style="margin-bottom:1.2rem">
      ${kpi('Students Flagged', s.flagged, `of ${DB.students.length} on roll`, '🧠', 'k5')}
      ${kpi('Need Action Today', `${s.critical}`, s.critical ? '<span class="beacon"></span> critical patterns' : 'none outstanding', '🚨', 'k4')}
      ${kpi('Stopped Attending', s.stopped, '8+ consecutive days absent', '🚪', 'k4')}
      ${kpi('Eligibility At Risk', s.ineligible, 'may miss the 75% requirement', '📉', 'k3')}
    </div>

    <div class="toolbar">
      <label class="lbl">Severity</label>
      <select class="select" id="insSev">
        <option value="">All severities</option>
        <option value="critical">Critical only</option>
        <option value="high">High and above</option>
        <option value="medium">Medium and above</option>
      </select>
      <label class="lbl">Standard</label>${classSelect('insCls', insFilter.cls)}
      <div class="spacer"></div>
      <span class="small muted" id="insCount"></span>
      <button class="btn btn-ghost btn-sm" id="insExport">⬇ Export action list</button>
    </div>

    <div id="insList" class="grid" style="gap:.9rem"></div>
    ${AI_DISCLOSURE}`;

  const RANK = { critical: 3, high: 2, medium: 1, low: 0 };
  function paint() {
    const min = insFilter.sev ? RANK[insFilter.sev] : -1;
    const list = all.filter(r =>
      (!insFilter.cls || r.student.cls === insFilter.cls) &&
      (min < 0 || RANK[r.band] >= min));

    document.getElementById('insCount').textContent =
      `${list.length} student${list.length === 1 ? '' : 's'} shown`;

    document.getElementById('insList').innerHTML = list.length ? list.slice(0, 60).map(r => {
      const st = r.student, f = r.forecast;
      return `<div class="card">
        <div class="card-head" style="align-items:flex-start">
          <div class="row" style="gap:.7rem;align-items:flex-start">
            <span class="avatar">${initials(st.name)}</span>
            <div>
              <h4 style="margin:0"><a href="#student?id=${st.id}">${esc(st.name)}</a></h4>
              <span class="tiny muted">Std ${st.cls}-${st.sec} · Roll ${st.roll} · ${st.adm} · guardian ${esc(st.father || '—')} · ${st.phone}</span>
            </div>
          </div>
          <div style="text-align:right;flex:none">
            <span class="sev sev-${r.band}">${r.band}</span>
            <div class="risk-bar risk-${r.band}" style="margin-top:.4rem;width:90px"><i style="width:${r.risk}%"></i></div>
            <span class="tiny muted">risk ${r.risk}/100</span>
          </div>
        </div>
        <div class="card-body">
          <div class="row-between" style="margin-bottom:.35rem">
            <span class="tiny muted">Every working day since ${fmtDate(DB.attDays[0])}</span>
            <span class="tiny"><strong>${pct(st.attPresent, st.attTotal)}%</strong> · ${st.attPresent}/${st.attTotal} days</span>
          </div>
          ${attStrip(st.id)}

          <div style="margin-top:.9rem">
            ${r.flags.map(fl => `<div class="why">
              <b>${esc(fl.title)}</b> <span class="sev sev-${fl.severity}">${fl.severity}</span><br>
              ${esc(fl.evidence)}<br>
              <span style="color:var(--ai-2)">→ ${esc(fl.action)}</span>
            </div>`).join('')}

            <div class="why" style="border-left-color:${f.band === 'impossible' || f.band === 'critical' ? 'var(--danger)' : f.band === 'on-track' || f.band === 'secured' ? 'var(--ok)' : 'var(--warn)'}">
              <b>75% eligibility forecast</b><br>
              ${esc(f.verdict)}<br>
              <span class="tiny muted">${f.elapsed} working days done, ${f.remaining} remain of ${YEAR_WORKING_DAYS}.
              Needs ${f.need} more present days to reach the ${f.required}-day threshold.
              Projected year-end at the current rate: <strong>${Math.round(f.projected * 100)}%</strong>.</span>
            </div>
          </div>
        </div>
        <div class="card-foot row" style="justify-content:flex-end;gap:.4rem">
          <a class="btn btn-ghost btn-sm" href="tel:${st.phone}">📞 Call guardian</a>
          <button class="btn btn-ghost btn-sm" onclick="toast('Absence letter queued for ${esc(st.name)}.','ok')">✉️ Send letter</button>
          <a class="btn btn-primary btn-sm" href="#student?id=${st.id}">Open record →</a>
        </div>
      </div>`;
    }).join('') + (list.length > 60 ? `<p class="small muted" style="text-align:center">Showing the 60 highest-risk of ${list.length}. Narrow with the filters above.</p>` : '')
      : `<div class="all-clear"><div class="ico">✅</div>
         <h3>Nothing flagged</h3><p class="small">No attendance pattern in this selection needs attention.</p></div>`;
  }

  document.getElementById('insSev').onchange = e => { insFilter.sev = e.target.value; paint(); };
  document.getElementById('insCls').onchange = e => { insFilter.cls = e.target.value; paint(); };
  document.getElementById('insExport').onclick = () => {
    const rows = [['Admission','Name','Class','Section','Roll','Guardian','Phone','Attendance %','Risk','Band','Patterns','Forecast']];
    all.forEach(r => rows.push([r.student.adm, r.student.name, r.student.cls, r.student.sec, r.student.roll,
      r.student.father, r.student.phone, pct(r.student.attPresent, r.student.attTotal), r.risk, r.band,
      r.flags.map(f => f.title).join('; '), r.forecast.verdict]));
    downloadCSV(rows, `attendance-alerts-${todayISO()}.csv`);
    toast(`Exported ${all.length} flagged students.`, 'ok');
  };
  paint();
};

/* ═══════════════════════════ 2 · DATA QUALITY ═══════════════════════════ */
ROUTES.dataquality = view => {
  setHead('Data Quality', 'EMIS / UDISE+ pre-upload check');
  const q = AI.quality.run();

  view.innerHTML = `
    <div class="ai-hero"><div class="ai-hero-inner">
      <div class="row" style="gap:.6rem">${AI_CHIP}<span class="badge badge-voice">On-device</span></div>
      <h1>Data Quality</h1>
      <p>Government returns are rejected wholesale for defects that are trivial to find beforehand.
      This runs the checks the UDISE+ upload will run — but now, against all ${q.total} records — and
      points at the exact student to fix.</p>
    </div></div>

    <div class="grid" style="grid-template-columns:300px 1fr;gap:1.2rem;margin-bottom:1.2rem">
      <div class="card card-pad" style="text-align:center">
        ${gauge(q.score)}
        <div style="margin-top:1rem">
          ${q.uploadReady
            ? `<span class="badge badge-ok"><span class="beacon beacon-ok"></span> Ready to upload</span>`
            : `<span class="badge badge-danger"><span class="beacon"></span> Upload would be rejected</span>`}
        </div>
        <p class="tiny muted" style="margin-top:.7rem">${q.clean} of ${q.total} records are completely clean.</p>
      </div>
      <div class="grid g2" style="gap:.9rem;align-content:start">
        ${kpi('Blocking Defects', q.blockers, 'must be fixed before upload', '🛑', 'k4')}
        ${kpi('Warnings', q.warnings, 'should be reviewed', '⚠️', 'k3')}
        ${kpi('Advisory', q.infos, 'good practice, not required', 'ℹ️')}
        ${kpi('Records Affected', q.affected, `${pct(q.affected, q.total)}% of the master`, '📋', 'k5')}
      </div>
    </div>

    <div class="row-between" style="margin-bottom:.8rem">
      <h3>${q.findings.length} issue types found</h3>
      <button class="btn btn-ghost btn-sm" id="dqExport">⬇ Export correction worklist</button>
    </div>

    <div class="grid" style="gap:.75rem">
      ${q.findings.map((f, i) => `<div class="card">
        <button class="card-head" style="width:100%;text-align:left;cursor:pointer" data-t="${i}">
          <div class="row" style="gap:.6rem;align-items:flex-start">
            ${f.severity === 'blocker' ? '<span class="beacon" style="margin-top:6px"></span>' : ''}
            <div>
              <h4 style="margin:0">${esc(f.title)}</h4>
              <span class="tiny muted">${esc(f.field)} · ${esc(f.why)}</span>
            </div>
          </div>
          <div class="row" style="gap:.5rem;flex:none">
            <span class="sev sev-${f.severity}">${f.severity}</span>
            <span class="badge badge-brand">${f.count}</span>
            <span class="muted">▾</span>
          </div>
        </button>
        <div class="card-body hidden" id="dqBody${i}">
          <div class="table-scroll" style="max-height:320px"><table class="table">
            <thead><tr><th>Admission</th><th>Student</th><th>Class</th><th>Detail</th><th class="c">Fix</th></tr></thead>
            <tbody>${f.hits.slice(0, 100).map(s => `<tr>
              <td class="mono tiny">${s.adm}</td>
              <td>${esc(s.name)}</td>
              <td>${s.cls}-${s.sec}</td>
              <td class="small muted">${esc(f.detail ? f.detail(s) : (s[fieldKey(f.field)] || '— empty —'))}</td>
              <td class="c"><a class="btn btn-ghost btn-sm" href="#student?id=${s.id}">Open</a></td>
            </tr>`).join('')}</tbody></table></div>
          ${f.count > 100 ? `<p class="tiny muted" style="margin-top:.6rem">Showing the first 100 of ${f.count}.</p>` : ''}
        </div>
      </div>`).join('')}
    </div>
    ${AI_DISCLOSURE}`;

  view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    const body = document.getElementById('dqBody' + b.dataset.t);
    body.classList.toggle('hidden');
    b.querySelector('.muted:last-child').textContent = body.classList.contains('hidden') ? '▾' : '▴';
  });
  document.getElementById('dqExport').onclick = () => {
    const rows = [['Severity','Issue','Field','Admission','Student','Class','Section','Why it matters']];
    q.findings.forEach(f => f.hits.forEach(s =>
      rows.push([f.severity, f.title, f.field, s.adm, s.name, s.cls, s.sec, f.why])));
    downloadCSV(rows, `data-quality-worklist-${todayISO()}.csv`);
    toast(`Exported ${rows.length - 1} corrections to make.`, 'ok');
  };
};
const fieldKey = f => ({ 'Aadhaar':'aadhaar','Contact':'phone','Date of Birth':'dob','Community':'community',
  'Group':'group','Address':'address','Blood Group':'blood','Income':'income','EMIS ID':'emis','Roll No.':'roll' }[f] || 'name');

/* ═══════════════════════════ 3 · SCHOLARSHIP MATCH ═══════════════════════════ */
ROUTES.scholarships = view => {
  setHead('Scholarship Match', 'Entitlement matching across TN & GoI schemes');
  const m = AI.scholarships.all();

  view.innerHTML = `
    <div class="ai-hero"><div class="ai-hero-inner">
      <div class="row" style="gap:.6rem">${AI_CHIP}<span class="badge badge-voice">On-device</span></div>
      <h1>Scholarship Match</h1>
      <p>Money these families are entitled to and routinely never claim, because nobody in the office has
      time to cross-check ${DB.students.length} records against ${AI.scholarships.SCHEMES.length} schemes with different income
      ceilings, class ranges and attendance conditions. Every match below shows exactly which criteria
      were met.</p>
    </div></div>

    <div class="grid g4 stagger" style="margin-bottom:1.2rem">
      ${kpi('Annual Entitlement Found', INRs(m.value), 'across all matched students', '🎁', 'k2')}
      ${kpi('Students Matched', m.matched, `${pct(m.matched, DB.students.length)}% of the school`, '✅', 'k5')}
      ${kpi('Recoverable', INRs(m.recoverable), '<span class="beacon beacon-warn"></span> unlocks if attendance reaches 75%', '📈', 'k3')}
      ${kpi('No Scheme Matched', m.unmatched, 'may still qualify on other grounds', '—')}
    </div>

    <div class="toolbar">
      <label class="lbl">Check one student</label>
      <select class="select grow" id="schStudent">
        <option value="">— select a student to see their full entitlement —</option>
        ${DB.students.slice(0, 400).map(s => `<option value="${s.id}">${esc(s.name)} · ${s.cls}-${s.sec} · Roll ${s.roll}</option>`).join('')}
      </select>
      <button class="btn btn-ghost btn-sm" id="schExport">⬇ Export claim list</button>
    </div>

    <div id="schOne"></div>

    <h3 style="margin:.4rem 0 .8rem">Scheme by scheme</h3>
    <div class="grid g2" style="gap:.9rem">
      ${m.schemes.map((row, i) => {
        const sc = row.scheme;
        return `<div class="scheme">
          <div class="scheme-head">
            <div>
              <h4>${esc(sc.name)}</h4>
              ${sc.tamil ? `<div class="ta tiny" style="color:var(--teal-600)">${sc.tamil}</div>` : ''}
              <div class="auth">${esc(sc.authority)}</div>
            </div>
            <div class="scheme-amt"><b>${INR(sc.amount)}</b><span>per year</span></div>
          </div>
          <div class="scheme-body">
            <div class="row" style="gap:.5rem;flex-wrap:wrap;margin-bottom:.7rem">
              <span class="badge badge-ok">${row.eligible.length} eligible</span>
              ${row.nearMiss.length ? `<span class="badge badge-warn"><span class="beacon beacon-warn"></span>${row.nearMiss.length} blocked only by attendance</span>` : ''}
              <span class="badge">${INRs(row.eligible.length * sc.amount)} total</span>
            </div>
            ${sc.note ? `<p class="tiny muted" style="margin-bottom:.6rem">${esc(sc.note)}</p>` : ''}
            <div class="crit-list">
              ${sc.criteria.map(c => `<div class="crit ok"><span class="mk">·</span><span>${esc(c.label)}</span></div>`).join('')}
            </div>
            ${row.eligible.length ? `<button class="btn btn-ghost btn-sm" style="margin-top:.8rem" data-sch="${i}">
              View ${row.eligible.length} eligible students →</button>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
    ${AI_DISCLOSURE}
    <p class="tiny muted" style="margin-top:.7rem">Amounts shown are indicative annual values. Confirm the
    current year's figures and conditions against the department circular before filing any claim.</p>`;

  view.querySelectorAll('[data-sch]').forEach(b => b.onclick = () => {
    const row = m.schemes[+b.dataset.sch];
    openModal({
      title: esc(row.scheme.name),
      wide: true,
      body: `<p class="small muted" style="margin-bottom:.8rem">${row.eligible.length} students meet every criterion ·
        ${INR(row.eligible.length * row.scheme.amount)} total annual value</p>
        <div class="table-scroll" style="max-height:52vh"><table class="table">
        <thead><tr><th>Admission</th><th>Student</th><th>Class</th><th>Community</th><th class="r">Income</th><th class="c">Attendance</th></tr></thead>
        <tbody>${row.eligible.map(s => `<tr>
          <td class="mono tiny">${s.adm}</td><td>${esc(s.name)}</td><td>${s.cls}-${s.sec}</td>
          <td>${s.community}</td><td class="r">${INR(s.income)}</td>
          <td class="c">${pct(s.attPresent, s.attTotal)}%</td></tr>`).join('')}
        </tbody></table></div>`,
      actions: [{ label: 'Close', cls: 'btn-ghost', fn: closeModal }]
    });
  });

  document.getElementById('schStudent').onchange = e => {
    const host = document.getElementById('schOne');
    if (!e.target.value) { host.innerHTML = ''; return; }
    const s = DB.student(e.target.value);
    const r = AI.scholarships.forStudent(s);
    const all = AI.scholarships.SCHEMES.map(sc => AI.scholarships.check(s, sc));

    host.innerHTML = `<div class="card" style="margin-bottom:1.2rem">
      <div class="card-head">
        <div class="row" style="gap:.7rem">
          <span class="avatar">${initials(s.name)}</span>
          <div><h4 style="margin:0">${esc(s.name)}</h4>
            <span class="tiny muted">Std ${s.cls}-${s.sec} · ${s.community} · ${s.religion} · income ${INR(s.income)} ·
            attendance ${pct(s.attPresent, s.attTotal)}%${s.firstGraduate ? ' · first graduate' : ''}${s.cwsn ? ' · CWSN' : ''}</span></div>
        </div>
        <div style="text-align:right">
          <div style="font-family:var(--font-display);font-size:1.5rem;font-weight:740;color:var(--teal-600)">${INR(r.value)}</div>
          <span class="tiny muted">per year, ${r.eligible.length} scheme${r.eligible.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div class="card-body grid g2" style="gap:.9rem">
        ${all.map(x => `<div class="scheme" style="${x.eligible ? 'border-color:var(--teal-500)' : ''}">
          <div class="scheme-head" style="padding:.7rem .9rem">
            <div><h4 style="font-size:.88rem">${esc(x.scheme.name)}</h4></div>
            <div class="scheme-amt">
              ${x.eligible ? `<b>${INR(x.scheme.amount)}</b><span>eligible</span>`
                : x.nearMiss ? `<span class="sev sev-medium">attendance only</span>`
                : `<span class="tiny muted">not eligible</span>`}
            </div>
          </div>
          <div class="scheme-body" style="padding:.7rem .9rem">
            <div class="crit-list">
              ${x.met.map(c => `<div class="crit ok"><span class="mk">✓</span><span>${esc(c.label)}</span></div>`).join('')}
              ${x.failed.map(c => `<div class="crit no"><span class="mk">✕</span><span>${esc(c.label)}</span></div>`).join('')}
            </div>
          </div>
        </div>`).join('')}
      </div>
      ${r.recoverable ? `<div class="card-foot"><div class="why" style="border-left-color:var(--warn)">
        <b>${INR(r.recoverable)} is within reach.</b> This student fails only the 75% attendance condition
        on ${r.nearMiss.length} scheme${r.nearMiss.length === 1 ? '' : 's'}.
        <a href="#insights">See the attendance forecast →</a></div></div>` : ''}
    </div>`;
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  document.getElementById('schExport').onclick = () => {
    const rows = [['Scheme','Authority','Annual Value','Admission','Student','Class','Section','Community','Religion','Income','Attendance %']];
    m.schemes.forEach(row => row.eligible.forEach(s =>
      rows.push([row.scheme.name, row.scheme.authority, row.scheme.amount, s.adm, s.name, s.cls, s.sec,
        s.community, s.religion, s.income, pct(s.attPresent, s.attTotal)])));
    downloadCSV(rows, `scholarship-claims-${todayISO()}.csv`);
    toast(`Exported ${rows.length - 1} claim lines.`, 'ok');
  };
};

/** Shared CSV writer. */
function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════ boot ═══════════════════════════ */
paintNav();
Voice.init();
addEventListener('hashchange', route);

document.getElementById('logoutBtn').onclick = () => { Store.del('session'); location.href = 'index.html'; };
document.getElementById('voiceHelpTop').onclick = () => Voice.showHelp();
document.getElementById('sideToggle').onclick = () => {
  const side = document.getElementById('appSide');
  side.classList.add('open');
  const scrim = document.createElement('div');
  scrim.className = 'side-scrim';
  scrim.onclick = () => { side.classList.remove('open'); scrim.remove(); };
  document.body.appendChild(scrim);
};
document.getElementById('globalSearch').oninput = e => {
  const q = e.target.value.trim();
  if (q.length < 2) return;
  stuFilter = { cls: '', sec: '', q, medium: '', community: '' };
  if (!location.hash.startsWith('#students')) location.hash = '#students';
  else route();
};

route();
setTimeout(() => {
  if (!Store.get('seenVoiceTip')) {
    Store.set('seenVoiceTip', true);
    toast('🎙 Voice entry is ready — press Ctrl+Shift+M any time.', 'voice', 6000);
    document.getElementById('voiceDock')?.classList.add('open');
  }
}, 900);
