#!/usr/bin/env node
/* ============================================================
   samples/schoolx/build.js — spreadsheet → school data file

   A school keeps its roll in a spreadsheet, not in JSON. This turns one
   directory of CSVs — the sheets of that workbook — into the single JSON
   file the importer accepts:

       node samples/schoolx/build.js
       node server/provision.js import samples/schoolx/schoolx.json

   The CSVs are the source of truth and the JSON is a build artefact.
   Edit the sheets, re-run this, re-import. Never hand-edit the JSON: the
   next build overwrites it.

   Two things are DERIVED here rather than typed, because a human keeping
   them in step by hand is a defect waiting to happen:

     • attDays        the working-day list, taken from the date column of
                      the attendance register itself;
     • attPresent /   each child's aggregate, counted from that same
       attTotal       register. The scholarship engine reads the
                      aggregate and the attendance engine reads the
                      day-by-day series; if a clerk could edit one
                      without the other, the eligibility screen and the
                      risk screen would disagree about the same child.

   The build ends by running the real importer's validate(), so a sheet
   that would be refused on import is refused here instead — at the desk,
   not in front of the school.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const importer = require('../../server/importer.js');

const DIR = __dirname;
const OUT = path.join(DIR, 'schoolx.json');

/* ---------- CSV ----------
   Small on purpose. It handles quoted fields and embedded commas, which
   is all a spreadsheet export produces; it is not a general CSV library
   and does not need to be. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

/** Read a sheet as an array of objects keyed by its header row. Blank
 *  lines and rows whose first cell starts with # are skipped, so the
 *  sheets can carry notes for whoever fills them in. */
function sheet(name) {
  const file = path.join(DIR, name);
  if (!fs.existsSync(file)) return [];
  const rows = parseCsv(fs.readFileSync(file, 'utf8'))
    .filter(r => r.some(c => c.trim() !== '') && !r[0].trim().startsWith('#'));
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const o = {};
    head.forEach((h, i) => { o[h] = (r[i] === undefined ? '' : r[i]).trim(); });
    return o;
  });
}

/* ---------- cell coercion ----------
   A spreadsheet has no types: everything arrives as text. These say what
   each column means, so "false", "" and "0" cannot quietly become truthy. */
const num  = v => (v === '' || v == null ? 0 : Number(v));
const bool = v => /^(true|yes|y|1)$/i.test(String(v || '').trim());
const str  = v => String(v == null ? '' : v).trim();

/* ---------- school profile ----------
   Kept as key/value rows rather than one wide row, so the sheet stays
   readable when a school adds its own fields. */
function readSchool() {
  const out = {};
  for (const r of sheet('school.csv')) {
    if (!r.key) continue;
    out[r.key] = r.value;
  }
  if (out.est)             out.est = num(out.est);
  if (out.yearWorkingDays) out.yearWorkingDays = num(out.yearWorkingDays);
  if (out.minAttendance)   out.minAttendance = Number(out.minAttendance);
  if (out.holidays)        out.holidays = out.holidays.split(/\s*;\s*/).filter(Boolean);
  return out;
}

/* ---------- attendance register ----------
   The sheet is the register as a school actually keeps it: one row per
   working day, one column per child, one character per cell.
       P present · A absent · L late (late counts as present)
   Transposed here into the per-child strings the portal stores. */
function readRegister(studentIds) {
  const rows = sheet('attendance.csv');
  if (!rows.length) return { attDays: [], attHistory: {} };

  const attDays = rows.map(r => str(r.date));
  const attHistory = {};
  const unknown = [];

  for (const id of Object.keys(rows[0])) {
    if (id === 'date') continue;
    if (!studentIds.has(id)) { unknown.push(id); continue; }
    attHistory[id] = rows.map(r => (str(r[id]) || 'P').toUpperCase()[0]).join('');
  }
  if (unknown.length) {
    console.log('  note     the register has columns for ' + unknown.join(', ') +
                ', who are not on the roll — ignored.');
  }
  return { attDays, attHistory };
}

/* ---------- build ---------- */
const school = readSchool();

const students = sheet('students.csv').map(r => ({
  id: str(r.id), adm: str(r.adm), emis: str(r.emis), name: str(r.name),
  gender: str(r.gender), cls: str(r.cls), sec: str(r.sec), roll: num(r.roll),
  group: str(r.group), medium: str(r.medium), dob: str(r.dob),
  community: str(r.community), religion: str(r.religion), blood: str(r.blood),
  aadhaar: str(r.aadhaar),
  father: str(r.father), fatherOcc: str(r.fatherOcc), mother: str(r.mother),
  phone: str(r.phone), address: str(r.address), admitted: str(r.admitted),
  rte: bool(r.rte), transport: str(r.transport), hostel: bool(r.hostel),
  feeTotal: num(r.feeTotal), feePaid: num(r.feePaid),
  income: num(r.income), firstGraduate: bool(r.firstGraduate), cwsn: bool(r.cwsn),
  status: str(r.status) || 'Active'
}));

const ids = new Set(students.map(s => s.id));
const { attDays, attHistory } = readRegister(ids);

/* The aggregates the scholarship engine reads, counted from the register
   above so the two can never drift apart. L is late, which is present. */
for (const s of students) {
  const series = attHistory[s.id];
  if (!series) continue;
  s.attTotal = series.length;
  s.attPresent = [...series].filter(c => c !== 'A').length;
}

const staff = sheet('staff.csv').map(r => ({
  id: str(r.id), name: str(r.name), role: str(r.role), subject: str(r.subject),
  cls: str(r.cls), qual: str(r.qual), phone: str(r.phone), joined: str(r.joined)
}));

const accounts = sheet('accounts.csv').map(r => {
  const a = { username: str(r.username), password: str(r.password), name: str(r.name),
              title: str(r.title), role: str(r.role) };
  if (str(r.sid)) a.sid = str(r.sid);
  return a;
});

const marks = {};
for (const r of sheet('marks.csv')) {
  if (!r.sid || !r.term || !r.subject) continue;
  marks[str(r.sid) + '|' + str(r.term) + '|' + str(r.subject)] = num(r.mark);
}

const receipts = sheet('receipts.csv').map(r => ({
  id: str(r.id), no: str(r.no), sid: str(r.sid), name: str(r.name),
  cls: str(r.cls), sec: str(r.sec), date: str(r.date), head: str(r.head),
  mode: str(r.mode), amount: num(r.amount)
}));

const notices = sheet('notices.csv').map(r => ({
  id: str(r.id), date: str(r.date), title: str(r.title),
  body: str(r.body), to: str(r.to), by: str(r.by)
}));

const bundle = {
  _generated: 'Built from the CSVs in samples/schoolx/ by build.js. Do not hand-edit — edit the sheets.',
  school, accounts, students, staff, attDays, attHistory,
  marks, receipts, notices, attendance: {}, applications: []
};

/* ---------- validate before writing ----------
   The same validate() the import route and the CLI both call, so this
   build cannot produce a file the importer would then refuse. */
const report = importer.validate(bundle);

console.log('\n  ' + (school.name || '(unnamed school)'));
console.log('  students ' + report.summary.students +
            ' · staff ' + report.summary.staff +
            ' · accounts ' + report.summary.accounts +
            ' · marks ' + report.summary.marks +
            ' · receipts ' + report.summary.receipts +
            ' · working days ' + report.summary.attendanceDays + '\n');

report.warnings.forEach(w => console.log('  warning  ' + w));

if (!report.ok) {
  report.errors.forEach(e => console.error('  ERROR    ' + e));
  console.error('\n  Refused: ' + report.errors.length + ' error(s). schoolx.json was not written.\n');
  process.exit(1);
}

fs.writeFileSync(OUT, JSON.stringify(bundle, null, 2));
console.log('\n  Wrote samples/schoolx/schoolx.json — ' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB');
console.log('  Import it with:  node server/provision.js import samples/schoolx/schoolx.json\n');
