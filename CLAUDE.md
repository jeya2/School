# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                  # only the server needs deps (@google/genai)
node serve.js                # → http://localhost:5490
node serve.js 8080           # any other port
npm test                     # both suites
node tests/agent.test.js     # voice agent — model call mocked, no API key needed
node tests/ai.test.js        # the three on-device engines
```

There is no build step, no bundler, no linter, and no test framework. Tests are plain
Node scripts that print `PASS`/`FAIL` lines and `process.exit(1)` on any failure — there
is no filter flag, so a single test is run by running its file. To iterate on one
assertion, edit the file rather than reaching for a runner.

`.env` (gitignored) holds `GEMINI_API_KEY` and optional `GEMINI_MODEL`; `serve.js` parses
it itself at startup without overriding real environment variables. Without a key the app
still runs fully by keyboard — only `/api/agent` returns `no_api_key`.

Must be served over `http://localhost`. Opening `index.html` from disk leaves the agent
deaf: Chrome refuses microphone access on a `file://` origin.

## Architecture

Two halves with a deliberate boundary between them.

**Browser (`assets/js/`)** — dependency-free, no modules, no bundler. Four classic
`<script>` tags in a fixed order (`core → agent → ai → app`, see `app.html`); everything
communicates through globals (`Store`, `DB`, `Agent`, `AI`, `SCHOOL`, `ROUTES`). Keep new
browser code in that idiom — top-level `const`/`function` declarations, no `import`, no
`export`, no top-level side effects beyond what already exists (`tests/ai.test.js` `eval`s
`core.js` + `ai.js` against a hand-built fake `window`/`localStorage`, and breaks if that
changes).

**Server (`serve.js`, `server/`)** — a static file server plus one endpoint,
`POST /api/agent`. `PRIVATE` in `serve.js` lists top-level paths refused over HTTP
(`server`, `node_modules`, `tests`, `.git`, `.env`); any new directory holding secrets or
server code must be added there.

### The screen-manifest contract

This is the load-bearing idea. The browser never interprets an utterance and the model
never sees data:

1. Each route calls `Agent.screen({ screen, description, routes, actions, controls })` on
   render. `route()` in [app.js](assets/js/app.js#L115) publishes a navigation-only
   baseline manifest first, so a screen that forgets still leaves the agent able to move
   around. `closeModal()` re-publishes; modals register their own manifest via `onOpen`.
2. `Agent.context()` serialises that manifest to **shape only** — ids, labels, types,
   option lists, current control values. DOM handles (`el`) are stripped.
3. `server/agent.js` renders it as text and asks Gemini to pick from four tools:
   `navigate`, `click`, `set_controls`, `respond`. Function calling is forced
   (`mode: 'ANY'`), `temperature: 0`.
4. `Agent.perform()` executes the returned calls against the real page. A tool call naming
   a route/action/control that does not exist, or a value no option matches, is surfaced
   in the transcript via `miss()` — never silently dropped.

Consequences when changing things:

- **The agent can only do what a manifest declares.** Adding a voice capability means
  adding an `action` (with `run()`) or a `control` to a manifest — there is no grammar or
  parser to extend.
- `control.id` must be the real DOM element id; `controlsFrom(container)` harvests
  `input[id], select[id], textarea[id]` automatically and derives labels from
  `.field > label`. `agentRoutes()` returns only routes the current `ROLE` may open.
- **Never put student data in a manifest.** Asked "which class X students are absent",
  the model answers `set_controls: class=X, showing=A` and the browser filters its own
  local data. `tests/agent.test.js` asserts no seeded name, admission number, phone or
  Aadhaar can reach the payload — this is a DPDP Act 2023 constraint, not an optimisation.
- `server/agent.js` is the only file that talks to a model. The prompt, tool contract and
  manifest format are provider-neutral, and the test mocks the client via
  `decide({ ..., client })`, so swapping providers is a one-file change.

### Decision cache (`server/cache.js`)

Replays tool calls the model already produced for the same words on the same screen — it
never interprets anything, so a miss only costs an API call and can never cause a wrong
action. The refusal rules are the point, and each has a test: anaphoric utterances ("change
*it*", "*her*"), time-relative ones ("*today*"), any decision that wrote a resolved
`YYYY-MM-DD`, empty call lists, and screens whose action ids or dropdown options changed
(the key fingerprints ids and option lists but deliberately **not** current control values).
500 entries, LRU, 24h TTL, in-memory.

### Data layer (`core.js`)

All state is `localStorage` under the `ngss.` prefix, via `Store` and the `DB` facade.
Seed data (~370 students, staff, marks, receipts, per-day attendance strings) is generated
deterministically from a seeded `rng()`, so tests can assert on specific records such as
`S4102`. `DB.attHistory[sid]` is one `P`/`A`/`L` character per entry in `WORKING_DAYS` —
the day-level series the attendance engine reads.

**Bump `SCHEMA` in `core.js` whenever the seeded record shape changes**, or browsers
holding older data will render against fields that do not exist. Realistic defects
(malformed Aadhaar, short phone numbers, missing group) are seeded on purpose at set rates
to give the data-quality engine something to find — do not "fix" them.

### Intelligence layer (`ai.js`)

`AI.attendance`, `AI.quality`, `AI.scholarships`, plus `AI.summary()` for the dashboard
band. Pure rule-based functions over `DB`, running entirely in the browser. Every finding
carries `evidence`, `title`, `action` and `severity`; `tests/ai.test.js` enforces that, so
a new detector or rule must emit all four. These screens are staff-only — parent and
student roles never see risk scores about a child.

### Roles

`ROLE` comes from the `session` in `localStorage` (any password works on the login screen).
`NAV` in `app.js` carries a `roles` string per item; `allowed()` gates both the sidebar and
`route()`, and `agentRoutes()` inherits it. A new screen needs a `NAV` entry, a
`ROUTES.<id>` function, and a manifest.

## Conventions

- Comments in this codebase explain *why*, often at length, and several encode constraints
  (DPDP, free-tier quota, model-parameter churn). Preserve that register when editing near
  them; don't strip them as noise.
- Tamil Nadu domain specifics are modelled throughout — EMIS/UDISE pupil ids, communities
  (OC/BC/BCM/MBC/SC/ST), RTE 25%, Std XI–XII groups, 75% public-exam eligibility across a
  220-day year. Check `core.js` constants before inventing a category.
- SMS, payments, EMIS upload and downloads are simulated with a `toast()`.
