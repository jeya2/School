# New Gen Higher Secondary School — Student Management Portal

A demonstration student-management application for a Tamil Nadu higher secondary
school, built around one distinguishing idea: **every form can be filled by voice,
side by side with the keyboard.**

Hypothetical school: **NEW GEN HIGHER SECONDARY SCHOOL**, Perundurai Road, Erode –
638 011. Tamil Nadu State Board, Std I–XII, Tamil and English medium.

---

## Running it

No build step and no dependencies — but **serve it over `http://localhost`, do not
double-click `index.html`.** Chrome refuses microphone access on a `file://` origin,
so the voice engine cannot start there. A zero-dependency server is included:

```
node serve.js            # → http://localhost:5490
node serve.js 8080       # if that port is taken
```

Then open **http://localhost:5490** in **Chrome or Edge** — they are the browsers
that ship the Web Speech API. Allow microphone access when prompted.

Everything except voice works fine from `file://` if you would rather just
double-click, and in Firefox or Safari the dock automatically becomes a typed
command console driving the *identical* parser — so no feature is unreachable, you
just type what you would have said.

All data lives in `localStorage`; nothing leaves the machine.

### Signing in

Pick any role on the login screen — the user ID is prefilled and **any password
works**. The role you choose changes the navigation and the dashboard:

| Role | Sees |
|---|---|
| Admin / Principal | Everything |
| Teacher | Students, attendance, mark entry, report cards, circulars |
| Accountant | Students, fee collection, dues |
| Parent / Student | Own record: attendance, marks, fees, circulars |

---

## 🎙 Voice data entry

The feature the application is built around. Open **New Admission** and press
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>.

### Two modes

**Guided** — the form reads each question aloud, highlights the field, and waits.
You answer; it fills, confirms, and moves to the next one. This is the "look at the
screen and answer orally" flow.

**Free** — say the field name and the value together, in any order, at any time:

```
"student name Karthik Raja"
"date of birth twelfth March two thousand ten"
"father name Murugesan"
"community M B C"
"standard ten"
"phone nine eight four three zero four five six seven eight"
"save"
```

### What it understands

| Kind | Spoken | Stored |
|---|---|---|
| Names | "karthik raja" | `Karthik Raja` |
| Dates | "twelfth March two thousand ten", "12 03 2010", "twenty-fifth June two thousand nine" | `2010-03-12` |
| Numbers | "eighty seven", "nine hundred fifty", "one lakh fifty thousand" | `87`, `950`, `150000` |
| Digit strings | "nine eight four three **double one** two three" | `98431123` |
| Classes | "ten", "plus two", "eighth" | `X`, `XII`, `VIII` |
| Blood groups | "o positive", "a b positive" | `O+`, `AB+` |
| Communities | "mbc", "m b c" | `MBC` |
| Yes/No | "yes", "no", "correct" | checkbox / dropdown |
| Spelling | "spell K A R T H I K" | `Karthik` |

Field targeting is fuzzy — `data-v` on each input lists the aliases a school clerk
would actually use ("father name", "fathers name", "guardian name"), and the matcher
scores the utterance against all of them.

### Commands

```
next · back · skip · repeat · read back      move around the form
clear · undo                                 fix mistakes
save · cancel                                finish
go to attendance · open fees · show students navigate
stop listening                               (or Ctrl+Shift+M)
help                                         full reference
```

### Module-specific voice

**Attendance** — voice roll call. The engine reads each name aloud; say
`present` / `absent` / `late` to mark and advance. Jump with
`"roll twelve absent"`. Start from a full class with `"mark all present"` and
correct the exceptions.

**Mark entry** — say just the score (`"eighty seven"`) for the highlighted
student and the cursor advances by itself. Jump with `"roll five ninety two"`.
Say `"absent"` to record a zero.

**Fee collection** and **new circular** are voice-enabled forms inside modals.

### Language

English (`en-IN`) and Tamil (`ta-IN`), switchable from the dock or Settings without
leaving the page. Tamil aliases (`data-v-ta`) are attached to the admission fields,
and the common Tamil commands are recognised (அடுத்து, சேமி, அழி, நிறுத்து…).

### Shortcuts

| Key | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> | Guided voice entry on the open form |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> | Toggle the microphone |

---

---

## 🧠 Intelligence layer

Three engines, all running **entirely in your browser**. No student data is sent
anywhere — which is not a nicety but a legal requirement: under India's DPDP Act
2023 every student here is a child, and sending identifiable child data to a
third-party API without verifiable parental consent is the most expensive mistake
a school can make.

They appear as a glowing **AI band** at the top of the dashboard, with a blinking
beacon on anything needing action today.

### 1 · Attendance Alerts — `#insights`

Aggregate attendance hides what matters. A child at 68% who is drifting down week
by week and a child at 68% who missed one illness block are the same number and
completely different problems. This reads each student's **day-by-day** record and
names the pattern:

| Detector | What it finds |
|---|---|
| **Drift** | Attendance falling away — first third vs last third of the year |
| **Ongoing** | Currently absent and staying absent; 8+ days = "has stopped attending" |
| **Block** | A long unbroken absence earlier in the year — seasonal migration or illness |
| **Weekday** | Absent almost every Friday (market day, a sibling to mind, a weekly clinic) |
| **Erratic** | Scattered single days with no pattern |
| **Baseline** | Far below the rest of the section |

Alongside it, a **75% eligibility forecast**: given days elapsed, days remaining and
the 165-day threshold, what attendance rate is needed from today — and is that
still possible at all. Each student shows their full year as a colour strip, the
evidence behind every flag, and a suggested action.

### 2 · Data Quality — `#dataquality`

Government returns get rejected wholesale for defects that are trivial to find
beforehand. This runs 17 checks the UDISE+ upload will run — but now, across every
record — and points at the exact student to fix. Missing or malformed Aadhaar,
invalid mobile numbers, duplicate enrolments, repeated roll numbers, age/class
mismatches, missing group for Std XI–XII, RTE children wrongly carrying a fee
demand, and more. Produces a **data-health score**, an upload-ready verdict, and an
exportable correction worklist.

### 3 · Scholarship Match — `#scholarships`

Money families are entitled to and routinely never claim, because nobody has time
to cross-check 390 records against 10 schemes with different income ceilings, class
ranges and attendance conditions. Covers SC/ST pre- and post-matric, BC/MBC/DNC,
minority pre-matric, Puthumai Penn, Tamil Pudhalvan, first-graduate, merit-cum-means,
CWSN and free bus pass.

Every match shows **which criteria passed and which failed**, so the office can
disagree with it. Schemes a student fails *only* on attendance are surfaced
separately as recoverable — and link straight back to the attendance forecast.

> **These are flags, not decisions.** Nothing here fails a student, cancels an
> entitlement, or files a return. Amounts are indicative; confirm against the
> department circular before filing a claim.

Parents and students do not see any of these screens — risk scores about a child
belong with the staff responsible for them.

---

## What is built

**Public site** (`index.html`) — hero, about, academics by level, voice showcase,
admissions with timeline and fee structure, board results and toppers, campus
gallery, notice board, contact, and a role-picker login.

**Portal** (`app.html`)

| Module | Contents |
|---|---|
| Dashboard | Role-aware KPIs, the AI intelligence band, enrolment by standard, community mix, recent receipts, notices |
| 🧠 Attendance Alerts | Day-level pattern detection + 75% eligibility forecasting |
| 🩺 Data Quality | 17 EMIS/UDISE+ pre-upload checks with a health score |
| 🎁 Scholarship Match | 10 TN & GoI schemes matched with full reasoning |
| Student Master | ~370 seeded students, filter by class/section/medium/community, search, CSV export |
| Student Profile | Personal & family, academics, fees, attendance — with certificate generation |
| New Admission | The 22-field voice-enabled admission form |
| Attendance | Daily roll call with voice, absentee SMS queue, register save |
| Mark Entry | Class × exam × subject grid with voice scoring, live average and fail count |
| Report Cards | Printable progress report with grades, class rank and attendance |
| Fee Collection | Monthly collection chart, receipt register, voice-enabled collection modal |
| Fee Dues | Defaulter list with balances and reminder dispatch |
| Staff | Teaching and non-teaching register, pupil–teacher ratio |
| Circulars | Notice board with voice-dictated new circulars |
| Reports & Govt. | EMIS/UDISE+ style community and medium returns, downloadable statutory registers |
| Settings | Theme, voice language, TTS toggle, school profile, demo data reset |

Tamil Nadu specifics are modelled throughout: EMIS and UDISE pupil IDs, community
categories (OC/BC/BCM/MBC/SC/ST), RTE 25% seats, Std XI–XII group choice, quarterly
/ half-yearly / annual exam terms, noon meal beneficiaries, free supply registers
and public-exam attendance eligibility at 75%.

---

## Layout

```
index.html                  public site + login
app.html                    portal shell
serve.js                    zero-dependency static server (node serve.js)
assets/
  css/
    base.css                design tokens, reset, components, dark theme
    site.css                landing page
    app.css                 portal shell, dashboards, tables
    voice.css               voice dock and in-form affordances
    ai.css                  AI visual language — aurora band, beacons, gauges
  js/
    core.js                 storage, seed data, formatters, toasts, theme
    voice.js                the voice engine
    ai.js                   the three intelligence engines
    app.js                  router and every module view
tests/
  voice-parser.test.js      spoken-value parsers
  ai.test.js                attendance / data-quality / scholarship engines
```

## Tests

```
node tests/voice-parser.test.js     # 35 assertions
node tests/ai.test.js               # 63 assertions
```

No dependencies. The voice suite covers number words, digit strings, date forms,
spoken dropdown options and name casing. The AI suite covers seed integrity (including
student-id uniqueness), every anomaly detector, forecast boundaries, each data-quality
rule against hand-built valid and invalid records, and scholarship eligibility including
income ceilings and near-miss classification.

---

## Notes and limits

- **Demo data.** Everything is generated deterministically on first load and stored
  in `localStorage`. *Settings → Reset demo data* restores it.
- **Recognition accuracy** depends on the browser's cloud speech service, the
  microphone and the accent. Indian-English names are the hard case; the spelling
  mode (`"spell ..."`) is the escape hatch, and every field still accepts typing.
- Tamil recognition quality varies more than English; the engine accepts Tamil field
  aliases and commands, but Tamil dictation of proper nouns is the weakest path.
- SMS, payment gateway, EMIS upload and file downloads are simulated — they raise a
  toast rather than calling a real service.
- This is a demonstration build, not a production deployment: no backend, no
  authentication, no audit trail, no encryption.
