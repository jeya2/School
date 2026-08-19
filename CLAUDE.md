# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                          # server dependencies only
node server/provision.js admin <user> <password>   # create the first account
node server/provision.js demo        # load the sample school
node serve.js                        # → http://localhost:5490
node serve.js 8080                   # any other port
npm test                             # both suites
node tests/ai.test.js                # the three intelligence engines
node tests/server.test.js            # sessions, roles, provisioning, persistence
node server/provision.js status      # what this instance holds
```

There is no build step, no bundler and no linter. Tests are plain Node scripts that
print `PASS`/`FAIL` and `process.exit(1)` on any failure — there is no filter flag, so
a single test is run by running its file. To iterate on one assertion, edit the file
rather than reaching for a runner.

`server.test.js` starts a real server against a throwaway SQLite file and deletes it
afterwards; it skips itself if `better-sqlite3` is not installed.

`.env` (gitignored) is parsed by `serve.js` at startup without overriding real
environment variables. See `.env.example`.

## The shape of this application

**One deployment serves one school.** There is no tenant column anywhere, on purpose:
schools are isolated by deployment, so a query cannot cross from one school's children
to another's. A school supplies a JSON file, an admin imports it through the **School
Data** screen (or `server/provision.js import`), and the deployment becomes that
school's portal.

**The database is the single source of truth.** The browser holds no authoritative
copy. `DB.load()` fetches everything from `/api/bootstrap`; `DB.save(name)` writes a
whole collection back. `localStorage` holds exactly one thing — the theme. Do not
reintroduce record storage in the browser; two staff on two machines must see the same
school, and a shared office machine must not leak one session into the next.

## Architecture

**Browser (`assets/js/`)** — dependency-free, no modules, no bundler. Four classic
`<script>` tags in a fixed order (`domain → core → ai → app`, see `app.html`);
everything communicates through globals (`SCHOOL`, `USER`, `Store`, `DB`, `AI`,
`ROUTES`, `api`). Keep new browser code in that idiom — top-level `const`/`function`
declarations, no `import`, no `export`.

**Server (`serve.js`, `server/`)** — a static file server plus the `/api` surface.
`PRIVATE` in `serve.js` lists top-level paths refused over HTTP (`server`,
`node_modules`, `tests`, `.git`, `.env`, `data`, `migrations`). **Any new directory
holding data or server code must be added there** — `data/` holds the SQLite file with
every student record in it.

### `assets/js/domain.js` is loaded twice

Once by the browser as a plain script, once by Node via `require()` (the demo
generator, the importer, the tests). It is the only file both halves share, so nothing
in it may touch the DOM, `localStorage`, `fetch` or the filesystem. Its `module.exports`
tail is guarded by a `typeof module` check.

Tamil Nadu domain specifics live here and are regulatory, not decorative: communities
drive scholarship eligibility, groups drive the Std XI–XII subject map, and 75% is the
public-exam bar. Check this file before inventing a category anywhere else.

`YEAR_START`, `YEAR_WORKING_DAYS`, `MIN_ATTENDANCE`, `HOLIDAYS` and `WORKING_DAYS` are
`let`, not `const`: they are per-school settings, and `core.js` overwrites them via
`applyCalendar()` from the loaded profile. The values in the file are only what an
un-provisioned instance falls back to.

### Storage adapters

`server/db.js` (SQLite) and `server/db_pg.js` (Postgres) implement one contract,
documented at the top of `db.js`. Every method is async even where SQLite is
synchronous, so `serve.js` never learns which adapter it holds. Adding a method means
adding it to **both**.

Collections are stored whole, as JSON documents, rather than a row per record, because
the portal saves a whole collection at a time — what the browser holds after a save is
exactly what the database holds. Correct at school scale; the wrong shape at district
scale, which is a comment in `db.js`, not a TODO.

`better-sqlite3` is an `optionalDependency` — a native addon with prebuilt binaries for
only some Node ABIs. A failed load must never crash the server: `serve.js` records the
error, still serves the site, and answers `503 no_database` on the data routes. Keep
that property.

### Authentication

`server/auth.js`. scrypt with a per-user salt, constant-time comparison, opaque
server-side sessions, HttpOnly cookie. An unknown username burns the same time as a
wrong password so the login cannot enumerate staff — preserve that if you touch
`login()`.

**Roles are enforced in `serve.js`, not in the sidebar.** `allowed()` in `app.js` hides
navigation as a convenience; the API refuses regardless. `tests/server.test.js` asserts
both halves. Parents and students may read one child and write nothing.

### The importer

`server/importer.js` reports rather than repairs, and the two categories are load-bearing:

- **errors** refuse the import — missing `students`, duplicate ids, an `attHistory`
  string whose length does not match `attDays`;
- **warnings** let it proceed — a short phone number, a missing Aadhaar.

Refusing a file because 3% of guardians have no second phone number would mean no
school could ever onboard. Those defects are what the data-quality engine exists to
surface later. Import is transactional: a failed import never leaves half a school.

### Intelligence layer (`ai.js`)

`AI.attendance`, `AI.quality`, `AI.scholarships`, plus `AI.summary()` for the dashboard
band. Pure rule-based functions over `DB`, running entirely in the browser. Every
finding carries `evidence`, `title`, `action` and `severity`; `tests/ai.test.js`
enforces that, so a new detector or rule must emit all four.

**This is the part of the product that matters** — it is why the application exists
rather than being another CRUD form set. No student data may leave the device: under
the DPDP Act 2023 every student here is a child. There is no model API in the request
path and there must not be one. `tests/ai.test.js` stubs `global.fetch` to throw.

These screens are staff-only — parents and students never see risk scores about a child.

### The sample school (`server/demo.js`)

Generated from a fixed seed, so the same records come out every time; tests assert on
specific ones, notably `S4102`. It is imported through exactly the same path as a real
school's file, with no privileged route into the app.

The malformed Aadhaar, short phone numbers and missing groups are seeded **on purpose**
at realistic rates, so the data-quality engine has true faults to find. Do not "fix"
them.

## Conventions

- Comments here explain *why*, often at length, and several encode constraints (DPDP,
  transactional import, the optional native dependency, whole-collection writes).
  Preserve that register when editing near them; don't strip them as noise.
- SMS, payments, EMIS upload and downloads are simulated with a `toast()`.
- School identity is never hardcoded in markup. `index.html` fills `[data-school-name]`
  from `/api/status`; `app.html` is filled by `paintNav()` from the loaded profile. The
  same build serves whichever school the database holds.
