/* ============================================================
   app.js — portal shell, router and all module views
   ============================================================ */

/* ───────────────────────── session ─────────────────────────
   USER and ROLE are filled from /api/bootstrap during boot, below.
   There is no client-side session to forge: the cookie is HttpOnly and
   every API call is authorised on the server against it. */
let ROLE = 'admin';

/* ───────────────────────── modal ─────────────────────────── */
function openModal({ title, body, actions = [], wide = false }) {
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
}
function closeModal() {
  document.getElementById('modalHost').innerHTML = '';
  route();   // repaint the screen underneath
}
addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ───────────────────────── navigation ────────────────────── */
const NAV = [
  { group: 'Overview', items: [
    { id: 'dashboard', label: 'Dashboard', ico: '📊', roles: '*' },
  ]},
  { group: 'Students', items: [
    { id: 'students',  label: 'Student Master', ico: '👨‍🎓', roles: 'admin,principal,teacher,accountant' },
    { id: 'admission', label: 'New Admission',  ico: '➕', roles: 'admin,principal' },
    { id: 'mychild',   label: 'My Record',      ico: '🎒', roles: 'parent,student' },
  ]},
  { group: 'Intelligence', items: [
    { id: 'insights',     label: 'Attendance Alerts', ico: '🧠', roles: 'admin,principal,teacher', tag: 'AI', ai: true },
    { id: 'dataquality',  label: 'Data Quality',      ico: '🩺', roles: 'admin,principal', tag: 'AI', ai: true },
    { id: 'scholarships', label: 'Scholarship Match', ico: '🎁', roles: 'admin,principal,accountant', tag: 'AI', ai: true },
  ]},
  { group: 'Daily Work', items: [
    { id: 'attendance', label: 'Attendance', ico: '📋', roles: 'admin,principal,teacher' },
    { id: 'marks',      label: 'Mark Entry', ico: '✍️', roles: 'admin,principal,teacher' },
    { id: 'exams',      label: 'Report Cards', ico: '📝', roles: 'admin,principal,teacher' },
  ]},
  { group: 'Finance', items: [
    { id: 'fees',      label: 'Fee Collection', ico: '💰', roles: 'admin,principal,accountant' },
    { id: 'defaulters',label: 'Fee Dues',       ico: '⚠️', roles: 'admin,principal,accountant' },
  ]},
  { group: 'School', items: [
    { id: 'staff',   label: 'Staff',    ico: '👩‍🏫', roles: 'admin,principal' },
    { id: 'notices', label: 'Circulars', ico: '📢', roles: '*' },
    { id: 'reports', label: 'Reports & Govt.', ico: '🏛', roles: 'admin,principal' },
  ]},
  { group: 'System', items: [
    { id: 'provision', label: 'School Data', ico: '🏫', roles: 'admin' },
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

  /* Branding comes from the school profile, not the markup — this is the
     same build serving whichever school the database holds. */
  document.title = SCHOOL.short || SCHOOL.name || 'School Portal';
  document.getElementById('crest').textContent = initials(SCHOOL.short || SCHOOL.name);
  document.getElementById('brandName').textContent = SCHOOL.short || SCHOOL.name || '—';
  document.getElementById('sideYear').textContent = SCHOOL.year ? 'Academic Year ' + SCHOOL.year : 'No academic year set';

  const u = USER || { name: '—', title: '—' };
  document.getElementById('userAvatar').textContent = initials(u.name);
  document.getElementById('userName').textContent = u.name;
  document.getElementById('userRole').textContent = u.title;

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
        <h1>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${esc((USER?.name || "").split(' ').slice(-1)[0])}</h1>
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
      <a class="quick-tile" href="#admission"><span class="ico">➕</span><span><b>Admit a Student</b><small>Add a new student record</small></span></a>
      <a class="quick-tile" href="#attendance"><span class="ico">📋</span><span><b>Roll Call</b><small>Say present or absent</small></span></a>
      <a class="quick-tile" href="#marks"><span class="ico">✍️</span><span><b>Enter Marks</b><small>Speak the score</small></span></a>
      <a class="quick-tile" href="#reports"><span class="ico">🏛</span><span><b>EMIS / UDISE</b><small>Government returns</small></span></a>
    </div>`;
};

/* ═══════════════════════════ MY CHILD (parent / student) ═══════════════════════════ */
ROUTES.mychild = view => {
  setHead(ROLE === 'parent' ? 'My Child' : 'My Record', SCHOOL.name);
  /* The account's own child. USER.sid is the link between a sign-in and a
     record; the fallback is only for a malformed account with no sid, and
     is safe because the server sends a parent or student exactly one
     student. This used to name a student id from the sample school, which
     showed the wrong child to every family on any other school's roll. */
  const s = DB.student(USER && USER.sid) || DB.students[0];
  if (!s) {
    view.innerHTML = `<div class="empty"><h3>No record linked to this account</h3>
      <p>This sign-in is not attached to a student. Ask the school office to link it.</p></div>`;
    return;
  }
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

};

function exportCSV() {
  const cols = ['adm','emis','name','gender','cls','sec','roll','medium','group','dob','community','religion','father','mother','phone','address','rte','feeTotal','feePaid'];
  const csv = [cols.join(','), ...DB.students.map(s =>
    cols.map(c => `"${String(s[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = `students-${todayISO()}.csv`; a.click();
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
        ${ROLE === 'admin' ? `<button class="btn btn-ghost" style="border-color:rgba(255,255,255,.4);color:#fff"
          onclick="removeStudentModal('${s.id}')">🗑 Remove</button>` : ''}
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

/* ---------- removing a student ----------
   A mistyped admission has to be undoable, and until now nothing in the
   portal could take a record off the roll — the only removal was Clear
   School Data, which takes the whole school with it.

   This is a real delete, not a status change, because it exists for the
   entry that should never have been made. A child who genuinely leaves
   gets a Transfer Certificate and stays in the register; that is a
   different act and the TC screen is where it belongs.

   Everything keyed to the student goes with them — their attendance
   series, their marks, their receipts and their name in any saved day
   register — because a receipt pointing at a student id that no longer
   exists is exactly the kind of orphan the data-quality engine would
   later have to report. */
function removeStudentModal(id) {
  const s = DB.student(id);
  if (!s) return;
  const receipts = DB.receipts.filter(r => r.sid === id);
  const marks = Object.keys(DB.marks).filter(k => k.startsWith(id + '|'));
  const paid = receipts.reduce((a, r) => a + r.amount, 0);

  openModal({
    title: 'Remove this student from the roll?',
    body: `<p><strong>${esc(s.name)}</strong> · ${esc(s.adm)} · Std ${s.cls}-${s.sec}</p>
      <p class="small muted">Admitted ${fmtDate(s.admitted)}.</p>
      <p>This deletes the record and everything attached to it:</p>
      <div class="grid g2" style="margin:.8rem 0;text-align:left">
        <div class="info-item"><span>Attendance history</span><b>${(DB.attHistory[id] || '').length} days</b></div>
        <div class="info-item"><span>Marks</span><b>${marks.length}</b></div>
        <div class="info-item"><span>Receipts</span><b>${receipts.length}${paid ? ' · ' + INR(paid) : ''}</b></div>
        <div class="info-item"><span>Roll number</span><b>${s.roll}</b></div>
      </div>
      ${paid ? `<p class="small"><strong>${INR(paid)} of receipted fees will be removed from the collection
        register.</strong> If this child really did pay, cancel and issue a refund entry instead.</p>` : ''}
      <p class="small muted">This cannot be undone. Use it for an admission entered by mistake — a child who is
      leaving should be given a Transfer Certificate instead, which keeps the record.</p>`,
    actions: [
      { label: 'Keep the record', cls: 'btn-ghost', fn: closeModal },
      { label: 'Remove ' + esc(s.name.split(' ')[0]), cls: 'btn-danger', fn: async () => {
          try {
            DB.students = DB.students.filter(x => x.id !== id);
            delete DB.attHistory[id];
            DB.receipts = DB.receipts.filter(r => r.sid !== id);
            marks.forEach(k => delete DB.marks[k]);

            /* Saved day registers are keyed date|class|section and hold a
               mark per student id, so the child has to come out of each. */
            let registers = false;
            for (const key of Object.keys(DB.attendance || {})) {
              if (DB.attendance[key] && id in DB.attendance[key]) {
                delete DB.attendance[key][id];
                registers = true;
              }
            }

            await DB.save('students');
            await DB.save('attHistory');
            if (receipts.length) await DB.save('receipts');
            if (marks.length) await DB.save('marks');
            if (registers) await DB.save('attendance');

            AI.bust();
            document.getElementById('modalHost').innerHTML = '';
            toast(`${s.name} removed from the roll.`, 'ok', 4500);
            location.hash = '#students';
          } catch (e) { toast(e.message, 'err'); }
        } }
    ]
  });
}

/* ═══════════════════════════ NEW ADMISSION ═══════════════════════════ */
ROUTES.admission = view => {
  setHead('New Admission', 'Dictate it or type it');
  view.innerHTML = `
    <div class="page-head">
      <div><h1>New Admission</h1><p>Academic year ${SCHOOL.year} · dictate the record or fill it in by hand.</p></div>
      <div class="row">
        <button class="btn btn-ghost" id="demoFill">⚡ Fill sample</button>
      </div>
    </div>

    <form id="admForm" class="grid" style="gap:1.15rem" onsubmit="return false">
      <div class="card">
        <div class="card-head"><h3>1 · Student Details</h3></div>
        <div class="card-body grid g3">
          <div class="field"><label class="req" for="a_name">Student Name</label>
            <input class="input" id="a_name" required></div>
          <div class="field"><label class="req" for="a_gender">Gender</label>
            <select class="select" id="a_gender"><option value="">—</option><option>Male</option><option>Female</option><option>Transgender</option></select></div>
          <div class="field"><label class="req" for="a_dob">Date of Birth</label>
            <input class="input" type="date" id="a_dob"></div>
          <div class="field"><label for="a_blood">Blood Group</label>
            <select class="select" id="a_blood"><option value="">—</option>${optList(BLOOD)}</select></div>
          <div class="field"><label class="req" for="a_comm">Community</label>
            <select class="select" id="a_comm"><option value="">—</option>${optList(COMMUNITIES)}</select></div>
          <div class="field"><label for="a_rel">Religion</label>
            <select class="select" id="a_rel"><option value="">—</option>${optList(RELIGIONS)}</select></div>
          <div class="field"><label for="a_aadhaar">Aadhaar Number</label>
            <input class="input" id="a_aadhaar" maxlength="12" inputmode="numeric" placeholder="12 digits"></div>
          <div class="field"><label for="a_emis">EMIS ID</label>
            <input class="input" id="a_emis" placeholder="auto if left blank"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>2 · Parent / Guardian</h3></div>
        <div class="card-body grid g3">
          <div class="field"><label class="req" for="a_father">Father Name</label>
            <input class="input" id="a_father"></div>
          <div class="field"><label for="a_focc">Father Occupation</label>
            <select class="select" id="a_focc"><option value="">—</option>${optList(OCCUPATIONS)}</select></div>
          <div class="field"><label class="req" for="a_mother">Mother Name</label>
            <input class="input" id="a_mother"></div>
          <div class="field"><label class="req" for="a_phone">Contact Number</label>
            <input class="input" type="tel" id="a_phone" maxlength="10" inputmode="numeric"></div>
          <div class="field" style="grid-column:span 2"><label class="req" for="a_addr">Address</label>
            <input class="input" id="a_addr"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>3 · Academic Placement</h3></div>
        <div class="card-body grid g3">
          <div class="field"><label class="req" for="a_cls">Standard</label>
            <select class="select" id="a_cls"><option value="">—</option>${optList(CLASSES)}</select></div>
          <div class="field"><label class="req" for="a_sec">Section</label>
            <select class="select" id="a_sec"><option value="">—</option>${optList(SECTIONS)}</select></div>
          <div class="field"><label class="req" for="a_med">Medium</label>
            <select class="select" id="a_med"><option value="">—</option>${optList(MEDIUMS)}</select></div>
          <div class="field"><label for="a_group">Group (Std XI–XII)</label>
            <select class="select" id="a_group"><option value="">—</option>${optList(GROUPS)}</select></div>
          <div class="field"><label for="a_prev">Previous School</label>
            <input class="input" id="a_prev"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>4 · Concessions & Facilities</h3></div>
        <div class="card-body grid g3">
          <div class="field"><label for="a_transport">Transport Route</label>
            <select class="select" id="a_transport"><option value="">Own arrangement</option>
              ${optList(['Route 1 · Chithode','Route 2 · Thindal','Route 3 · Nasiyanur','Route 4 · Perundurai'])}</select></div>
          <div class="field"><label for="a_rte">RTE 25% Seat</label>
            <select class="select" id="a_rte"><option value="No">No</option><option value="Yes">Yes</option></select></div>
          <div class="field"><label for="a_sibling">Sibling in this school</label>
            <select class="select" id="a_sibling"><option value="No">No</option><option value="Yes">Yes</option></select></div>
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
    /* One character per working day, or this record does not line up with
       attDays and the importer refuses the WHOLE school on restore — which
       made "Full backup" produce a file that could not be loaded back the
       moment anybody was admitted. 'P' is the fill the roll-call screen
       already uses when it pads a short series (see padEnd in
       ROUTES.attendance): a child cannot be marked absent for days before
       they were on the roll. attPresent/attTotal stay at 0, because
       nothing has actually been registered for them yet. */
    DB.attHistory[s.id] = 'P'.repeat(DB.attDays.length); DB.save('attHistory');
    AI.bust();
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

  const fields = () => [...form.querySelectorAll('input[id], select[id]')];
  const progress = () => {
    const fs = fields();
    const done = fs.filter(f => f.value.trim()).length;
    document.getElementById('admProgress').textContent = `${done} of ${fs.length} fields completed`;
  };
  form.addEventListener('input', e => {
    e.target.closest('.field')?.classList.remove('invalid');
    progress();
  });
  document.getElementById('admSave').onclick = save;
  document.getElementById('admCancel').onclick = () => location.hash = '#students';
  document.getElementById('demoFill').onclick = () => {
    const d = { a_name:'Karthik Raja', a_gender:'Male', a_dob:'2010-03-12', a_blood:'O+',
      a_comm:'MBC', a_rel:'Hindu', a_aadhaar:'482913756240', a_father:'Murugesan',
      a_focc:'Weaver', a_mother:'Amutha', a_phone:'9843045678',
      a_addr:'42, Perundurai Road, Erode', a_cls:'X', a_sec:'A', a_med:'Tamil',
      a_prev:'Govt. Middle School, Thindal', a_transport:'Route 2 · Thindal', a_rte:'No', a_sibling:'Yes' };
    Object.entries(d).forEach(([k, v]) => { const el = document.getElementById(k); if (el) el.value = v; });
    progress();
    toast('Sample data filled.', 'ok');
  };

  progress();
};

/* ═══════════════════════════ ATTENDANCE ═══════════════════════════ */
let attState = { cls: 'X', sec: 'A', date: todayISO(), marks: {}, cursor: 0, show: '' };
ROUTES.attendance = view => {
  setHead('Attendance', 'Daily roll call');
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Attendance</h1><p>Tap to mark, or just say it — the assistant works the register with you.</p></div>
    </div>
    <div class="toolbar">
      <label class="lbl">Standard</label>${classSelect('ac', attState.cls, 'Select')}
      <label class="lbl">Section</label>${secSelect('as', attState.sec)}
      <label class="lbl">Date</label><input class="input" type="date" id="ad" value="${attState.date}">
      <label class="lbl">Showing</label>
      <select class="select" id="ashow">
        <option value="">Everyone</option>
        <option value="A">Absent only</option>
        <option value="P">Present only</option>
        <option value="L">Late only</option>
        <option value="U">Not yet marked</option>
      </select>
      <button class="btn btn-ghost btn-sm" id="allP">✓ All Present</button>
      <div class="spacer"></div>
      <span id="attSummary" class="small muted"></span>
      <button class="btn btn-primary btn-sm" id="attSave">💾 Save Register</button>
    </div>
    <div class="card"><div id="rollList" style="max-height:62vh;overflow-y:auto"></div></div>`;

  const key = () => `${attState.date}|${attState.cls}|${attState.sec}`;
  const list = () => DB.byClass(attState.cls, attState.sec);
  /* What the register currently shows, after the status filter. */
  const shown = () => list().filter(s => {
    if (!attState.show) return true;
    const v = attState.marks[s.id];
    return attState.show === 'U' ? !v : v === attState.show;
  });

  function paint() {
    const all = list();
    const students = shown();
    const host = document.getElementById('rollList');
    if (!all.length) {
      host.innerHTML = `<div class="empty"><div class="ico">📋</div>Choose a standard and section.</div>`;
      document.getElementById('attSummary').textContent = ''; return;
    }
    if (!students.length) {
      const label = { A: 'absent', P: 'present', L: 'late', U: 'unmarked' }[attState.show];
      host.innerHTML = `<div class="empty"><div class="ico">✅</div>
        No student in ${attState.cls}-${attState.sec} is ${label} on ${fmtDate(attState.date)}.</div>`;
    } else
    host.innerHTML = students.map(s => {
      const v = attState.marks[s.id];
      return `<div class="roll-row">
        <div class="roll-no">${s.roll}</div>
        <div class="roll-name">${esc(s.name)}<small>${s.adm} · ${s.gender} · overall ${pct(s.attPresent, s.attTotal)}%</small></div>
        <div class="pab" data-sid="${s.id}">
          ${['P','A','L'].map(x => `<button data-s="${x}" class="${v === x ? 'on' : ''}">${x}</button>`).join('')}
        </div></div>`;
    }).join('');
    host.querySelectorAll('.pab button').forEach(b => b.onclick = () => {
      mark(b.parentElement.dataset.sid, b.dataset.s);
    });

    const vals = all.map(s => attState.marks[s.id]).filter(Boolean);
    const p = vals.filter(v => v === 'P').length, a = vals.filter(v => v === 'A').length, l = vals.filter(v => v === 'L').length;
    document.getElementById('attSummary').innerHTML =
      `<span class="badge badge-ok">${p} present</span> <span class="badge badge-danger">${a} absent</span>
       <span class="badge badge-warn">${l} late</span> <span class="badge">${all.length - vals.length} unmarked</span>` +
      (attState.show ? ` <span class="badge badge-brand">showing ${students.length} of ${all.length}</span>` : '');
  }

  function mark(sid, v) {
    attState.marks[sid] = v;
    paint();
  }


  const reload = () => {
    attState.marks = (DB.attendance || {})[key()] || {};
    paint();
  };
  ['ac','as','ad','ashow'].forEach((id, i) => {
    document.getElementById(id).onchange = e => {
      attState[['cls','sec','date','show'][i]] = e.target.value;
      i === 3 ? paint() : reload();
    };
  });
  document.getElementById('allP').onclick = () => {
    list().forEach(s => attState.marks[s.id] = 'P'); paint();
    toast('All marked present — now correct the exceptions.', 'ok');
  };
  document.getElementById('attSave').onclick = () => {
    const students = list();
    if (!students.length) return;
    const store = DB.attendance || {};
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
    DB.attendance = store;
    DB.save('attendance');
    DB.save('students');
    AI.bust();

    const absent = students.filter(s => attState.marks[s.id] === 'A');
    toast(`Register saved for ${attState.cls}-${attState.sec} · ${absent.length} absentee SMS queued.`, 'ok', 4500);
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
      <div><h1>Mark Entry</h1><p>Type the scores, or read them out.</p></div>
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

  document.getElementById('mc').onchange = e => { mkState.cls = e.target.value; subjOptions(); paint(); };
  document.getElementById('ms').onchange = e => { mkState.sec = e.target.value; paint(); };
  document.getElementById('mt').onchange = e => { mkState.term = e.target.value; paint(); };
  document.getElementById('msub').onchange = e => { mkState.subject = e.target.value; paint(); };
  document.getElementById('mkSave').onclick = () => {
    DB.save('marks');
    toast(`Marks saved — ${mkState.cls}-${mkState.sec} · ${mkState.subject} · ${mkState.term}.`, 'ok');
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

};

function collectModal(sid) {
  const students = DB.students.filter(s => s.feeTotal - s.feePaid > 0 || s.id === sid);
  openModal({
    title: '💰 Collect Fee',
    wide: true,
    body: `
      <form id="feeForm" class="grid g2" style="gap:1rem" onsubmit="return false">
        <div class="field" style="grid-column:span 2"><label class="req" for="f_stu">Student</label>
          <select class="select" id="f_stu">
            <option value="">—</option>
            ${students.slice(0, 400).map(s => `<option value="${s.id}" ${s.id === sid ? 'selected' : ''}>${esc(s.name)} · ${s.cls}-${s.sec} · due ${INR(s.feeTotal - s.feePaid)}</option>`).join('')}
          </select></div>
        <div class="field"><label class="req" for="f_head">Fee Head</label>
          <select class="select" id="f_head"><option value="">—</option>${optList(FEE_HEADS)}</select></div>
        <div class="field"><label class="req" for="f_amt">Amount (₹)</label>
          <input class="input" type="number" id="f_amt" min="1"></div>
        <div class="field"><label class="req" for="f_mode">Payment Mode</label>
          <select class="select" id="f_mode"><option value="">—</option>${optList(['Cash','UPI','Net Banking','Cheque','DD'])}</select></div>
        <div class="field"><label for="f_date">Date</label>
          <input class="input" type="date" id="f_date" value="${todayISO()}"></div>
        <div class="field" style="grid-column:span 2"><label for="f_note">Remarks</label>
          <input class="input" id="f_note" placeholder="optional"></div>
      </form>`,
    actions: [
      { label: 'Cancel', cls: 'btn-ghost', fn: closeModal },
      { label: '💾 Save Receipt', cls: 'btn-primary', fn: saveFee }
    ],
  });

  function saveFee() {
    const g = id => document.getElementById(id).value;
    const s = DB.student(g('f_stu'));
    const amt = +g('f_amt');
    if (!s || !amt || !g('f_head') || !g('f_mode')) {
      toast('Student, head, amount and mode are all required.', 'err');
      return;
    }
    const no = 'RC' + (2000 + DB.receipts.length);
    DB.receipts.unshift({ id: uid('r'), no, sid: s.id, name: s.name, cls: s.cls, sec: s.sec,
      date: g('f_date') || todayISO(), head: g('f_head'), mode: g('f_mode'), amount: amt });
    s.feePaid += amt;
    DB.save('receipts'); DB.save('students');
    closeModal();
    toast(`Receipt ${no} — ${INR(amt)} from ${s.name}.`, 'ok', 4500);
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
    body: `
      <form id="ntForm" class="grid" style="gap:1rem" onsubmit="return false">
        <div class="field"><label class="req" for="n_title">Title</label>
          <input class="input" id="n_title"></div>
        <div class="field"><label class="req" for="n_body">Message</label>
          <textarea class="textarea" id="n_body"></textarea></div>
        <div class="grid g2">
          <div class="field"><label for="n_to">Audience</label>
            <select class="select" id="n_to">
              ${optList(['All','Parents','Staff','Std X, XII','Std XI, XII','Primary Section'])}</select></div>
          <div class="field"><label for="n_date">Date</label>
            <input class="input" type="date" id="n_date" value="${todayISO()}"></div>
        </div>
      </form>`,
    actions: [
      { label: 'Cancel', cls: 'btn-ghost', fn: closeModal },
      { label: '📢 Publish', cls: 'btn-primary', fn: publish }
    ],
  });

  function publish() {
    const t = document.getElementById('n_title').value.trim();
    const bd = document.getElementById('n_body').value.trim();
    if (!t || !bd) { toast('Title and message are required.', 'err'); return; }
    DB.notices.unshift({ id: uid('n'), date: document.getElementById('n_date').value || todayISO(),
      title: t, body: bd, to: document.getElementById('n_to').value, by: USER?.name || 'Office' });
    DB.save('notices');
    closeModal();
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
  setHead('Settings', SCHOOL.name);
  const admin = ROLE === 'admin';

  const profileFields = [
    ['name','School name'],['short','Short name'],['tamil','Name in Tamil'],['addr','Address'],
    ['phone','Phone'],['email','Email'],['code','School code'],['udise','UDISE code'],
    ['year','Academic year'],['est','Established'],['yearStart','Year start (YYYY-MM-DD)'],
    ['yearWorkingDays','Working days in the year'],['minAttendance','Minimum attendance (0–1)']
  ];

  const profileBody = admin
    ? `<div class="grid g2" style="gap:.9rem">
         ${profileFields.map(([k, label]) => `<div class="field"><label for="sp_${k}">${label}</label>
           <input class="input" id="sp_${k}" value="${esc(SCHOOL[k] ?? '')}"></div>`).join('')}
       </div>
       <div class="row" style="margin-top:.9rem"><button class="btn btn-primary btn-sm" id="spSave">Save profile</button></div>`
    : `<div class="info-grid">
         ${[['Name', SCHOOL.name], ['Address', SCHOOL.addr], ['School Code', SCHOOL.code],
            ['UDISE Code', SCHOOL.udise], ['Academic Year', SCHOOL.year], ['Established', SCHOOL.est],
            ['Phone', SCHOOL.phone], ['Email', SCHOOL.email]]
           .map(([k, v]) => `<div class="info-item"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}
       </div>`;

  view.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><p>Appearance, school profile and your account.</p></div></div>
    <div class="grid g2" style="gap:1.15rem">

      <div class="card"><div class="card-head"><h3>Appearance</h3></div><div class="card-body col" style="gap:1rem">
        <div class="row-between"><span>Theme</span>
          <div class="seg" id="themeSeg">
            <button data-t="light" class="${document.documentElement.dataset.theme === 'light' ? 'on' : ''}">Light</button>
            <button data-t="dark" class="${document.documentElement.dataset.theme === 'dark' ? 'on' : ''}">Dark</button>
          </div></div>
        <p class="tiny muted">The theme is the one preference kept in this browser. Every record lives in the school database.</p>
      </div></div>

      <div class="card"><div class="card-head"><h3>Your Account</h3></div><div class="card-body col" style="gap:.8rem">
        <div class="info-grid">
          <div class="info-item"><span>Signed in as</span><b>${esc(USER && USER.username)}</b></div>
          <div class="info-item"><span>Name</span><b>${esc(USER && USER.name)}</b></div>
          <div class="info-item"><span>Role</span><b>${esc(USER && USER.role)}</b></div>
          <div class="info-item"><span>Title</span><b>${esc((USER && USER.title) || '—')}</b></div>
        </div>
        <div class="field"><label for="pw1">New password</label>
          <input class="input" type="password" id="pw1" placeholder="at least 8 characters"></div>
        <div class="field"><label for="pw2">Repeat it</label>
          <input class="input" type="password" id="pw2"></div>
        <button class="btn btn-ghost btn-sm" id="pwSave">Change my password</button>
      </div></div>

      <div class="card" style="grid-column:span 2"><div class="card-head"><h3>School Profile</h3>
        <span class="badge ${admin ? 'badge-accent' : ''}">${admin ? 'Editable' : 'Read only'}</span></div>
        <div class="card-body">${profileBody}</div></div>

      <div class="card"><div class="card-head"><h3>This Deployment</h3></div><div class="card-body col" style="gap:.55rem">
        <div class="stat-line"><span>Students on roll</span><b>${DB.students.length}</b></div>
        <div class="stat-line"><span>Mark entries</span><b>${Object.keys(DB.marks).length}</b></div>
        <div class="stat-line"><span>Receipts</span><b>${DB.receipts.length}</b></div>
        <div class="stat-line"><span>Working days recorded</span><b>${DB.attDays.length}</b></div>
        <div class="stat-line"><span>Database</span><b id="dbAdapter">checking…</b></div>
        <p class="tiny muted">One deployment serves one school.${admin ? ' Use <a href="#provision">School Data</a> to load or replace its records.' : ''}</p>
      </div></div>

      <div class="card"><div class="card-head"><h3>Export</h3></div><div class="card-body col" style="gap:.7rem">
        <p class="small muted">A full JSON backup, in the same shape the importer accepts — this file alone can re-create the deployment.</p>
        <div class="row">
          <button class="btn btn-ghost btn-sm" onclick="exportCSV()">⬇ Students CSV</button>
          <button class="btn btn-ghost btn-sm" id="exportJson">⬇ Full backup (JSON)</button>
        </div>
      </div></div>
    </div>`;

  document.querySelectorAll('#themeSeg button').forEach(b => b.onclick = () => {
    applyTheme(b.dataset.t);
    document.querySelectorAll('#themeSeg button').forEach(x => x.classList.toggle('on', x === b));
  });

  api('/health').then(h => {
    const el = document.getElementById('dbAdapter');
    if (el) el.textContent = h.adapter || 'none';
  }).catch(() => {});

  document.getElementById('pwSave').onclick = async () => {
    const a = document.getElementById('pw1').value, b = document.getElementById('pw2').value;
    if (a !== b) return toast('The two passwords do not match.', 'err');
    if (a.length < 8) return toast('Use at least 8 characters.', 'err');
    try {
      await api('/password', { method: 'POST', body: { password: a } });
      document.getElementById('pw1').value = document.getElementById('pw2').value = '';
      toast('Password changed.', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };

  if (admin) {
    document.getElementById('spSave').onclick = async () => {
      const val = k => document.getElementById('sp_' + k).value.trim();
      const profile = { ...SCHOOL };
      profileFields.forEach(([k]) => profile[k] = val(k));
      if (!profile.name) return toast('The school needs a name.', 'err');
      if (profile.yearWorkingDays) profile.yearWorkingDays = Number(profile.yearWorkingDays);
      if (profile.minAttendance) profile.minAttendance = Number(profile.minAttendance);
      try {
        await api('/school', { method: 'PUT', body: profile });
        SCHOOL = { ...SCHOOL, ...profile };
        toast('School profile saved.', 'ok');
        route();
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  document.getElementById('exportJson').onclick = async () => {
    try {
      const data = await api('/data');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${SCHOOL.code || 'school'}-backup-${todayISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Backup downloaded.', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
};

/* ═══════════════════ SCHOOL DATA (provisioning) ═══════════════════
   The screen an operator uses to stand a school up: load its data file,
   see what that file contains before committing to it, and manage the
   accounts the school signs in with.

   Admin only — and enforced again on the server. A hidden sidebar entry
   is a convenience, never a control. */
ROUTES.provision = view => {
  setHead('School Data', SCHOOL.name);
  if (ROLE !== 'admin') { toast('Only an administrator can open that page.', 'warn'); location.hash = '#dashboard'; return; }

  let staged = null;      // the parsed file, held back until the operator confirms

  view.innerHTML = `
    <div class="page-head"><div><h1>School Data</h1>
      <p>Load this deployment's school from a data file, and manage its sign-ins.</p></div></div>

    <div class="grid g2" style="gap:1.15rem">
      <div class="card" style="grid-column:span 2"><div class="card-head"><h3>Import a school file</h3>
        <span class="badge badge-accent">Replaces everything</span></div>
        <div class="card-body col" style="gap:.9rem">
        <p class="small muted">One JSON file holding the school profile, its roll, staff, marks, receipts and attendance.
        The file is checked before anything is written: errors refuse the import outright, warnings are shown and the
        import continues. Importing replaces every record this deployment currently holds.</p>
        <div class="row">
          <input type="file" id="bundleFile" accept="application/json" style="display:none">
          <button class="btn btn-primary btn-sm" id="pickFile">📂 Choose file…</button>
          <button class="btn btn-ghost btn-sm" id="loadDemo">🧪 Load the sample school</button>
          <span class="tiny muted" id="fileName">no file chosen</span>
        </div>
        <div id="report"></div>
      </div></div>

      <div class="card" style="grid-column:span 2"><div class="card-head"><h3>Accounts</h3></div>
        <div class="card-body col" style="gap:.9rem">
        <div id="userList">loading…</div>
        <div class="grid g2" style="gap:.7rem">
          <div class="field"><label class="req" for="u_user">Username</label><input class="input" id="u_user" placeholder="kavitha"></div>
          <div class="field"><label class="req" for="u_pass">Password</label><input class="input" type="password" id="u_pass" placeholder="at least 8 characters"></div>
          <div class="field"><label class="req" for="u_name">Full name</label><input class="input" id="u_name" placeholder="M. Kavitha"></div>
          <div class="field"><label for="u_title">Title</label><input class="input" id="u_title" placeholder="Class Teacher · X-A"></div>
          <div class="field"><label class="req" for="u_role">Role</label>
            <select class="select" id="u_role">${optList(['admin','principal','teacher','accountant','parent','student'])}</select></div>
          <div class="field"><label for="u_sid">Student id (parent and student accounts)</label><input class="input" id="u_sid" placeholder="S4102"></div>
        </div>
        <div class="row"><button class="btn btn-primary btn-sm" id="addUser">Create account</button></div>
      </div></div>

      <div class="card" style="grid-column:span 2"><div class="card-head"><h3>Danger zone</h3></div>
        <div class="card-body col" style="gap:.7rem">
        <p class="small muted">Clearing removes the school profile and every record. Accounts are kept, so you are not
        locked out of the instance you just cleared.</p>
        <div class="row"><button class="btn btn-danger btn-sm" id="wipeBtn">Clear this school's data</button></div>
      </div></div>
    </div>`;

  /* ---- choosing and checking a file ---- */
  const reportEl = document.getElementById('report');
  document.getElementById('pickFile').onclick = () => document.getElementById('bundleFile').click();

  document.getElementById('bundleFile').onchange = async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    document.getElementById('fileName').textContent = `${file.name} · ${Math.round(file.size / 1024)} KB`;
    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch { staged = null; reportEl.innerHTML = `<div class="empty">That file is not valid JSON.</div>`; return; }
    try {
      const r = await api('/provision/validate', { method: 'POST', body: parsed });
      staged = r.ok ? parsed : null;
      renderReport(r, file.name);
    } catch (err) { reportEl.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
  };

  function renderReport(r, fileName) {
    const rows = Object.entries(r.summary || {})
      .map(([k, v]) => `<div class="info-item"><span>${esc(k)}</span><b>${esc(v == null ? '—' : v)}</b></div>`).join('');
    const list = (items, cls) => `<ul class="import-findings">${items.map(x => `<li class="${cls}">${esc(x)}</li>`).join('')}</ul>`;

    reportEl.innerHTML = `
      <div class="card" style="margin-top:.3rem"><div class="card-head">
        <h3>${r.ok ? '✅ Ready to import' : '⛔ Refused'} — ${esc(fileName)}</h3></div>
        <div class="card-body col" style="gap:.8rem">
          <div class="info-grid">${rows}</div>
          ${r.errors.length ? `<div><b>${r.errors.length} error${r.errors.length === 1 ? '' : 's'} — nothing will be written</b>${list(r.errors, 'bad')}</div>` : ''}
          ${r.warnings.length ? `<div><b>${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'} — the import can still proceed</b>${list(r.warnings, '')}</div>` : ''}
          ${r.ok ? `<div class="row"><button class="btn btn-primary btn-sm" id="doImport">Import this school</button></div>` : ''}
        </div></div>`;

    const btn = document.getElementById('doImport');
    if (btn) btn.onclick = () => openModal({
      title: 'Replace every record?',
      body: `<p>This deployment holds <b>${DB.students.length}</b> students today. Importing <b>${esc(fileName)}</b>
             replaces the school profile and every record with the contents of that file. Export a backup first if you
             have not already.</p>`,
      actions: [
        { label: 'Cancel', cls: 'btn-ghost', fn: closeModal },
        { label: 'Import and replace', cls: 'btn-danger', fn: async () => {
            closeModal();
            toast('Importing…', 'ok', 2000);
            try {
              const res = await api('/provision/import', { method: 'POST', body: staged });
              await DB.load();
              AI.bust();
              toast(`Imported ${res.summary.students} students into ${res.summary.school}.`, 'ok', 5000);
              route();
            } catch (err) { toast('Import failed: ' + err.message, 'err', 6000); }
          } }
      ]
    });
  }

  document.getElementById('loadDemo').onclick = () => openModal({
    title: 'Load the sample school?',
    body: `<p>This replaces everything in this deployment with the built-in sample school — 390 students whose records
           carry deliberate defects, so the intelligence screens have something real to find. Every sample account uses
           the password <code>demo</code>, so do not leave it running on a public URL.</p>`,
    actions: [
      { label: 'Cancel', cls: 'btn-ghost', fn: closeModal },
      { label: 'Load sample school', cls: 'btn-danger', fn: async () => {
          closeModal();
          try {
            const res = await api('/provision/demo', { method: 'POST' });
            await DB.load();
            AI.bust();
            toast(`Sample school loaded — ${res.summary.students} students.`, 'ok', 5000);
            route();
          } catch (err) { toast('Failed: ' + err.message, 'err', 6000); }
        } }
    ]
  });

  /* ---- accounts ---- */
  async function paintUsers() {
    const host = document.getElementById('userList');
    try {
      const users = await api('/users');
      host.innerHTML = `<table class="table"><thead><tr>
          <th>Username</th><th>Name</th><th>Role</th><th>Linked student</th><th></th></tr></thead><tbody>
        ${users.map(u => `<tr>
          <td><b>${esc(u.username)}</b></td><td>${esc(u.name)}</td>
          <td><span class="badge">${esc(u.role)}</span></td><td>${esc(u.sid || '—')}</td>
          <td style="text-align:right">${u.username === (USER && USER.username)
            ? '<span class="tiny muted">signed in</span>'
            : `<button class="btn btn-quiet btn-sm" data-del="${esc(u.username)}">Remove</button>`}</td>
        </tr>`).join('')}</tbody></table>`;
      host.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        try {
          await api('/users/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' });
          toast('Account removed.', 'ok');
          paintUsers();
        } catch (e) { toast(e.message, 'err'); }
      });
    } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  paintUsers();

  document.getElementById('addUser').onclick = async () => {
    const v = id => document.getElementById(id).value.trim();
    const body = { username: v('u_user'), password: v('u_pass'), name: v('u_name'),
                   title: v('u_title'), role: v('u_role'), sid: v('u_sid') };
    if (!body.username || !body.password || !body.name) return toast('Username, password and name are required.', 'err');
    try {
      await api('/users', { method: 'POST', body });
      ['u_user','u_pass','u_name','u_title','u_sid'].forEach(id => document.getElementById(id).value = '');
      toast('Account created.', 'ok');
      paintUsers();
    } catch (e) { toast(e.message, 'err'); }
  };

  document.getElementById('wipeBtn').onclick = () => openModal({
    title: 'Clear this school’s data?',
    body: `<p>Every student, mark, receipt and attendance record in this deployment is removed. Accounts are kept.
           This cannot be undone — export a backup first.</p>`,
    actions: [
      { label: 'Keep the data', cls: 'btn-ghost', fn: closeModal },
      { label: 'Clear everything', cls: 'btn-danger', fn: async () => {
          closeModal();
          try {
            await api('/provision/wipe', { method: 'POST' });
            await DB.load();
            AI.bust();
            toast('This deployment is now empty.', 'ok');
            route();
          } catch (e) { toast(e.message, 'err'); }
        } }
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
      <div class="row" style="gap:.6rem">${AI_CHIP}<span class="badge badge-accent">On-device</span></div>
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
      <div class="row" style="gap:.6rem">${AI_CHIP}<span class="badge badge-accent">On-device</span></div>
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
      <div class="row" style="gap:.6rem">${AI_CHIP}<span class="badge badge-accent">On-device</span></div>
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
(async () => {
  /* One round trip brings the session, the school profile and every
     collection. A 401 means no session — api() has already redirected. */
  try {
    await DB.load();
  } catch (e) {
    document.getElementById('view').innerHTML =
      `<div class="empty">Could not reach the school database.<br><small>${esc(e.message)}</small></div>`;
    return;
  }
  ROLE = (USER && USER.role) || 'admin';

  /* A deployment with no school loaded yet has nothing to show but the
     screen that fixes that. */
  if (!SCHOOL.provisioned && ROLE === 'admin' && !location.hash) location.hash = '#provision';

  paintNav();
  addEventListener('hashchange', route);

  document.getElementById('logoutBtn').onclick = async () => {
    try { await api('/logout', { method: 'POST' }); } catch { /* going anyway */ }
    location.href = 'index.html';
  };
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
})();
