/* ============================================================
   core.js — storage, seed data, formatters, toasts, theme
   Shared by index.html (public site) and app.html (portal)
   ============================================================ */

/* ---------- School identity ---------- */
const SCHOOL = {
  name: 'New Gen Higher Secondary School',
  short: 'New Gen Hr. Sec. School',
  tamil: 'நியூ ஜென் மேல்நிலைப் பள்ளி',
  addr: '142, Perundurai Road, Erode – 638 011, Tamil Nadu',
  phone: '0424 – 2260 145',
  email: 'office@newgenhss.edu.in',
  code: '33051',
  udise: '33071200812',
  year: '2026–27',
  est: 1998
};

/* ---------- Demo users by role ---------- */
const DEMO_USERS = {
  admin:      { id: 'admin',      name: 'R. Saravanan',        title: 'Office Superintendent' },
  principal:  { id: 'principal',  name: 'L. Priyadharshini',   title: 'Principal' },
  teacher:    { id: 'tchr.kavitha', name: 'M. Kavitha',        title: 'Class Teacher · X-A' },
  accountant: { id: 'accounts',   name: 'P. Elangovan',        title: 'Accountant' },
  parent:     { id: 'parent.4102', name: 'S. Murugesan',       title: 'Parent of Karthik Raja' },
  student:    { id: 'stu.4102',   name: 'Karthik Raja S',      title: 'Std X-A · Roll 12' }
};

/* ---------- localStorage wrapper ---------- */
const Store = {
  key: k => 'ngss.' + k,
  get(k, fallback = null) {
    try { const v = localStorage.getItem(this.key(k)); return v === null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(this.key(k), JSON.stringify(v)); } catch (e) { console.warn(e); } },
  del(k) { localStorage.removeItem(this.key(k)); },
  clearAll() { Object.keys(localStorage).filter(k => k.startsWith('ngss.')).forEach(k => localStorage.removeItem(k)); }
};

/* ---------- Toast ---------- */
function toast(msg, kind = '', ms = 3200) {
  let host = document.getElementById('toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  const icon = { ok: '✅', err: '⚠️', warn: '⚡', voice: '🎙' }[kind] || 'ℹ️';
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
  if (!e.target.closest('#themeBtn')) return;
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});
addEventListener('DOMContentLoaded', () => applyTheme(Store.get('theme', 'light')));

/* ---------- Formatters ---------- */
const INR = n => '₹' + Number(n || 0).toLocaleString('en-IN');
const INRs = n => {
  n = Number(n || 0);
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L';
  if (n >= 1e3) return '₹' + (n / 1e3).toFixed(1) + 'K';
  return '₹' + n;
};
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return iso;
  return `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function age(iso) {
  if (!iso) return '—';
  const d = new Date(iso), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
}
const initials = n => (n || '?').trim().split(/\s+/).filter(w => w.length > 1)
  .slice(0, 2).map(w => w[0]).join('').toUpperCase() || (n || '?')[0].toUpperCase();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => new Date().toISOString().slice(0, 10);
const uid = p => p + '-' + Math.random().toString(36).slice(2, 8);

/* ---------- Deterministic pseudo-random (stable seed data) ---------- */
function rng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

/* ---------- Reference data (Tamil Nadu context) ---------- */
const CLASSES = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
const SECTIONS = ['A','B','C'];
const COMMUNITIES = ['OC','BC','BCM','MBC','SC','ST'];
const RELIGIONS = ['Hindu','Christian','Muslim','Others'];
const MEDIUMS = ['Tamil','English'];
const GROUPS = ['Bio-Maths','Pure Science','Computer Science','Commerce','Vocational'];
const BLOOD = ['A+','A-','B+','B-','O+','O-','AB+','AB-'];
const OCCUPATIONS = ['Farmer','Weaver','Driver','Teacher','Shopkeeper','Government Service','Daily Wage','Business','Textile Worker','Homemaker'];
const EXAM_TERMS = ['Unit Test 1','Quarterly','Half-Yearly','Unit Test 2','Model Exam','Annual'];
const FEE_HEADS = ['Tuition Fee','Term Fee','Exam Fee','Lab Fee','Transport Fee','Library Fee'];

const SUBJECTS_BY_LEVEL = {
  primary:   ['Tamil','English','Mathematics','Environmental Science'],
  middle:    ['Tamil','English','Mathematics','Science','Social Science'],
  secondary: ['Tamil','English','Mathematics','Science','Social Science'],
  higher:    ['Tamil','English','Physics','Chemistry','Biology','Mathematics','Computer Science','Accountancy','Commerce','Economics']
};
function levelOf(cls) {
  const i = CLASSES.indexOf(cls);
  return i <= 4 ? 'primary' : i <= 7 ? 'middle' : i <= 9 ? 'secondary' : 'higher';
}
function subjectsFor(cls, group) {
  const lvl = levelOf(cls);
  if (lvl !== 'higher') return SUBJECTS_BY_LEVEL[lvl];
  const base = ['Tamil','English'];
  if (group === 'Bio-Maths')        return [...base,'Physics','Chemistry','Biology','Mathematics'];
  if (group === 'Pure Science')     return [...base,'Physics','Chemistry','Biology','Mathematics'];
  if (group === 'Computer Science') return [...base,'Physics','Chemistry','Mathematics','Computer Science'];
  if (group === 'Commerce')         return [...base,'Accountancy','Commerce','Economics','Computer Science'];
  return [...base,'Mathematics','Science','Social Science','Computer Science'];
}
const FEE_BY_CLASS = { I:10500, II:10500, III:10500, IV:10500, V:10500, VI:14000, VII:14000, VIII:14000, IX:17500, X:17500, XI:21000, XII:21000 };

/* ---------- Academic calendar ----------
   TN academic year runs June to April. Monday–Saturday working week.
   WORKING_DAYS holds every working day elapsed so far this year, which is what
   the attendance history is indexed against. */
const YEAR_START = '2026-06-01';
const YEAR_WORKING_DAYS = 220;          // full-year total, for eligibility forecasting
const MIN_ATTENDANCE = 0.75;            // public exam eligibility threshold
const HOLIDAYS = new Set(['2026-06-15', '2026-07-17', '2026-07-31']);

function buildWorkingDays(fromISO, toISO) {
  const out = [];
  const d = new Date(fromISO + 'T00:00:00');
  const end = new Date(toISO + 'T00:00:00');
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    if (d.getDay() !== 0 && !HOLIDAYS.has(iso)) out.push(iso);   // Sunday off
    d.setDate(d.getDate() + 1);
  }
  return out;
}
const WORKING_DAYS = buildWorkingDays(YEAR_START, '2026-08-01');
const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

/* ---------- Name pools ---------- */
const BOY = ['Karthik','Arun','Vignesh','Dinesh','Prabhu','Surya','Ashwin','Hariharan','Manikandan','Naveen','Gokul','Sathish','Bharath','Vishnu','Ranjith','Yuvaraj','Aravind','Selvam','Rajesh','Tamilarasan','Kavin','Jeeva','Muthu','Sanjay','Balaji','Praveen','Ilango','Deepak','Sasikumar','Thirumurugan'];
const GIRL = ['Divya','Sneha','Kavya','Priya','Deepika','Nandhini','Meena','Lakshmi','Abinaya','Swathi','Janani','Revathi','Sowmiya','Keerthana','Yamuna','Anitha','Bhavani','Pavithra','Ramya','Nithya','Gayathri','Vaishnavi','Suganya','Malathi','Kalaivani','Sangeetha','Aishwarya','Dharani','Iniya','Tamilselvi'];
const SUR = ['Raja','Kumar','Murugesan','Selvam','Ramanathan','Palanisamy','Subramani','Natarajan','Chinnasamy','Velmurugan','Ganesan','Krishnan','Perumal','Sivakumar','Anbarasan','Duraisamy','Marimuthu','Ravichandran','Elangovan','Sundaram'];
const FATHER = ['Murugesan','Palanisamy','Subramani','Natarajan','Chinnasamy','Velmurugan','Ganesan','Krishnan','Perumal','Sivakumar','Anbarasan','Duraisamy','Marimuthu','Ravichandran','Elangovan','Sundaram','Rajendran','Kaliyamoorthy','Thangavel','Ponnusamy'];
const MOTHER = ['Amutha','Selvi','Vasanthi','Rajeswari','Kalaiselvi','Chitra','Poongodi','Saroja','Indira','Mallika','Jayanthi','Vijaya','Punitha','Kanaga','Sumathi','Bhuvaneswari','Latha','Santhi','Uma','Valarmathi'];
const PLACES = ['Perundurai Road','Surampatti','Veerappanchatram','Karungalpalayam','Thindal','Kasipalayam','Solar Nagar','Periyar Nagar','Anna Nagar','Nasiyanur Road','Chithode','Vairapalayam'];

/* ---------- Staff seed ---------- */
const STAFF = [
  { id:'T01', name:'M. Kavitha',        role:'Teacher',   subject:'Mathematics',      cls:'X-A',  qual:'M.Sc., B.Ed.',  phone:'9843012301', joined:'2012-06-04' },
  { id:'T02', name:'S. Ravichandran',   role:'Teacher',   subject:'Physics',          cls:'XII-A',qual:'M.Sc., M.Ed.',  phone:'9843012302', joined:'2009-06-08' },
  { id:'T03', name:'A. Bhuvaneswari',   role:'Teacher',   subject:'Tamil',            cls:'IX-B', qual:'M.A., B.Ed.',   phone:'9843012303', joined:'2015-06-15' },
  { id:'T04', name:'K. Elangovan',      role:'Teacher',   subject:'Chemistry',        cls:'XI-A', qual:'M.Sc., B.Ed.',  phone:'9843012304', joined:'2011-07-01' },
  { id:'T05', name:'R. Jayanthi',       role:'Teacher',   subject:'English',          cls:'VIII-A',qual:'M.A., B.Ed.',  phone:'9843012305', joined:'2017-06-12' },
  { id:'T06', name:'P. Marimuthu',      role:'Teacher',   subject:'Social Science',   cls:'VII-A',qual:'M.A., B.Ed.',   phone:'9843012306', joined:'2013-06-10' },
  { id:'T07', name:'V. Sangeetha',      role:'Teacher',   subject:'Biology',          cls:'XII-B',qual:'M.Sc., B.Ed.',  phone:'9843012307', joined:'2016-06-06' },
  { id:'T08', name:'N. Thangavel',      role:'Teacher',   subject:'Computer Science', cls:'XI-B', qual:'M.C.A., B.Ed.', phone:'9843012308', joined:'2018-06-04' },
  { id:'T09', name:'G. Punitha',        role:'Teacher',   subject:'Primary',          cls:'III-A',qual:'D.T.Ed.',       phone:'9843012309', joined:'2014-06-09' },
  { id:'T10', name:'D. Sivakumar',      role:'Teacher',   subject:'Physical Education',cls:'—',   qual:'M.P.Ed.',       phone:'9843012310', joined:'2010-06-14' },
  { id:'A01', name:'R. Saravanan',      role:'Admin',     subject:'Office',           cls:'—',    qual:'B.Com.',        phone:'9843012311', joined:'2008-04-01' },
  { id:'A02', name:'P. Elangovan',      role:'Accountant',subject:'Accounts',         cls:'—',    qual:'M.Com.',        phone:'9843012312', joined:'2011-04-01' },
  { id:'A03', name:'L. Priyadharshini', role:'Principal', subject:'Administration',   cls:'—',    qual:'M.Sc., M.Ed.',  phone:'9843012300', joined:'2006-06-01' },
  { id:'A04', name:'S. Malathi',        role:'Librarian', subject:'Library',          cls:'—',    qual:'M.L.I.Sc.',     phone:'9843012313', joined:'2019-06-03' }
];

/* ---------- Student generator ---------- */
function buildStudents() {
  const r = rng(20260802);
  const pick = a => a[Math.floor(r() * a.length)];
  const out = [];
  let adm = 4000;

  CLASSES.forEach(cls => {
    const secs = ['XI','XII'].includes(cls) ? ['A','B'] : SECTIONS.slice(0, 2);
    secs.forEach(sec => {
      const strength = 14 + Math.floor(r() * 6);
      for (let roll = 1; roll <= strength; roll++) {
        const isBoy = r() > .48;
        const first = isBoy ? pick(BOY) : pick(GIRL);
        const sur = pick(SUR);
        const clsIdx = CLASSES.indexOf(cls);
        const birthYear = 2026 - (clsIdx + 6);
        const dob = `${birthYear}-${String(1 + Math.floor(r() * 12)).padStart(2,'0')}-${String(1 + Math.floor(r() * 28)).padStart(2,'0')}`;
        const group = ['XI','XII'].includes(cls) ? pick(GROUPS) : '';
        const community = pick(COMMUNITIES);
        const total = FEE_BY_CLASS[cls] + (group && group !== 'Commerce' && group !== 'Vocational' ? 4000 : 0);
        const rte = community === 'SC' || community === 'ST' ? r() > .6 : r() > .92;
        const payable = rte ? 0 : total;
        const paid = rte ? 0 : Math.round(payable * pick([1, 1, 1, .7, .5, .35, 0]) / 100) * 100;
        adm++;

        out.push({
          id: 'S' + adm,
          adm: 'NG' + adm,
          emis: '331' + (7120000 + adm),
          name: `${first} ${sur}`,
          gender: isBoy ? 'Male' : 'Female',
          cls, sec, roll, group,
          medium: pick(MEDIUMS),
          dob,
          community,
          religion: pick(RELIGIONS),
          blood: pick(BLOOD),
          aadhaar: r() > .12 ? String(400000000000 + Math.floor(r() * 599999999999)) : '',
          father: pick(FATHER),
          fatherOcc: pick(OCCUPATIONS),
          mother: pick(MOTHER),
          phone: '9' + (600000000 + Math.floor(r() * 399999999)),
          address: `${1 + Math.floor(r() * 180)}, ${pick(PLACES)}, Erode`,
          admitted: `${2026 - clsIdx}-06-0${1 + Math.floor(r() * 8)}`,
          rte,
          transport: r() > .62 ? pick(['Route 1 · Chithode','Route 2 · Thindal','Route 3 · Nasiyanur','Route 4 · Perundurai']) : '',
          hostel: false,
          feeTotal: payable, feePaid: paid,
          attPresent: 0, attTotal: 0,
          /* fields the scholarship matcher and UDISE returns depend on */
          income: Math.round((40000 + r() * 340000) / 1000) * 1000,
          firstGraduate: r() > .68,
          cwsn: r() > .965,
          status: 'Active'
        });
      }
    });
  });

  // Anchor demo student for the parent/student role
  /* ---- Deliberate data defects ----
     Real student masters are never clean. These are the exact faults that get a
     UDISE+ batch rejected, seeded at realistic rates so the data-quality checker
     has something true to find rather than a staged demo. */
  const d = rng(31337);
  const hit = (frac, fn) => out.forEach(s => { if (d() < frac) fn(s); });

  hit(.030, s => s.phone = '0' + s.phone.slice(1));            // landline/leading zero
  hit(.015, s => s.phone = s.phone.slice(0, 9));               // nine digits
  hit(.020, s => s.aadhaar = s.aadhaar.slice(0, 11));          // truncated UID
  hit(.025, s => s.address = '');
  hit(.020, s => s.mother = '');
  hit(.030, s => s.income = 0);
  hit(.018, s => s.blood = '—');
  hit(.012, s => { if (['XI', 'XII'].includes(s.cls)) s.group = ''; });
  hit(.010, s => { if (!['XI', 'XII'].includes(s.cls)) s.group = 'Commerce'; });
  hit(.014, s => s.dob = `${(+s.dob.slice(0, 4)) - 4}${s.dob.slice(4)}`);  // mistyped year

  // one clerk reusing a single mobile across a whole row of admissions
  const shared = out.slice(40, 45);
  shared.forEach(s => s.phone = '9842211000');

  // an RTE child wrongly carrying a fee demand
  const rteWrong = out.filter(s => s.rte).slice(0, 3);
  rteWrong.forEach(s => s.feeTotal = FEE_BY_CLASS[s.cls]);

  // a genuine duplicate enrolment — same child entered twice
  if (out.length > 120) {
    out[119].name = out[118].name;
    out[119].dob = out[118].dob;
  }

  const anchor = out.find(s => s.cls === 'X' && s.sec === 'A');
  if (anchor) {
    /* The demo child is pinned to S4102 so the parent and student logins can find
       them. Admission numbers run sequentially from 4000, so S4102 is already
       taken by whoever happens to be the 102nd admission — swap the two ids
       rather than overwriting, or the roll ends up with a duplicate id and every
       map keyed by student id silently loses a record. */
    const clash = out.find(s => s.id === 'S4102' && s !== anchor);
    if (clash) { clash.id = anchor.id; clash.adm = anchor.adm; }
    anchor.id = 'S4102'; anchor.adm = 'NG4102';
    anchor.name = 'Karthik Raja'; anchor.gender = 'Male';
    anchor.father = 'Murugesan'; anchor.mother = 'Amutha';
    anchor.roll = 12; anchor.community = 'MBC'; anchor.medium = 'Tamil';
    anchor.dob = '2010-03-12'; anchor.phone = '9843045678';
    anchor.income = 96000; anchor.firstGraduate = true; anchor.cwsn = false;
    anchor.aadhaar = '482913756240'; anchor.address = '42, Perundurai Road, Erode';
  }
  return out;
}

/* ---------- Daily attendance history ----------
   One 'P' | 'A' | 'L' per working day per student. Aggregates alone cannot
   support anomaly detection — a 68% student who is drifting downward and a 68%
   student who missed one illness block need completely different responses, and
   only the day-level sequence tells them apart.

   A minority of students are deliberately given the real-world patterns a TN
   school sees, so the detector has something true to find. */
function buildAttHistory(students) {
  const hist = {};
  const n = WORKING_DAYS.length;
  const weekday = WORKING_DAYS.map(d => new Date(d + 'T00:00:00').getDay());

  students.forEach((s, i) => {
    const r = rng(7700 + i * 13);
    const base = .72 + r() * .27;          // this child's underlying regularity
    const roll = r();

    let pattern = 'normal';
    if (roll > .965)      pattern = 'stopped';    // vanished — possible dropout
    else if (roll > .925) pattern = 'declining';  // drifting away
    else if (roll > .885) pattern = 'migration';  // long block, seasonal work
    else if (roll > .845) pattern = 'weekday';    // systematic single-day absence
    else if (roll > .805) pattern = 'erratic';    // scattered single days

    const offDay = 1 + Math.floor(r() * 6);       // for the weekday pattern
    const blockStart = Math.floor(n * (.3 + r() * .4));
    const blockLen = 6 + Math.floor(r() * 5);
    const stopFrom = n - (7 + Math.floor(r() * 6));

    let out = '';
    for (let d = 0; d < n; d++) {
      let p = base;                               // probability of being present
      if (pattern === 'declining') p = base - (d / n) * .55;
      if (pattern === 'stopped' && d >= stopFrom) p = .02;
      if (pattern === 'migration' && d >= blockStart && d < blockStart + blockLen) p = .04;
      if (pattern === 'weekday' && weekday[d] === offDay) p = .12;
      if (pattern === 'erratic') p = base - .12;

      const x = r();
      out += x < p ? 'P' : (x < p + .04 ? 'L' : 'A');   // late counts as present
    }
    hist[s.id] = out;
    s.attTotal = n;
    s.attPresent = [...out].filter(c => c !== 'A').length;
  });

  // Keep the demo child comfortably regular
  const anchor = students.find(s => s.id === 'S4102');
  if (anchor) {
    let h = '';
    const r = rng(4102);
    for (let d = 0; d < n; d++) h += r() < .93 ? 'P' : (r() < .5 ? 'L' : 'A');
    hist[anchor.id] = h;
    anchor.attTotal = n;
    anchor.attPresent = [...h].filter(c => c !== 'A').length;
  }
  return hist;
}

/* ---------- Marks generator ---------- */
function buildMarks(students) {
  const marks = {}; // key: studentId|term|subject -> score
  students.forEach((s, i) => {
    const r = rng(5000 + i);
    const subs = subjectsFor(s.cls, s.group);
    ['Unit Test 1', 'Quarterly'].forEach(term => {
      const max = term.startsWith('Unit') ? 50 : 100;
      subs.forEach(sub => {
        const base = .42 + r() * .56;
        marks[`${s.id}|${term}|${sub}`] = Math.min(max, Math.round(max * base));
      });
    });
  });
  return marks;
}

/* ---------- Notices ---------- */
const NOTICES = [
  { id:'N1', date:'2026-08-02', title:'Quarterly Examination Timetable — Std VI to XII', body:'Examinations commence on 18 August 2026. The detailed timetable is published in the parent portal and on the notice board.', to:'All', by:'Principal' },
  { id:'N2', date:'2026-07-28', title:'Parent–Teacher Meeting — Std X & XII', body:'Saturday, 9 August 2026 at 10:00 AM in the main hall. Attendance is mandatory for at least one parent.', to:'Std X, XII', by:'Principal' },
  { id:'N3', date:'2026-07-21', title:'Free bus pass applications — last date 10 August', body:'Std XI and XII students may collect the application form from the school office during working hours.', to:'Std XI, XII', by:'Office' },
  { id:'N4', date:'2026-07-15', title:'Independence Day celebrations', body:'Flag hoisting at 8:00 AM followed by a cultural programme. All parents are cordially invited.', to:'All', by:'Principal' },
  { id:'N5', date:'2026-07-08', title:'Noon meal menu revision', body:'The revised weekly menu as per the Government of Tamil Nadu circular is effective from 14 July 2026.', to:'Staff', by:'Office' }
];

/* ---------- Fee receipts ---------- */
function buildReceipts(students) {
  const out = [];
  let n = 1000;
  students.filter(s => s.feePaid > 0).forEach((s, i) => {
    const r = rng(9000 + i);
    let left = s.feePaid;
    const parts = left > 12000 ? 2 : 1;
    for (let p = 0; p < parts; p++) {
      const amt = p === parts - 1 ? left : Math.round(left / 2 / 100) * 100;
      left -= amt;
      if (amt <= 0) continue;
      n++;
      out.push({
        id: 'R' + n, no: 'RC' + n,
        sid: s.id, name: s.name, cls: s.cls, sec: s.sec,
        date: `2026-0${p === 0 ? 6 : 7}-${String(1 + Math.floor(r() * 27)).padStart(2,'0')}`,
        head: p === 0 ? 'Tuition Fee' : 'Term Fee',
        mode: ['Cash','UPI','Net Banking','Cheque'][Math.floor(r() * 4)],
        amount: amt
      });
    }
  });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/* ---------- Database bootstrap ---------- */
/* Bump when the seeded shape changes, so a browser holding older data re-seeds
   instead of half-rendering against fields that do not exist yet. */
const SCHEMA = 2;

const DB = {
  load() {
    if (!Store.get('students') || Store.get('schema') !== SCHEMA) this.seed();
    this.students = Store.get('students', []);
    this.marks    = Store.get('marks', {});
    this.receipts = Store.get('receipts', []);
    this.notices  = Store.get('notices', NOTICES);
    this.staff    = Store.get('staff', STAFF);
    this.attendance = Store.get('attendance', {});   // key: date|cls|sec -> { sid: 'P'|'A'|'L' }
    this.attHistory = Store.get('attHistory', {});   // key: sid -> 'PPAPL…' one char per working day
    this.attDays = Store.get('attDays', WORKING_DAYS);  // the day each character maps to
    this.applications = Store.get('applications', []);
    return this;
  },
  seed() {
    const students = buildStudents();
    Store.set('attHistory', buildAttHistory(students));   // also fills attPresent/attTotal
    Store.set('attDays', WORKING_DAYS);
    Store.set('students', students);
    Store.set('marks', buildMarks(students));
    Store.set('receipts', buildReceipts(students));
    Store.set('notices', NOTICES);
    Store.set('staff', STAFF);
    Store.set('attendance', {});
    Store.set('applications', []);
    Store.set('schema', SCHEMA);
  },
  save(k) { Store.set(k, this[k]); },
  reset() {
    ['students','marks','receipts','attendance','attHistory','attDays','applications','notices','staff','schema']
      .forEach(k => Store.del(k));
    this.load();
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
