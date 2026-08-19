/* ============================================================
   domain.js — Tamil Nadu school domain model

   Loaded twice, deliberately:

     • by the browser as a plain <script>, first in the order, so every
       later file sees these as globals (no modules, no bundler);
     • by Node via require(), for the demo-school generator and the tests.

   It is the one file both halves share, so nothing below may touch the
   DOM, localStorage, fetch or the filesystem.

   Categories here are regulatory, not decorative: communities drive
   scholarship eligibility, groups drive the Std XI–XII subject map, and
   the 75% rule is the public-exam bar. Check this file before inventing
   a category anywhere else.
   ============================================================ */

/* ---------- Reference data ---------- */
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
const ROLES = ['admin','principal','teacher','accountant','parent','student'];

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
   The TN academic year runs June to April on a Monday–Saturday week.

   These three are `let`, not `const`, because they are now per-school
   settings: a school supplies its own year start, working-day total and
   holiday list in its data file, and core.js overwrites these at boot
   from the loaded school profile. The values here are only the defaults
   an un-provisioned instance falls back to. */
let YEAR_START = '2026-06-01';
let YEAR_WORKING_DAYS = 220;            // full-year total, for eligibility forecasting
let MIN_ATTENDANCE = 0.75;              // public-exam eligibility threshold
let HOLIDAYS = new Set(['2026-06-15', '2026-07-17', '2026-07-31']);

function buildWorkingDays(fromISO, toISO, holidays = HOLIDAYS) {
  const out = [];
  const d = new Date(fromISO + 'T00:00:00');
  const end = new Date(toISO + 'T00:00:00');
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    if (d.getDay() !== 0 && !holidays.has(iso)) out.push(iso);   // Sunday off
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/* The working days elapsed so far, which the attendance history is indexed
   against. Replaced by the school's own attDays once data is loaded — one
   character of `attHistory[sid]` per entry here, so the two must stay the
   same length. */
let WORKING_DAYS = buildWorkingDays(YEAR_START, '2026-08-01');
const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

/* Apply a school's calendar settings. Called by core.js after the profile
   loads, and by the demo generator before it builds a year. */
function applyCalendar({ yearStart, yearWorkingDays, minAttendance, holidays, workingDays } = {}) {
  if (yearStart) YEAR_START = yearStart;
  if (yearWorkingDays) YEAR_WORKING_DAYS = Number(yearWorkingDays);
  if (minAttendance) MIN_ATTENDANCE = Number(minAttendance);
  if (Array.isArray(holidays)) HOLIDAYS = new Set(holidays);
  if (Array.isArray(workingDays) && workingDays.length) WORKING_DAYS = workingDays;
  return { YEAR_START, YEAR_WORKING_DAYS, MIN_ATTENDANCE, WORKING_DAYS };
}

/* ---------- Shared helpers ---------- */
const INR = n => '₹' + Number(n || 0).toLocaleString('en-IN');
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Deterministic pseudo-random, so generated data is reproducible. */
function rng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

function age(iso) {
  if (!iso) return 0;
  const b = new Date(iso), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  const m = n.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--;
  return a;
}

/* Node sees a module; the browser sees plain globals and ignores this. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CLASSES, SECTIONS, COMMUNITIES, RELIGIONS, MEDIUMS, GROUPS, BLOOD, OCCUPATIONS,
    EXAM_TERMS, FEE_HEADS, ROLES, SUBJECTS_BY_LEVEL, levelOf, subjectsFor, FEE_BY_CLASS,
    buildWorkingDays, applyCalendar, rng, age, todayISO, INR, DOW,
    get YEAR_START() { return YEAR_START; },
    get YEAR_WORKING_DAYS() { return YEAR_WORKING_DAYS; },
    get MIN_ATTENDANCE() { return MIN_ATTENDANCE; },
    get HOLIDAYS() { return HOLIDAYS; },
    get WORKING_DAYS() { return WORKING_DAYS; }
  };
}
