/* ============================================================
   ai.js — on-device intelligence layer
   ------------------------------------------------------------
   Three engines, all running entirely in the browser:

     AI.attendance   anomaly detection + 75% eligibility forecasting
     AI.quality      EMIS / UDISE+ data-quality checking
     AI.scholarships eligibility matching against TN & GoI schemes

   Design rules this file holds itself to:

   1. NO CHILD DATA LEAVES THE DEVICE. Every model here is statistical and
      local. Under the DPDP Act 2023 a student is a child until 18, and sending
      identifiable child data to a third-party API without verifiable parental
      consent is the single most expensive mistake a school can make.

   2. EVERY OUTPUT IS EXPLAINABLE. No finding is ever emitted without the
      evidence that produced it. A class teacher who cannot see *why* a child
      was flagged will not act on the flag, and should not be asked to.

   3. THESE ARE FLAGS, NOT DECISIONS. Nothing here fails a student, removes a
      scholarship, or files a return. Every engine hands work to a human.
   ============================================================ */

const AI = {
  VERSION: '1.0',

  /* ══════════════════════════════════════════════════════════
     1 · ATTENDANCE INTELLIGENCE
     Aggregate attendance hides the thing that matters. A child at 68% who is
     drifting downward week by week and a child at 68% who missed one illness
     block are the same number and completely different problems. Only the
     day-level sequence separates them.
     ══════════════════════════════════════════════════════════ */
  attendance: {

    SEV_WEIGHT: { critical: 42, high: 26, medium: 13, low: 5 },

    series(sid) { return [...(DB.attHistory[sid] || '')]; },

    /** Detect patterns in one student's day-by-day record. */
    detect(s, baseline) {
      const m = this.series(s.id);
      const n = m.length;
      const flags = [];
      if (n < 10) return flags;

      const present = c => c !== 'A';
      const rateOf = arr => arr.length ? arr.filter(present).length / arr.length : 0;
      const rate = rateOf(m);

      /* ---- 1. Downward drift ---- */
      const w = Math.max(6, Math.floor(n / 3));
      const early = rateOf(m.slice(0, w));
      const late = rateOf(m.slice(n - w));
      const drop = (early - late) * 100;
      if (drop >= 18) {
        flags.push({
          code: 'DRIFT',
          title: 'Attendance is falling away',
          evidence: `${Math.round(early * 100)}% in the first ${w} working days, ${Math.round(late * 100)}% in the last ${w} — a drop of ${Math.round(drop)} points.`,
          severity: drop >= 35 ? 'critical' : 'high',
          action: 'Call the parents this week. A steady decline is the most common path out of school.'
        });
      }

      /* ---- 2. Currently absent, and staying absent ---- */
      let run = 0;
      for (let i = n - 1; i >= 0 && m[i] === 'A'; i--) run++;
      if (run >= 4) {
        flags.push({
          code: 'ONGOING',
          title: run >= 8 ? 'Has stopped attending' : 'Absent several days running',
          evidence: `Absent for the last ${run} consecutive working days, most recently ${fmtDate(DB.attDays[n - 1])}.`,
          severity: run >= 8 ? 'critical' : 'high',
          action: run >= 8
            ? 'Home visit. Eight or more days without contact is the threshold at which children stop coming back.'
            : 'Telephone the guardian today and record the reason.'
        });
      }

      /* ---- 3. A long block in the past — seasonal migration or illness ---- */
      let best = 0, bestAt = -1, cur = 0;
      for (let i = 0; i < n; i++) {
        if (m[i] === 'A') { cur++; if (cur > best) { best = cur; bestAt = i - cur + 1; } }
        else cur = 0;
      }
      if (best >= 6 && bestAt + best < n - 2) {
        flags.push({
          code: 'BLOCK',
          title: 'Long unbroken absence earlier in the year',
          evidence: `${best} consecutive working days missed from ${fmtDate(DB.attDays[bestAt])}. The child has since returned.`,
          severity: 'medium',
          action: 'Check for seasonal family migration or a health problem, and arrange catch-up teaching for the syllabus missed.'
        });
      }

      /* ---- 4. The same weekday, every week ---- */
      const byDow = {};
      m.forEach((c, i) => {
        const d = new Date(DB.attDays[i] + 'T00:00:00').getDay();
        (byDow[d] = byDow[d] || { a: 0, t: 0 }).t++;
        if (c === 'A') byDow[d].a++;
      });
      const dows = Object.entries(byDow).map(([d, v]) => ({ d: +d, ...v, r: v.t ? v.a / v.t : 0 }));
      const worst = dows.slice().sort((a, b) => b.r - a.r)[0];
      if (worst && worst.a >= 3) {
        const others = dows.filter(x => x.d !== worst.d);
        const otherRate = others.length
          ? others.reduce((a, x) => a + x.a, 0) / Math.max(1, others.reduce((a, x) => a + x.t, 0)) : 0;
        if (worst.r >= .4 && worst.r >= otherRate * 2.2) {
          flags.push({
            code: 'WEEKDAY',
            title: `Absent almost every ${DOW[worst.d]}`,
            evidence: `Missed ${worst.a} of ${worst.t} ${DOW[worst.d]}s (${Math.round(worst.r * 100)}%), against ${Math.round(otherRate * 100)}% on other days.`,
            severity: 'medium',
            action: 'A fixed weekly clash — market day, a sibling to mind, a weekly clinic. Usually solvable once named.'
          });
        }
      }

      /* ---- 5. Scattered single days ---- */
      let isolated = 0;
      for (let i = 1; i < n - 1; i++) if (m[i] === 'A' && m[i - 1] !== 'A' && m[i + 1] !== 'A') isolated++;
      if (isolated >= 7) {
        flags.push({
          code: 'ERRATIC',
          title: 'Irregular, scattered absence',
          evidence: `${isolated} separate one-day absences with no pattern — not illness blocks, not a weekly clash.`,
          severity: 'medium',
          action: 'Usually a motivation or transport issue rather than a family crisis. Worth a conversation with the child.'
        });
      }

      /* ---- 6. Far below the rest of the section ---- */
      if (baseline && rate * 100 < baseline - 20) {
        flags.push({
          code: 'BASELINE',
          title: 'Well below the section',
          evidence: `${Math.round(rate * 100)}% against a ${Math.round(baseline)}% average for ${s.cls}-${s.sec}.`,
          severity: 'low',
          action: 'Compare with classmates from the same locality — it may be a shared transport problem.'
        });
      }

      return flags;
    },

    /** Project whether the child can still reach the 75% public-exam threshold. */
    forecast(s) {
      const elapsed = s.attTotal || WORKING_DAYS.length;
      const remaining = Math.max(0, YEAR_WORKING_DAYS - elapsed);
      const required = Math.ceil(YEAR_WORKING_DAYS * MIN_ATTENDANCE);
      const need = Math.max(0, required - s.attPresent);
      const curRate = elapsed ? s.attPresent / elapsed : 0;
      const reqRate = remaining > 0 ? need / remaining : (need > 0 ? Infinity : 0);
      const projected = (s.attPresent + remaining * curRate) / YEAR_WORKING_DAYS;

      let band, verdict;
      if (need === 0) { band = 'secured'; verdict = 'Already past the 75% requirement for the year.'; }
      else if (reqRate > 1) { band = 'impossible'; verdict = `Cannot reach 75% even with perfect attendance from today — ${need} days needed but only ${remaining} remain. Condonation will be required.`; }
      else if (reqRate > .95) { band = 'critical'; verdict = `Needs ${Math.round(reqRate * 100)}% attendance for every remaining day. Effectively no margin left.`; }
      else if (reqRate > .85) { band = 'at-risk'; verdict = `Needs ${Math.round(reqRate * 100)}% from here — well above the ${Math.round(curRate * 100)}% managed so far.`; }
      else if (reqRate > MIN_ATTENDANCE) { band = 'watch'; verdict = `Needs ${Math.round(reqRate * 100)}% from here. Achievable, but there is no room to slip.`; }
      else { band = 'on-track'; verdict = `On course — ${Math.round(reqRate * 100)}% from here is enough.`; }

      return { elapsed, remaining, required, need, reqRate, curRate, projected, band, verdict };
    },

    /** Full analysis for one student. */
    analyse(s, baseline) {
      const flags = this.detect(s, baseline);
      const forecast = this.forecast(s);
      let risk = flags.reduce((a, f) => a + this.SEV_WEIGHT[f.severity], 0);
      if (forecast.band === 'impossible') risk += 30;
      else if (forecast.band === 'critical') risk += 20;
      else if (forecast.band === 'at-risk') risk += 10;
      risk = Math.min(100, risk);
      return {
        student: s, flags, forecast, risk,
        band: risk >= 60 ? 'critical' : risk >= 35 ? 'high' : risk >= 15 ? 'medium' : 'low'
      };
    },

    /** Analyse every student; cached until the data changes. */
    all() {
      if (this._cache && this._cacheKey === DB.students.length + ':' + Object.keys(DB.attHistory).length)
        return this._cache;

      const baselines = {};
      DB.sections().forEach(({ cls, sec }) => {
        const list = DB.byClass(cls, sec);
        const t = list.reduce((a, s) => a + s.attTotal, 0);
        const p = list.reduce((a, s) => a + s.attPresent, 0);
        baselines[cls + '-' + sec] = t ? p / t * 100 : 0;
      });

      const out = DB.students
        .map(s => this.analyse(s, baselines[s.cls + '-' + s.sec]))
        .filter(r => r.flags.length || r.forecast.band !== 'secured' && r.forecast.band !== 'on-track')
        .sort((a, b) => b.risk - a.risk);

      this._cacheKey = DB.students.length + ':' + Object.keys(DB.attHistory).length;
      return (this._cache = out);
    },

    bust() { this._cache = null; },

    summary() {
      const all = this.all();
      return {
        flagged: all.length,
        critical: all.filter(r => r.band === 'critical').length,
        high: all.filter(r => r.band === 'high').length,
        stopped: all.filter(r => r.flags.some(f => f.code === 'ONGOING' && f.severity === 'critical')).length,
        ineligible: DB.students.filter(s => ['impossible', 'critical'].includes(this.forecast(s).band)).length
      };
    }
  },

  /* ══════════════════════════════════════════════════════════
     2 · EMIS / UDISE+ DATA QUALITY
     Government returns are rejected wholesale for defects that are trivial to
     find beforehand. This runs the checks the upload will run, but early, and
     points at the exact record to fix.
     ══════════════════════════════════════════════════════════ */
  quality: {

    WEIGHT: { blocker: 3, warning: 1, info: .3 },

    /** Cross-record lookups built once per run. */
    context() {
      const nameDob = {}, phone = {}, roll = {}, emis = {};
      DB.students.forEach(s => {
        const k = (s.name || '').toLowerCase().trim() + '|' + s.dob;
        (nameDob[k] = nameDob[k] || []).push(s);
        (phone[s.phone] = phone[s.phone] || []).push(s);
        const rk = `${s.cls}-${s.sec}-${s.roll}`;
        (roll[rk] = roll[rk] || []).push(s);
        (emis[s.emis] = emis[s.emis] || []).push(s);
      });
      return { nameDob, phone, roll, emis };
    },

    RULES: [
      { id: 'aadhaar-missing', severity: 'blocker', field: 'Aadhaar',
        title: 'Aadhaar number not captured',
        why: 'UDISE+ rejects the student record outright, and the child cannot be linked to any scholarship or DBT payment.',
        test: s => !s.aadhaar },

      { id: 'aadhaar-invalid', severity: 'blocker', field: 'Aadhaar',
        title: 'Aadhaar number is not 12 digits',
        why: 'Malformed UID fails validation at upload and silently blocks the whole batch.',
        test: s => !!s.aadhaar && !/^\d{12}$/.test(s.aadhaar) },

      { id: 'emis-duplicate', severity: 'blocker', field: 'EMIS ID',
        title: 'EMIS ID used by more than one student',
        why: 'Duplicate pupil IDs corrupt enrolment counts and can cause a genuine child to be struck off.',
        test: (s, c) => (c.emis[s.emis] || []).length > 1 },

      { id: 'phone-invalid', severity: 'blocker', field: 'Contact',
        title: 'Contact number is not a valid Indian mobile',
        why: 'Absentee SMS, fee reminders and emergency contact all fail silently.',
        test: s => !/^[6-9]\d{9}$/.test(String(s.phone || '')) },

      { id: 'dob-missing', severity: 'blocker', field: 'Date of Birth',
        title: 'Date of birth missing',
        why: 'Age is a mandatory UDISE+ field and determines RTE entitlement.',
        test: s => !s.dob },

      { id: 'community-missing', severity: 'blocker', field: 'Community',
        title: 'Community not recorded',
        why: 'Blocks the community-wise return and every welfare scholarship claim.',
        test: s => !s.community },

      { id: 'duplicate-enrolment', severity: 'blocker', field: 'Identity',
        title: 'Possible duplicate enrolment',
        why: 'Same name and date of birth on two records — inflates enrolment and invites an audit finding.',
        test: (s, c) => (c.nameDob[(s.name || '').toLowerCase().trim() + '|' + s.dob] || []).length > 1 },

      { id: 'roll-duplicate', severity: 'blocker', field: 'Roll No.',
        title: 'Roll number repeated in the same section',
        why: 'Breaks attendance registers and mark entry, which are both keyed on roll number.',
        test: (s, c) => (c.roll[`${s.cls}-${s.sec}-${s.roll}`] || []).length > 1 },

      { id: 'group-missing', severity: 'blocker', field: 'Group',
        title: 'No group chosen for Std XI / XII',
        why: 'Public exam registration cannot be filed without the subject group.',
        test: s => ['XI', 'XII'].includes(s.cls) && !s.group },

      { id: 'age-class-mismatch', severity: 'warning', field: 'Age',
        title: 'Age far outside the norm for the standard',
        why: 'Usually a mistyped year of birth; occasionally a genuine late admission needing a remark.',
        test: s => {
          if (!s.dob) return false;
          const expected = 6 + CLASSES.indexOf(s.cls);
          const a = age(s.dob);
          return typeof a === 'number' && Math.abs(a - expected) > 2;
        },
        detail: s => `Age ${age(s.dob)} in Std ${s.cls} (typical ${6 + CLASSES.indexOf(s.cls)}).` },

      { id: 'phone-shared', severity: 'warning', field: 'Contact',
        title: 'One mobile number shared by three or more students',
        why: 'Two is normal for siblings. Three or more usually means a clerk reused a number.',
        test: (s, c) => (c.phone[s.phone] || []).length >= 3 },

      { id: 'rte-fee-conflict', severity: 'warning', field: 'Fees',
        title: 'RTE student carrying a fee demand',
        why: 'RTE 25% children must not be billed. A live demand against them is an audit finding.',
        test: s => s.rte && s.feeTotal > 0 },

      { id: 'income-missing', severity: 'warning', field: 'Income',
        title: 'Family income not recorded',
        why: 'Every welfare scholarship is income-tested. Without it the child cannot be put forward.',
        test: s => !s.income },

      { id: 'guardian-missing', severity: 'warning', field: 'Guardian',
        title: 'Father or mother name missing',
        why: 'Required on the TC, the public exam nominal roll and every certificate.',
        test: s => !s.father || !s.mother },

      { id: 'address-missing', severity: 'warning', field: 'Address',
        title: 'Address missing',
        why: 'Needed for transport planning, home visits and the nativity certificate.',
        test: s => !s.address },

      { id: 'group-on-lower-class', severity: 'info', field: 'Group',
        title: 'Subject group set below Std XI',
        why: 'Groups only exist at higher secondary. Harmless, but it pollutes the return.',
        test: s => !!s.group && !['XI', 'XII'].includes(s.cls) },

      { id: 'blood-missing', severity: 'info', field: 'Blood Group',
        title: 'Blood group not recorded',
        why: 'Not required by UDISE+, but the school needs it in a medical emergency.',
        test: s => !s.blood || s.blood === '—' }
    ],

    run() {
      const c = this.context();
      const findings = this.RULES
        .map(rule => {
          const hits = DB.students.filter(s => { try { return rule.test(s, c); } catch { return false; } });
          return { ...rule, hits, count: hits.length };
        })
        .filter(f => f.count > 0)
        .sort((a, b) => this.WEIGHT[b.severity] * b.count - this.WEIGHT[a.severity] * a.count);

      const penalty = findings.reduce((a, f) => a + f.count * this.WEIGHT[f.severity], 0);
      const worst = DB.students.length * this.RULES.reduce((a, r) => a + this.WEIGHT[r.severity], 0);
      const score = worst ? Math.max(0, Math.round(100 * (1 - penalty / worst))) : 100;

      const affected = new Set();
      findings.forEach(f => f.hits.forEach(s => affected.add(s.id)));

      return {
        findings, score,
        blockers: findings.filter(f => f.severity === 'blocker').reduce((a, f) => a + f.count, 0),
        warnings: findings.filter(f => f.severity === 'warning').reduce((a, f) => a + f.count, 0),
        infos: findings.filter(f => f.severity === 'info').reduce((a, f) => a + f.count, 0),
        affected: affected.size,
        clean: DB.students.length - affected.size,
        total: DB.students.length,
        uploadReady: findings.every(f => f.severity !== 'blocker')
      };
    }
  },

  /* ══════════════════════════════════════════════════════════
     3 · SCHOLARSHIP ELIGIBILITY MATCHING
     Money that families are entitled to and routinely never claim, because
     nobody in the office has time to cross-check 1,800 records against a
     dozen schemes with different income ceilings.

     Indicative annual values — the office must confirm the current year's
     figures against the department circular before any claim is filed.
     ══════════════════════════════════════════════════════════ */
  scholarships: {

    avgMark(s) {
      const subs = subjectsFor(s.cls, s.group);
      const got = subs.map(x => DB.marks[`${s.id}|Quarterly|${x}`]).filter(v => v !== undefined);
      return got.length ? got.reduce((a, b) => a + b, 0) / got.length : null;
    },
    attPct(s) { return s.attTotal ? s.attPresent / s.attTotal * 100 : 0; },
    inClass(s, list) { return list.includes(s.cls); },

    SCHEMES: [
      {
        id: 'sc-post-matric', name: 'Post-Matric Scholarship (SC / ST)',
        tamil: 'பிற்பட்ட வகுப்பு உதவித்தொகை', authority: 'Adi Dravidar & Tribal Welfare Dept., Govt. of Tamil Nadu',
        amount: 12000,
        criteria: [
          { label: 'Community is SC or ST', test: s => ['SC', 'ST'].includes(s.community) },
          { label: 'Studying in Std XI or XII', test: s => ['XI', 'XII'].includes(s.cls) },
          { label: 'Family income at or below ₹2,50,000', test: s => s.income > 0 && s.income <= 250000 },
          { label: 'Attendance at least 75%', test: s => AI.scholarships.attPct(s) >= 75, attendance: true }
        ]
      },
      {
        id: 'sc-pre-matric', name: 'Pre-Matric Scholarship (SC / ST)',
        authority: 'Adi Dravidar & Tribal Welfare Dept., Govt. of Tamil Nadu',
        amount: 5000,
        criteria: [
          { label: 'Community is SC or ST', test: s => ['SC', 'ST'].includes(s.community) },
          { label: 'Studying in Std IX or X', test: s => ['IX', 'X'].includes(s.cls) },
          { label: 'Family income at or below ₹2,50,000', test: s => s.income > 0 && s.income <= 250000 },
          { label: 'Attendance at least 75%', test: s => AI.scholarships.attPct(s) >= 75, attendance: true }
        ]
      },
      {
        id: 'bc-mbc', name: 'BC / MBC / DNC Scholarship',
        authority: 'Backward Classes Welfare Dept., Govt. of Tamil Nadu',
        amount: 8000,
        criteria: [
          { label: 'Community is BC, BCM or MBC', test: s => ['BC', 'BCM', 'MBC'].includes(s.community) },
          { label: 'Studying in Std XI or XII', test: s => ['XI', 'XII'].includes(s.cls) },
          { label: 'Family income at or below ₹2,00,000', test: s => s.income > 0 && s.income <= 200000 },
          { label: 'Attendance at least 75%', test: s => AI.scholarships.attPct(s) >= 75, attendance: true }
        ]
      },
      {
        id: 'minority-pre-matric', name: 'Pre-Matric Minority Scholarship',
        authority: 'Minorities Welfare Dept. / Ministry of Minority Affairs',
        amount: 6000,
        criteria: [
          { label: 'Belongs to a notified minority community', test: s => ['Christian', 'Muslim', 'Others'].includes(s.religion) },
          { label: 'Studying between Std I and Std X', test: s => CLASSES.indexOf(s.cls) <= 9 },
          { label: 'Family income at or below ₹1,00,000', test: s => s.income > 0 && s.income <= 100000 },
          { label: 'Attendance at least 75%', test: s => AI.scholarships.attPct(s) >= 75, attendance: true }
        ]
      },
      {
        id: 'puthumai-penn', name: 'Moovalur Ramamirtham — Puthumai Penn Thittam',
        tamil: 'புதுமைப் பெண் திட்டம்', authority: 'Govt. of Tamil Nadu',
        amount: 12000, note: '₹1,000 per month on progression to higher education.',
        criteria: [
          { label: 'Girl student', test: s => s.gender === 'Female' },
          { label: 'Studying in Std XI or XII', test: s => ['XI', 'XII'].includes(s.cls) },
          { label: 'Studied Std VI–XII in a government or aided school', test: () => true },
          { label: 'Attendance at least 75%', test: s => AI.scholarships.attPct(s) >= 75, attendance: true }
        ]
      },
      {
        id: 'tamil-pudhalvan', name: 'Tamil Pudhalvan Thittam',
        tamil: 'தமிழ்ப் புதல்வன் திட்டம்', authority: 'Govt. of Tamil Nadu',
        amount: 12000, note: '₹1,000 per month on progression to higher education.',
        criteria: [
          { label: 'Boy student', test: s => s.gender === 'Male' },
          { label: 'Studying in Std XI or XII', test: s => ['XI', 'XII'].includes(s.cls) },
          { label: 'Studied Std VI–XII in a government or aided school', test: () => true },
          { label: 'Attendance at least 75%', test: s => AI.scholarships.attPct(s) >= 75, attendance: true }
        ]
      },
      {
        id: 'first-graduate', name: 'First Graduate Fee Concession',
        authority: 'Directorate of School Education, Govt. of Tamil Nadu',
        amount: 25000,
        criteria: [
          { label: 'First generation learner in the family', test: s => !!s.firstGraduate },
          { label: 'Studying in Std XI or XII', test: s => ['XI', 'XII'].includes(s.cls) },
          { label: 'Family income at or below ₹2,50,000', test: s => s.income > 0 && s.income <= 250000 }
        ]
      },
      {
        id: 'merit-cum-means', name: 'Merit-cum-Means Scholarship',
        authority: 'Directorate of School Education, Govt. of Tamil Nadu',
        amount: 10000,
        criteria: [
          { label: 'Quarterly average at or above 75%', test: s => (AI.scholarships.avgMark(s) ?? 0) >= 75 },
          { label: 'Studying between Std IX and Std XII', test: s => CLASSES.indexOf(s.cls) >= 8 },
          { label: 'Family income at or below ₹2,50,000', test: s => s.income > 0 && s.income <= 250000 },
          { label: 'Attendance at least 75%', test: s => AI.scholarships.attPct(s) >= 75, attendance: true }
        ]
      },
      {
        id: 'cwsn', name: 'Scholarship for Children with Special Needs',
        authority: 'Samagra Shiksha, Govt. of Tamil Nadu',
        amount: 6000,
        criteria: [
          { label: 'Identified as a child with special needs', test: s => !!s.cwsn }
        ]
      },
      {
        id: 'bus-pass', name: 'Free Bus Pass',
        authority: 'Tamil Nadu State Transport Corporation',
        amount: 6000,
        criteria: [
          { label: 'Travels to school by bus', test: s => !!s.transport },
          { label: 'Studying in Std VI or above', test: s => CLASSES.indexOf(s.cls) >= 5 }
        ]
      }
    ],

    /** Match one student against one scheme, keeping the reasoning. */
    check(s, scheme) {
      const met = [], failed = [];
      scheme.criteria.forEach(c => {
        let ok = false;
        try { ok = !!c.test(s); } catch { ok = false; }
        (ok ? met : failed).push(c);
      });
      return {
        scheme, met, failed,
        eligible: failed.length === 0,
        // fails on attendance alone — recoverable, and the reason we link this
        // engine to the attendance forecaster
        nearMiss: failed.length > 0 && failed.every(c => c.attendance)
      };
    },

    /** All schemes for one student. */
    forStudent(s) {
      const all = this.SCHEMES.map(sc => this.check(s, sc));
      return {
        eligible: all.filter(r => r.eligible),
        nearMiss: all.filter(r => r.nearMiss),
        value: all.filter(r => r.eligible).reduce((a, r) => a + r.scheme.amount, 0),
        recoverable: all.filter(r => r.nearMiss).reduce((a, r) => a + r.scheme.amount, 0)
      };
    },

    /** Whole-school roll-up, cached. */
    all() {
      if (this._cache && this._cacheKey === DB.students.length) return this._cache;
      const bySchemeId = {};
      this.SCHEMES.forEach(sc => bySchemeId[sc.id] = { scheme: sc, eligible: [], nearMiss: [] });
      let value = 0, recoverable = 0;
      const perStudent = {};

      DB.students.forEach(s => {
        const r = this.forStudent(s);
        perStudent[s.id] = r;
        value += r.value;
        recoverable += r.recoverable;
        r.eligible.forEach(x => bySchemeId[x.scheme.id].eligible.push(s));
        r.nearMiss.forEach(x => bySchemeId[x.scheme.id].nearMiss.push(s));
      });

      this._cacheKey = DB.students.length;
      return (this._cache = {
        schemes: Object.values(bySchemeId).sort((a, b) =>
          b.eligible.length * b.scheme.amount - a.eligible.length * a.scheme.amount),
        perStudent, value, recoverable,
        matched: Object.values(perStudent).filter(r => r.eligible.length).length,
        unmatched: Object.values(perStudent).filter(r => !r.eligible.length).length
      });
    },

    bust() { this._cache = null; }
  },

  /* ---------- dashboard roll-up ---------- */
  summary() {
    const att = this.attendance.summary();
    const q = this.quality.run();
    const sch = this.scholarships.all();
    return { att, quality: q, scholarships: sch };
  },

  bust() { this.attendance.bust(); this.scholarships.bust(); }
};
