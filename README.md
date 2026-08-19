# School Management Portal

A database-driven student management system for schools, built to be deployed
once per school. The application ships with no school in it: a school hands over
its data in a single JSON file, an administrator loads that file through the
admin UI, and the deployment becomes that school's portal — its name, its roll,
its staff, its accounts.

Modelled on Tamil Nadu state-board practice throughout: EMIS and UDISE pupil IDs,
community categories (OC/BC/BCM/MBC/SC/ST), RTE 25% seats, Std XI–XII group
choice, quarterly / half-yearly / annual terms, and public-exam eligibility at
75% attendance.

The part that earns its keep is the [intelligence layer](#-intelligence-layer):
three rule-based engines that read a school's own records and surface the
children at risk of losing exam eligibility, the records that will get a
government return rejected, and the scholarship money families are entitled to
and never claim. All three run in the browser, over data that never leaves it.

---

## One deployment, one school

There is no tenant column anywhere in the schema, deliberately. Each school gets
its own deployment and its own database, so a query can never cross from one
school's children to another's, and a school's data can be handed back or
destroyed by deleting one database.

```
   school's JSON file  ──▶  admin UI (or CLI)  ──▶  one deployment  ──▶  that school's portal
```

---

## Running it locally

```bash
npm install                                              # server dependencies only
node server/provision.js admin admin my-password         # create the first account
node server/provision.js demo                            # optional: load the sample school
node serve.js                                            # → http://localhost:5490
```

Sign in with the account you just created. Without `provision.js demo` the portal
opens empty and takes you straight to **School Data**, where you load a school.

The browser half has no build step, no bundler and no dependencies. Only the
server needs npm.

### Commands

```bash
node serve.js                     # port 5490
node serve.js 8080                # any other port
npm test                          # both suites
node tests/ai.test.js             # the three intelligence engines, no server needed
node tests/server.test.js         # sessions, roles, provisioning, persistence
node server/provision.js status   # what this instance currently holds
```

---

## Provisioning a school

### The data file

One JSON object holding the school profile, its roll, staff, marks, receipts,
attendance and the accounts it signs in with.
[`samples/school-template.json`](samples/school-template.json) is a complete,
commented, valid example — keys beginning with `_` are ignored, so the notes can
stay in the file.

A full backup taken from **Settings → Full backup** has exactly this shape, which
is what makes a backup enough to re-create a school on a new deployment.

| Key | Required | Notes |
|---|---|---|
| `school` | yes | `name` is required. `yearStart`, `yearWorkingDays`, `minAttendance` drive the eligibility forecast |
| `students` | yes | `id`, `name`, `cls` required; ids must be unique |
| `accounts` | no | Sign-ins created at import; existing usernames are never overwritten |
| `attDays` + `attHistory` | no | One `P`/`A`/`L` character per working day, per student — lengths must match |
| `marks` | no | Keyed `studentId\|term\|subject` |
| `staff`, `receipts`, `notices`, `applications` | no | Arrays |

### Loading it

Through the admin UI — **School Data** in the sidebar, admin only:

1. Choose the file. It is validated before anything is written.
2. Read the report: a summary of what the file contains, errors that refuse the
   import, and warnings that do not.
3. Confirm. The import replaces the school profile and every record in one
   transaction — a failed import never leaves half a school behind.

Or from the command line, which is the same code path:

```bash
node server/provision.js import path/to/school.json
```

### Errors and warnings

The importer reports rather than repairs, and the distinction is deliberate.
**Errors** are things that would break the portal — a missing `students` array,
duplicate ids, an attendance string that does not line up with the calendar — and
they refuse the import outright. **Warnings** are the ordinary defects of a real
student master, such as a missing Aadhaar or a nine-digit phone number; those
import fine and then show up in Data Quality, which is exactly where a school
should be working through them. Refusing a file because 3% of guardians have no
second phone number would mean no school could ever onboard.

---

## Deploying

The same image serves any school; only the database differs.

### Docker

```bash
docker build -t school-portal .
docker run -p 5490:5490 \
  -e DATABASE_URL=postgres://user:pass@host:5432/schooldb \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD=a-strong-password \
  school-portal
```

`ADMIN_USERNAME` / `ADMIN_PASSWORD` only take effect on an instance with no
accounts at all, so they cannot overwrite a password someone has already changed.
They exist for platforms where running a one-off command is awkward.

### Choosing a database

**Postgres for anything cloud-hosted.** Set `DATABASE_URL` (or `PG_CONNECTION`)
and the Postgres adapter is selected at startup — no code change. Migrations are
idempotent and applied automatically on boot; run them by hand with
`node server/migrate.js` if you prefer.

**SQLite for a single on-premise server with a real disk.** The default. One file
per school under `data/`, chosen with `SCHOOL_DB`. Note that on most cloud
platforms the container filesystem is ephemeral: an SQLite file there disappears
on the next restart, taking the school with it. Mount a volume or use Postgres.

`better-sqlite3` is an *optional* dependency, because it is a native addon that
ships prebuilt binaries only for some Node ABIs. If it cannot install or load,
`npm install` still succeeds, the server still starts and serves the site, and
the data endpoints answer `503 no_database` rather than crashing.

### Environment

See [`.env.example`](.env.example) for the full list. `serve.js` reads `.env` at
startup without overriding anything already set in the real environment.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Use Postgres. Unset means SQLite |
| `SCHOOL_DB` | SQLite filename under `data/` |
| `PORT` / `HOST` | When `PORT` is set the server binds `0.0.0.0`; otherwise loopback |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | First-boot administrator, only on an instance with no accounts |
| `SESSION_DAYS` | How long a sign-in lasts. Default 7 |
| `MAX_UPLOAD_MB` | Largest school file accepted. Default 25 |

---

## Accounts and access

Every account lives in the database with a scrypt-hashed password and a per-user
salt. Sessions are opaque random tokens held server-side; the browser only ever
receives an HttpOnly cookie.

| Role | Sees | Can change |
|---|---|---|
| `admin` | Everything | Everything, including school data and accounts |
| `principal` | Everything except accounts | School records |
| `teacher` | Their teaching screens, attendance, marks, intelligence | School records |
| `accountant` | Fees, dues, scholarships | Fee records |
| `parent` / `student` | One child's record | Nothing |

**Roles are enforced on the server.** The sidebar hiding a screen is a
convenience; the API refuses the request regardless. `tests/server.test.js`
asserts this directly — a teacher cannot list accounts or import a school, and a
parent cannot write at all.

Accounts are managed on **School Data → Accounts**. Anyone can change their own
password in Settings; an administrator can change anyone's.


## 🧠 Intelligence layer

Three engines, all running **entirely in the browser**, over the school data already loaded there.
No student data is sent anywhere — which is not a nicety but a legal requirement: under India's DPDP Act
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
to cross-check every record against 10 schemes with different income ceilings, class
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

---

## What is built

**Public site** (`index.html`) — landing page, about, academics by level,
admissions with timeline and fee structure, results, notice board, contact, and
the sign-in. School identity on this page is filled from the loaded profile.

**Portal** (`app.html`)

| Module | Contents |
|---|---|
| Dashboard | Role-aware KPIs, the AI intelligence band, enrolment by standard, community mix, recent receipts, notices |
| 🧠 Attendance Alerts | Day-level pattern detection + 75% eligibility forecasting |
| 🩺 Data Quality | 17 EMIS/UDISE+ pre-upload checks with a health score |
| 🎁 Scholarship Match | 10 TN & GoI schemes matched with full reasoning |
| Student Master | The school's roll — filter by class/section/medium/community, search, CSV export |
| Student Profile | Personal & family, academics, fees, attendance — with certificate generation |
| New Admission | 21-field admission form |
| Attendance | Daily roll call, status filter, absentee SMS queue, register save |
| Mark Entry | Class × exam × subject grid, live average and fail count |
| Report Cards | Printable progress report with grades, class rank and attendance |
| Fee Collection | Monthly collection chart, receipt register, collection form |
| Fee Dues | Defaulter list with balances and reminder dispatch |
| Staff | Teaching and non-teaching register, pupil–teacher ratio |
| Circulars | Notice board |
| Reports & Govt. | EMIS/UDISE+ style community and medium returns, downloadable statutory registers |
| School Data | Import a school file, manage accounts, clear the deployment (admin only) |
| Settings | Theme, school profile, your password, full backup |

---

## Layout

```
index.html                  public site + sign-in
app.html                    portal shell
serve.js                    static server + the /api surface
Dockerfile                  one image, any school
migrations/
  001_init.sql              the whole schema; idempotent
samples/
  school-template.json      a complete, valid, commented school file
server/                     never served over HTTP (see PRIVATE in serve.js)
  db.js                     SQLite adapter
  db_pg.js                  Postgres adapter — same contract, documented in db.js
  auth.js                   scrypt password hashing, sessions, role helpers
  importer.js               validates a school file: errors refuse, warnings inform
  demo.js                   the sample school generator
  provision.js              CLI: create an admin, import a file, load the demo
  migrate.js                applies migrations/ to Postgres
assets/
  css/
    base.css                design tokens, reset, components, dark theme
    site.css                landing page
    app.css                 portal shell, dashboards, tables
    ai.css                  AI visual language — aurora band, beacons, gauges
  js/
    domain.js               TN domain model + calendar. Loaded by browser AND Node
    core.js                 session, API helper, storage, formatters, DB facade
    ai.js                   the three on-device intelligence engines
    app.js                  router and every module view
tests/
  ai.test.js                the intelligence engines
  server.test.js            sessions, roles, provisioning, persistence
data/                       SQLite files. Gitignored, and never served
```

`assets/js/domain.js` is loaded twice on purpose — as a plain `<script>` in the
browser, and via `require()` in Node for the demo generator, the importer and the
tests. It is the one file both halves share, so nothing in it may touch the DOM,
`localStorage`, `fetch` or the filesystem.

---

## Architecture

**The database is the single source of truth.** The browser holds no
authoritative copy: `DB.load()` fetches the school and every collection from
`/api/bootstrap` on boot, and `DB.save(name)` writes a whole collection back.
`localStorage` keeps exactly one thing — the theme. Two members of staff on two
machines see the same school, and a shared office machine does not leak one
session's data into the next.

Collections are stored whole, as JSON documents, rather than a row per record.
The portal saves a collection at a time, so this keeps the write path honest:
what the browser holds after a save is exactly what the database holds. For a
school-sized roll the documents stay small; a district-sized deployment would
want row-level storage and deltas instead.

Both storage adapters implement one contract, documented at the top of
`server/db.js`, and every method is async even where SQLite is synchronous — so
`serve.js` never needs to know which one it is holding.

## Tests

```
npm test                      # both suites
node tests/ai.test.js         # 65 assertions, no server, no network
node tests/server.test.js     # 42 assertions against a real server
```

`ai.test.js` builds the demo school with `server/demo.js` and hydrates `DB` with
it exactly as `DB.load()` would, then covers data integrity (student-id *and*
roll-number uniqueness), every anomaly detector, forecast boundaries, each
data-quality rule against hand-built valid and invalid records, and scholarship
eligibility including income ceilings. `global.fetch` is stubbed to throw, so an
engine that tried to reach the network would fail the suite.

`server.test.js` starts a real server on a spare port against a throwaway SQLite
file and drives it over HTTP the way the browser does. It covers sign-in
(including that an unknown username and a wrong password are indistinguishable),
role enforcement on every mutating route, import validation, that a refused
import changes nothing, collection round-trips, password rules, and that signing
out actually kills the session. It skips itself with a message if
`better-sqlite3` is not installed.

There is no test framework: both are plain Node scripts that print `PASS`/`FAIL`
and exit non-zero on any failure.

---

## Notes and limits

- **Simulated integrations.** SMS, the payment gateway, EMIS upload and file
  dispatch raise a toast rather than calling a real service. The records they
  would produce are written; the outbound call is not made.
- **No audit trail.** The database records the current state, not who changed
  what and when. A school subject to an audit requirement needs that added before
  this holds real records.
- **No encryption at rest.** That is the database's job — use a managed Postgres
  with encryption enabled, or an encrypted volume.
- **Whole-collection writes.** Saving a register rewrites the whole `students`
  document. Correct and simple at school scale; the wrong shape at district
  scale.
- **Sessions are not revoked on role change.** Changing a user's role takes
  effect at their next sign-in.
- **The importer trusts the file's own consistency.** It checks structure,
  identity and calendar alignment, not whether a fee total is arithmetically
  right.

---

## Data protection

Every student in this system is a child under India's DPDP Act 2023, and their
records here include names, addresses, guardians' phone numbers and Aadhaar.

- **No student data leaves the deployment.** All three intelligence engines are
  rule-based and run in the browser. There is no model API, no analytics, no
  third-party call anywhere in the request path.
- **`data/`, `server/` and `migrations/` are refused over HTTP**, listed in
  `PRIVATE` in `serve.js`. The SQLite file holds the entire school; it must never
  be reachable by URL. Any new directory holding data or server code belongs in
  that list too.
- **Parents and students see one child and write nothing**, enforced server-side.
  They never see the intelligence screens: risk scores about a child belong with
  the staff responsible for them.
- **Deleting a school is deleting one database.** Nothing about a school is
  spread across shared tables.


## Licence

Released under the [MIT Licence](LICENSE) — use it, modify it, deploy it, sell it,
with or without attribution beyond keeping the copyright notice. Chosen because a
school or district that wants to adapt this should not have to consult a lawyer
first, and because it imposes nothing on whatever you build next.

**The warranty disclaimer is not a compliance shield.** MIT says the software comes
with no warranty; it says nothing about your obligations if you run it with real
children's records. Before this touches a single actual student, the deployer — not
the author — is responsible for:

- **Verifiable parental consent** and the rest of the DPDP Act 2023 / DPDP Rules 2025
  regime, whose substantive obligations bite on **13 May 2027**. Every student here is
  a child under that Act, and children's-data breaches sit in the highest penalty band.
- **Encryption at rest and in transit, and an audit trail.** This build authenticates
  (scrypt-hashed passwords, server-side sessions, roles enforced on the server) and
  keeps every record in a real database, but it does not encrypt storage and does not
  record who changed what. Terminate TLS in front of it, use an encrypted database,
  and add an audit log before it holds real children's records.
- **Bias review of the intelligence layer.** A model fitted to historical attendance
  will happily learn which communities drop out and then help make that true. The
  engines here are deliberately transparent and rule-based so their reasoning can be
  argued with, but that is a starting point, not a clearance.

### Third-party assets

No third-party code is bundled into the browser: the client half has no dependencies
and no build step. The server uses `pg` and, optionally, `better-sqlite3`. The three
typefaces (Outfit, Inter, Noto Sans Tamil) are loaded at runtime from Google Fonts
and are each licensed under the SIL Open Font License; they are linked, not
redistributed, so nothing in this repository carries their terms. Remove the
`<link>` tags in `index.html` and `app.html` to run fully offline — the CSS falls
back to system fonts.

### If MIT is not what you want

- **Apache-2.0** — same permissions, plus an explicit patent grant and a trademark
  clause. Worth switching to if this becomes a named product, or if an institution's
  procurement team asks for it.
- **AGPL-3.0** — the copyleft option common in school ERPs (Gibbon, openSIS, Moodle
  all use GPL-family licences). Forces anyone offering a modified version as a hosted
  service to publish their changes. Choose it if keeping downstream improvements open
  matters more than commercial flexibility.
