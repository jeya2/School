/* ============================================================
   Tests for the three on-device intelligence engines.
   No dependencies — run with:   node tests/ai.test.js
   ============================================================ */
const fs = require('fs');
const path = require('path');

/* Minimal browser surface for core.js + ai.js */
const mem = {};
global.window = {};
global.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
global.document = { addEventListener() {}, documentElement: { dataset: {} }, querySelectorAll: () => [] };
global.addEventListener = () => {};
Object.keys(mem).length;

const load = f => fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', f), 'utf8');
const api = eval(load('core.js') + '\n;\n' + load('ai.js') +
  ';({ DB, AI, CLASSES, WORKING_DAYS, YEAR_WORKING_DAYS, MIN_ATTENDANCE, age })');
const { DB, AI, CLASSES, WORKING_DAYS, YEAR_WORKING_DAYS } = api;

DB.load();

let pass = 0, fail = 0;
function ok(label, cond, extra = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '   ' + extra : ''}`);
}
const section = t => console.log(`\n── ${t} ──`);

/* ══════════════ seed integrity ══════════════ */
section('seed data');
ok('students generated', DB.students.length > 200, `${DB.students.length} students`);
ok('student ids are unique',
  new Set(DB.students.map(s => s.id)).size === DB.students.length,
  `${new Set(DB.students.map(s => s.id)).size} unique of ${DB.students.length}`);
ok('admission numbers are unique',
  new Set(DB.students.map(s => s.adm)).size === DB.students.length);
ok('the demo child S4102 exists exactly once',
  DB.students.filter(s => s.id === 'S4102').length === 1);
ok('roll numbers are unique within every section', (() => {
  const seen = new Set();
  return DB.students.every(s => {
    const k = `${s.cls}-${s.sec}-${s.roll}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
})());
ok('every section starts at roll 1', (() => {
  const bySec = {};
  DB.students.forEach(s => {
    const k = `${s.cls}-${s.sec}`;
    bySec[k] = Math.min(bySec[k] ?? Infinity, s.roll);
  });
  return Object.values(bySec).every(min => min === 1);
})());
ok('working days computed', WORKING_DAYS.length > 30, `${WORKING_DAYS.length} days`);
ok('every student has a daily history',
  DB.students.every(s => (DB.attHistory[s.id] || '').length === WORKING_DAYS.length));
ok('history uses only P/A/L',
  Object.values(DB.attHistory).every(h => /^[PAL]*$/.test(h)));
ok('attPresent agrees with the history',
  DB.students.every(s => s.attPresent === [...DB.attHistory[s.id]].filter(c => c !== 'A').length));
ok('income / firstGraduate / cwsn present',
  DB.students.every(s => 'income' in s && 'firstGraduate' in s && 'cwsn' in s));

/* ══════════════ 1 · attendance ══════════════ */
section('attendance — pattern detection');
const all = AI.attendance.all();
ok('some students flagged', all.length > 0, `${all.length} flagged`);
ok('results sorted by risk descending',
  all.every((r, i) => i === 0 || all[i - 1].risk >= r.risk));
ok('every flag carries its evidence',
  all.every(r => r.flags.every(f => f.evidence && f.title && f.action && f.severity)));

const codes = new Set();
all.forEach(r => r.flags.forEach(f => codes.add(f.code)));
['DRIFT', 'ONGOING', 'BLOCK', 'WEEKDAY', 'ERRATIC'].forEach(c =>
  ok(`detector fires: ${c}`, codes.has(c)));

// a synthetic student that must trip the "stopped attending" detector
const guinea = DB.students[0];
const backup = DB.attHistory[guinea.id];
DB.attHistory[guinea.id] = 'P'.repeat(WORKING_DAYS.length - 12) + 'A'.repeat(12);
const stopped = AI.attendance.detect(guinea, 90).find(f => f.code === 'ONGOING');
ok('12 trailing absences → critical "has stopped attending"',
  !!stopped && stopped.severity === 'critical', stopped ? stopped.title : '(not detected)');

DB.attHistory[guinea.id] = 'P'.repeat(WORKING_DAYS.length);
ok('a perfect record produces no flags',
  AI.attendance.detect(guinea, 90).length === 0);
DB.attHistory[guinea.id] = backup;

section('attendance — 75% eligibility forecast');
const fc = s => AI.attendance.forecast(s);
const perfect = { attPresent: WORKING_DAYS.length, attTotal: WORKING_DAYS.length };
const zero = { attPresent: 0, attTotal: WORKING_DAYS.length };
const half = { attPresent: Math.round(WORKING_DAYS.length * .5), attTotal: WORKING_DAYS.length };

ok('required days = 75% of the year',
  fc(perfect).required === Math.ceil(YEAR_WORKING_DAYS * 0.75), `${fc(perfect).required} of ${YEAR_WORKING_DAYS}`);
ok('perfect attendance is on track', ['on-track', 'secured'].includes(fc(perfect).band), fc(perfect).band);
ok('zero attendance is critical or worse',
  ['critical', 'at-risk', 'impossible'].includes(fc(zero).band), fc(zero).band);
ok('50% student needs a higher rate than they have managed',
  fc(half).reqRate > fc(half).curRate,
  `needs ${Math.round(fc(half).reqRate * 100)}%, managing ${Math.round(fc(half).curRate * 100)}%`);
ok('elapsed + remaining = full year',
  fc(half).elapsed + fc(half).remaining === YEAR_WORKING_DAYS);
ok('a student past the threshold is "secured"',
  fc({ attPresent: 200, attTotal: WORKING_DAYS.length }).band === 'secured');
ok('every forecast carries a plain-language verdict',
  [perfect, zero, half].every(s => typeof fc(s).verdict === 'string' && fc(s).verdict.length > 20));

/* ══════════════ 2 · data quality ══════════════ */
section('data quality');
const q = AI.quality.run();
ok('findings produced', q.findings.length > 0, `${q.findings.length} issue types`);
ok('score is within 0..100', q.score >= 0 && q.score <= 100, `score ${q.score}`);
ok('affected + clean = total', q.affected + q.clean === q.total);
ok('every finding names the field and the reason',
  q.findings.every(f => f.field && f.why && f.title));
ok('blockers detected', q.blockers > 0, `${q.blockers} blocking defects`);
ok('uploadReady is false while blockers exist', q.uploadReady === (q.blockers === 0));
ok('findings sorted by weighted impact',
  q.findings.every((f, i) => i === 0 ||
    AI.quality.WEIGHT[q.findings[i - 1].severity] * q.findings[i - 1].count >=
    AI.quality.WEIGHT[f.severity] * f.count));

const byId = Object.fromEntries(q.findings.map(f => [f.id, f]));
['aadhaar-missing', 'phone-invalid', 'address-missing', 'income-missing', 'duplicate-enrolment']
  .forEach(id => ok(`rule fires: ${id}`, !!byId[id], byId[id] ? `${byId[id].count} hits` : '(none)'));

// invalid-phone rule must reject exactly what it should
const phoneRule = AI.quality.RULES.find(r => r.id === 'phone-invalid');
ok('phone rule accepts a valid mobile', phoneRule.test({ phone: '9843045678' }) === false);
ok('phone rule rejects a leading zero', phoneRule.test({ phone: '0843045678' }) === true);
ok('phone rule rejects nine digits', phoneRule.test({ phone: '984304567' }) === true);
ok('phone rule rejects empty', phoneRule.test({ phone: '' }) === true);

const aadRule = AI.quality.RULES.find(r => r.id === 'aadhaar-invalid');
ok('aadhaar rule accepts 12 digits', aadRule.test({ aadhaar: '482913756240' }) === false);
ok('aadhaar rule rejects 11 digits', aadRule.test({ aadhaar: '48291375624' }) === true);
ok('aadhaar rule ignores blank (that is the other rule)', aadRule.test({ aadhaar: '' }) === false);

// a perfectly clean school must score 100
const realStudents = DB.students;
DB.students = [{
  id: 'X1', adm: 'NG1', emis: '3317120001', name: 'Test Child', dob: '2010-06-01',
  cls: 'X', sec: 'A', roll: 1, group: '', community: 'MBC', religion: 'Hindu',
  aadhaar: '123456789012', phone: '9843000000', father: 'F', mother: 'M',
  address: 'Somewhere', blood: 'O+', income: 100000, rte: false, feeTotal: 100
}];
const clean = AI.quality.run();
ok('a flawless record scores 100', clean.score === 100, `score ${clean.score}, ${clean.findings.length} findings`);
ok('a flawless record is upload-ready', clean.uploadReady === true);
DB.students = realStudents;

/* ══════════════ 3 · scholarships ══════════════ */
section('scholarship matching');
AI.scholarships.bust();
const m = AI.scholarships.all();
ok('schemes evaluated', m.schemes.length === AI.scholarships.SCHEMES.length, `${m.schemes.length} schemes`);
ok('students matched', m.matched > 0, `${m.matched} matched, ${m.unmatched} unmatched`);
ok('matched + unmatched = roll', m.matched + m.unmatched === DB.students.length);
ok('total value is positive', m.value > 0, `₹${m.value.toLocaleString('en-IN')}`);
ok('every scheme has an authority and amount',
  AI.scholarships.SCHEMES.every(s => s.authority && s.amount > 0 && s.criteria.length));

// eligibility must be exactly "all criteria met"
const sample = DB.students.slice(0, 60);
ok('eligible ⇔ zero failed criteria',
  sample.every(s => AI.scholarships.SCHEMES.every(sc => {
    const r = AI.scholarships.check(s, sc);
    return r.eligible === (r.failed.length === 0);
  })));
ok('met + failed = all criteria',
  sample.every(s => AI.scholarships.SCHEMES.every(sc => {
    const r = AI.scholarships.check(s, sc);
    return r.met.length + r.failed.length === sc.criteria.length;
  })));
ok('near-miss is never simultaneously eligible',
  sample.every(s => AI.scholarships.SCHEMES.every(sc => {
    const r = AI.scholarships.check(s, sc);
    return !(r.eligible && r.nearMiss);
  })));

// hand-built student who must match SC post-matric
const scStudent = {
  id: 'T1', community: 'SC', cls: 'XII', group: 'Commerce', gender: 'Male',
  religion: 'Hindu', income: 120000, attPresent: 90, attTotal: 100,
  firstGraduate: true, cwsn: false, transport: 'Route 1'
};
const scRes = AI.scholarships.check(scStudent, AI.scholarships.SCHEMES.find(x => x.id === 'sc-post-matric'));
ok('SC + XII + low income + 90% attendance → eligible for post-matric', scRes.eligible === true,
  scRes.failed.map(f => f.label).join(', '));

// same student below the attendance bar → near miss, not a hard fail
const lowAtt = { ...scStudent, attPresent: 60, attTotal: 100 };
const lowRes = AI.scholarships.check(lowAtt, AI.scholarships.SCHEMES.find(x => x.id === 'sc-post-matric'));
ok('same student at 60% attendance → near miss, not eligible',
  lowRes.eligible === false && lowRes.nearMiss === true);

// income ceiling must actually bind
const rich = { ...scStudent, income: 900000 };
const richRes = AI.scholarships.check(rich, AI.scholarships.SCHEMES.find(x => x.id === 'sc-post-matric'));
ok('income above the ceiling → not eligible and not a near miss',
  richRes.eligible === false && richRes.nearMiss === false);

// Puthumai Penn is for girls, Tamil Pudhalvan for boys — they must not overlap
const girl = { ...scStudent, gender: 'Female' };
const pp = AI.scholarships.check(girl, AI.scholarships.SCHEMES.find(x => x.id === 'puthumai-penn'));
const tp = AI.scholarships.check(girl, AI.scholarships.SCHEMES.find(x => x.id === 'tamil-pudhalvan'));
ok('girl student matches Puthumai Penn but not Tamil Pudhalvan',
  pp.eligible === true && tp.eligible === false);

ok('per-student value = sum of eligible scheme amounts',
  sample.every(s => {
    const r = AI.scholarships.forStudent(s);
    return r.value === r.eligible.reduce((a, x) => a + x.scheme.amount, 0);
  }));

/* ══════════════ dashboard roll-up ══════════════ */
section('dashboard summary');
const sum = AI.summary();
ok('summary exposes all three engines',
  sum.att && sum.quality && sum.scholarships);
ok('critical ≤ flagged', sum.att.critical <= sum.att.flagged);
ok('summary numbers are finite',
  [sum.att.flagged, sum.att.critical, sum.quality.score, sum.scholarships.value].every(Number.isFinite));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
