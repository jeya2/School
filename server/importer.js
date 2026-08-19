/* ============================================================
   server/importer.js — validating a school's data file

   A school hands over one JSON file and an operator loads it through the
   admin screen. That file is the only route data takes into a fresh
   deployment, so this module is the only thing standing between a
   mistyped export and a school running on broken records for a term.

   It reports rather than repairs. Two kinds of finding:

     errors    the import is refused. The data would break the portal:
               missing students array, duplicate ids, an attendance
               string that does not line up with the calendar.
     warnings  the import proceeds and the finding is shown. These are
               the ordinary defects of a real student master — a short
               phone number, a missing Aadhaar — and the data-quality
               engine is built to surface exactly these later.

   The distinction matters: refusing a file because 3% of guardians have
   no second phone number would mean no school could ever onboard.
   ============================================================ */
const { CLASSES, COMMUNITIES, MEDIUMS } = require('../assets/js/domain.js');

const COLLECTIONS = ['students', 'marks', 'receipts', 'notices', 'staff',
                     'attendance', 'attHistory', 'attDays', 'applications'];

const REQUIRED_STUDENT = ['id', 'name', 'cls'];

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

/**
 * Check a bundle and return { ok, errors, warnings, summary, bundle }.
 * `bundle` is the normalised value to import — never the caller's object.
 */
function validate(input) {
  const errors = [];
  const warnings = [];

  if (!isObj(input)) {
    return { ok: false, errors: ['The file is not a JSON object.'], warnings: [], summary: {}, bundle: null };
  }

  /* ---- school profile ---- */
  const school = isObj(input.school) ? { ...input.school } : null;
  if (!school) {
    errors.push('No "school" object. The file must name the school it belongs to.');
  } else {
    if (!school.name) errors.push('school.name is required — it identifies the deployment.');
    if (!school.year) warnings.push('school.year is not set; the portal will show a blank academic year.');
    if (!school.udise) warnings.push('school.udise is not set; UDISE+ returns will need it filled in later.');
    if (school.yearWorkingDays && !(Number(school.yearWorkingDays) > 0)) {
      errors.push('school.yearWorkingDays must be a positive number.');
    }
    if (school.minAttendance && !(Number(school.minAttendance) > 0 && Number(school.minAttendance) <= 1)) {
      errors.push('school.minAttendance must be a fraction between 0 and 1 (0.75 for the 75% rule).');
    }
  }

  /* ---- students ---- */
  const students = Array.isArray(input.students) ? input.students : null;
  if (!students) {
    errors.push('No "students" array.');
  } else if (!students.length) {
    warnings.push('The students array is empty — the portal will open with an empty roll.');
  } else {
    const seen = new Set();
    const missingField = {};
    let badClass = 0, dupes = 0, noAadhaar = 0, shortPhone = 0;

    students.forEach((s, i) => {
      if (!isObj(s)) { errors.push(`students[${i}] is not an object.`); return; }
      for (const f of REQUIRED_STUDENT) if (!s[f]) missingField[f] = (missingField[f] || 0) + 1;
      if (s.id) {
        if (seen.has(s.id)) dupes++;
        seen.add(s.id);
      }
      if (s.cls && !CLASSES.includes(s.cls)) badClass++;
      if (s.community && !COMMUNITIES.includes(s.community)) {
        warnings.push(`students[${i}] has community "${s.community}", which is not one of ${COMMUNITIES.join('/')}.`);
      }
      if (s.medium && !MEDIUMS.includes(s.medium)) {
        warnings.push(`students[${i}] has medium "${s.medium}", which is not one of ${MEDIUMS.join('/')}.`);
      }
      if (!s.aadhaar) noAadhaar++;
      if (s.phone && String(s.phone).replace(/\D/g, '').length < 10) shortPhone++;
    });

    for (const [f, n] of Object.entries(missingField)) {
      errors.push(`${n} student${n === 1 ? '' : 's'} missing "${f}", which the portal cannot render without.`);
    }
    if (dupes) errors.push(`${dupes} duplicate student id${dupes === 1 ? '' : 's'} — every record must be uniquely addressable.`);
    if (badClass) errors.push(`${badClass} student${badClass === 1 ? ' has' : 's have'} a class outside ${CLASSES[0]}–${CLASSES[CLASSES.length - 1]}.`);
    if (noAadhaar) warnings.push(`${noAadhaar} students have no Aadhaar number; the data-quality screen will list them.`);
    if (shortPhone) warnings.push(`${shortPhone} students have a phone number shorter than 10 digits.`);
  }

  /* ---- attendance history against the calendar ---- */
  const attDays = Array.isArray(input.attDays) ? input.attDays : [];
  const attHistory = isObj(input.attHistory) ? input.attHistory : {};
  const histKeys = Object.keys(attHistory);
  if (histKeys.length && !attDays.length) {
    errors.push('attHistory is present but attDays is empty — without the day list the history cannot be read.');
  }
  if (attDays.length && histKeys.length) {
    const wrong = histKeys.filter(k => String(attHistory[k]).length !== attDays.length);
    if (wrong.length) {
      errors.push(`${wrong.length} attendance record${wrong.length === 1 ? ' does' : 's do'} not match attDays ` +
                  `(${attDays.length} days). One P/A/L character is required per working day.`);
    }
    if (students) {
      const ids = new Set(students.map(s => s.id));
      const orphans = histKeys.filter(k => !ids.has(k));
      if (orphans.length) warnings.push(`${orphans.length} attendance records belong to students not in the roll.`);
    }
  }

  /* ---- shapes of the remaining collections ---- */
  for (const c of ['receipts', 'notices', 'staff', 'applications']) {
    if (c in input && !Array.isArray(input[c])) errors.push(`"${c}" must be an array.`);
  }
  for (const c of ['marks', 'attendance']) {
    if (c in input && !isObj(input[c])) errors.push(`"${c}" must be an object keyed by record.`);
  }

  /* ---- accounts ---- */
  const accounts = Array.isArray(input.accounts) ? input.accounts : [];
  accounts.forEach((a, i) => {
    if (!a.username || !a.password || !a.role) {
      errors.push(`accounts[${i}] needs username, password and role.`);
    }
  });
  if (!accounts.length) {
    warnings.push('The file carries no accounts; sign-ins must be created on the Users screen after import.');
  }

  /* ---- normalise ---- */
  const bundle = { school };
  for (const c of COLLECTIONS) {
    if (c in input) bundle[c] = input[c];
    else bundle[c] = ['marks', 'attendance', 'attHistory'].includes(c) ? {} : [];
  }

  const summary = {
    school: school ? school.name : null,
    students: students ? students.length : 0,
    staff: Array.isArray(input.staff) ? input.staff.length : 0,
    receipts: Array.isArray(input.receipts) ? input.receipts.length : 0,
    marks: isObj(input.marks) ? Object.keys(input.marks).length : 0,
    attendanceDays: attDays.length,
    accounts: accounts.length
  };

  return { ok: errors.length === 0, errors, warnings, summary, bundle, accounts };
}

module.exports = { validate, COLLECTIONS };
