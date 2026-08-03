# New Gen Higher Secondary School — Student Management Portal

A demonstration student-management application for a Tamil Nadu higher secondary
school, built around one distinguishing idea: **you talk to it.** Not memorised
commands — you say what you want, and a Gemini-powered agent reads whatever screen
you are on and works out which buttons, filters and fields to operate.

Hypothetical school: **NEW GEN HIGHER SECONDARY SCHOOL**, Perundurai Road, Erode –
638 011. Tamil Nadu State Board, Std I–XII, Tamil and English medium.

---

## Running it

```
npm install                    # once — installs the Google GenAI SDK for the server
cp .env.example .env           # PowerShell: Copy-Item .env.example .env
                               # then edit .env and paste your key
node serve.js                  # → http://localhost:5490
```

Then open **http://localhost:5490** in **Chrome or Edge** and allow the microphone.

The server prints which state it is in on the first line:

```
Voice agent : ready — gemini-3.5-flash-lite
Voice agent : DISABLED — put GEMINI_API_KEY in .env and restart
```

### Getting a free Gemini API key

The voice agent runs on **Google Gemini's free tier** — no credit card, no expiry.

1. Go to **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)**
2. Sign in with any Google account
3. Click **Create API key**
4. Pick a project when asked, or let it create one
5. **Copy the key** — it starts `AIza…`
6. Paste it into `.env` as `GEMINI_API_KEY=AIza…`, then restart the server

That is the whole process; there is no billing step. The free tier allows roughly
**1,000–1,500 requests a day and 15 a minute** on Flash-Lite, which comfortably
covers a school this size.

Two things worth knowing:

- **Free-tier inputs may be used to improve Google's models.** For this app the
  exposure is minimal by construction — the payload contains no student data at all,
  only screen structure (see [What is sent to the API](#what-is-sent-to-the-api)).
  Enabling billing on the same key removes the clause.
- **Quota resets** per-minute after a minute, and daily at midnight US Pacific.
  When you hit it the assistant says so out loud and stops listening rather than
  firing doomed requests.

An environment variable works too and takes precedence over `.env`:

```powershell
$env:GEMINI_API_KEY = "AIza..."   # this window only
```

The catch is that it has to be set in the **same shell** you start the server from,
and on Windows it is gone when that window closes. `.env` avoids both problems.

### Using a different provider

`server/agent.js` is the only file that talks to a model. The prompt, the four-tool
contract and the screen-manifest format are provider-neutral, and `tests/agent.test.js`
mocks the client — so swapping to Claude, Groq, or a local Ollama model is a change to
one file with the test suite still applying.

Three things that will bite you if skipped:

- **Serve it over `http://localhost`. Do not double-click `index.html`.** Chrome
  refuses microphone access on a `file://` origin, so the agent is deaf there.
- **The API key must be set before you start the server.** It is read from the
  environment at startup. Without it the app still runs — every screen works by
  keyboard — but the assistant returns a clear "no API key" message instead of
  acting. The server prints which state it is in on boot.
- **Chrome or Edge.** They ship the Web Speech API used to turn speech into text.
  Elsewhere the dock falls back to a typed box that goes through the identical
  agent, so nothing is unreachable — you type what you would have said.

### Where the API key lives

Server-side, always. `serve.js` proxies `POST /api/agent`; the browser never sees
the key. A static page cannot hold one safely — view-source is all it takes. The
`server/`, `node_modules/` and `tests/` directories are refused over HTTP for the
same reason.

All student data lives in `localStorage` and stays in the browser — see
[What is sent to the API](#what-is-sent-to-the-api).

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

## 🎙 The voice assistant

Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> anywhere and say what you want.
There is no command list to learn — the assistant is given the current screen and
decides which of its controls to operate.

```
"Can you open the portal"                                  → opens the login
"Show me attendance alerts"                                → navigates there
"Which class ten students are absent today?"               → sets two filters, shows the result
"Karthik Raja, father Murugesan, born twelfth March two    → fills eleven fields
 thousand ten, M B C, Tamil medium, standard ten A"
"Roll twelve is absent"                                    → marks that student
"Mark everyone present, then save the register"            → two actions in one breath
"What can I do on this screen?"                            → answers out loud
```

### How it works

```
speech  →  Web Speech API  →  text
                                │
                                ├─ + a manifest of THIS screen: its routes,
                                │    buttons, fields and filter options
                                ▼
                    POST /api/agent  (serve.js — holds the API key)
                                ▼
                        Gemini, four tools:
                        navigate · click · set_controls · respond
                                ▼
                       tool calls returned to the browser
                                ▼
                    the browser executes them on the real page
```

Every screen registers what it can do:

```js
Agent.screen({
  screen: 'attendance',
  description: 'The daily attendance register for one standard, section and date…',
  routes:   agentRoutes(),
  controls: controlsFrom(document.querySelector('.toolbar')),
  actions: [
    { id: 'mark_all_present', label: 'Mark the whole class present', run: …  },
    { id: 'mark_student',     label: 'Mark one student by roll number',
      arg: 'the roll number and the status, e.g. "12 absent"',      run: … }
  ]
});
```

Adding a new voice capability means adding an entry to that manifest. There is no
grammar to extend and no parser to teach.

### What is sent to the API

**The shape of the screen, and what you said. Never student records.**

Asked *"which class ten students are absent today"*, the model does not receive the
roll. It receives "there is a Standard filter with options I…XII and a Showing filter
with options absent/present/late", replies `set_controls: class=X, showing=absent`,
and the **browser** filters its own local data.

This is not an optimisation. Under India's DPDP Act 2023 every student here is a
child, and sending identifiable child data to a third-party API without verifiable
parental consent is the most expensive mistake a school can make. The manifest
boundary is what keeps that from being possible — `tests/agent.test.js` asserts that
no seeded name, admission number, phone or Aadhaar can appear in the request payload.

### The decision cache

In a roll call the same sentences repeat all day — *"mark all present"*, *"save the
register"*, *"roll twelve absent"*. Each one used to be a fresh API call re-deciding
something already decided, which on a ~1,000-request-a-day free tier is the difference
between lasting until lunchtime and lasting all week.

The server keeps the model's own answers and replays them for the same words on the
same screen. It's shared across the whole school, so when one teacher's phrasing is
learned, every other teacher gets it free. The dock shows **↺ from memory** and a
running count of calls saved.

**This is not the old parser coming back.** It never interprets anything — it only
repeats a decision the model itself made. A miss costs an API call; it can never cause
a wrong action. What it refuses to cache is the load-bearing part:

| Refused | Why |
|---|---|
| *"change **it** to eleven"*, *"do that **again**"*, *"mark **her** absent"* | Only means something in context; replaying an old answer would be confidently wrong |
| *"who is absent **today**"*, *"show **tomorrow**"* | Anchored to the present — the answer would rot overnight |
| Any decision that wrote a **resolved date** | Same reason, caught even when the wording looked safe |
| A screen whose **actions or dropdown options changed** | A cached call could name a control that no longer exists |
| **Failed** requests | Only successful decisions are ever stored |

Current control *values* are deliberately **not** part of the key — "mark all present"
is the same decision whether the class filter reads X or XI, and keying on values would
collapse the hit rate to nothing.

Capped at 500 entries (LRU) with a 24-hour expiry, held in memory — restarting the
server clears it.

### When something is not possible

The assistant will not silently do nothing. If a request does not map onto anything
on the current screen it says so and names what *is* available; if it is ambiguous in
a way that changes the outcome it asks one short question. A tool call naming a
control or action that does not exist is reported in the transcript rather than
swallowed.

### Language

English (`en-IN`) and Tamil (`ta-IN`), switchable from the dock or Settings. Speech
recognition quality on Tamil proper nouns is the weakest link in the chain — see
[Notes and limits](#notes-and-limits).

### Shortcuts

| Key | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> | Start / stop listening |

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
| New Admission | 21-field admission form — dictate it or type it |
| Attendance | Daily roll call, status filter, absentee SMS queue, register save |
| Mark Entry | Class × exam × subject grid, live average and fail count |
| Report Cards | Printable progress report with grades, class rank and attendance |
| Fee Collection | Monthly collection chart, receipt register, collection form |
| Fee Dues | Defaulter list with balances and reminder dispatch |
| Staff | Teaching and non-teaching register, pupil–teacher ratio |
| Circulars | Notice board, dictate a new circular |
| Reports & Govt. | EMIS/UDISE+ style community and medium returns, downloadable statutory registers |
| Settings | Theme, assistant language and status, school profile, demo data reset |

Tamil Nadu specifics are modelled throughout: EMIS and UDISE pupil IDs, community
categories (OC/BC/BCM/MBC/SC/ST), RTE 25% seats, Std XI–XII group choice, quarterly
/ half-yearly / annual exam terms, noon meal beneficiaries, free supply registers
and public-exam attendance eligibility at 75%.

---

## Layout

```
index.html                  public site + login (agent enabled)
app.html                    portal shell
serve.js                    static server + POST /api/agent proxy
server/
  agent.js                  the agent's brain — prompt, tools, Gemini call
                            (never served over HTTP; the API key lives here)
  cache.js                  replays decisions the model already made
assets/
  css/
    base.css                design tokens, reset, components, dark theme
    site.css                landing page
    app.css                 portal shell, dashboards, tables
    agent.css               the assistant dock
    ai.css                  AI visual language — aurora band, beacons, gauges
  js/
    core.js                 storage, seed data, formatters, toasts, theme
    agent.js                speech capture, screen manifests, tool execution
    ai.js                   the three on-device intelligence engines
    app.js                  router, every module view, every screen manifest
tests/
  agent.test.js             the voice agent, with the model call mocked
  ai.test.js                attendance / data-quality / scholarship engines
```

Only the server needs npm. The browser side stays dependency-free.

## Tests

```
npm test                     # both suites
node tests/agent.test.js     # 56 assertions — no API key needed
node tests/ai.test.js        # 65 assertions — no dependencies
```

`agent.test.js` mocks the model call, so it runs offline. It checks the request
shape (correct model, JSON schemas, forced function calling, thinking off), the
screen inventory the model is shown, **that no student data can reach the payload**,
and that returned tool calls actually drive a page — including that an unknown action
or an impossible value is surfaced rather than silently dropped.

`ai.test.js` covers seed integrity (student-id *and* roll-number uniqueness), every
anomaly detector, forecast boundaries, each data-quality rule against hand-built valid
and invalid records, and scholarship eligibility including income ceilings.

---

## Notes and limits

- **Demo data.** Everything is generated deterministically on first load and stored
  in `localStorage`. *Settings → Reset demo data* restores it.
- **Speech recognition is the weakest link, not the agent.** The browser's Web Speech
  API turns your voice into text before the model sees anything; Indian-English and Tamil
  proper nouns are where it struggles. If a name comes out wrong, the agent faithfully
  fills in the wrong name. Every field still accepts typing, and the dock's text box
  runs the same agent.
- **Each *new* utterance is one API call, and the free tier is finite.** Roughly
  1,000–1,500 a day and 15 a minute on Flash-Lite. Repeated phrasings are replayed
  from the [decision cache](#the-decision-cache) for free, so the practical ceiling is
  much higher than the raw number — but the first time anyone says something, it costs
  a call. When the quota goes, the assistant says so and stops listening.
- **Flash-Lite is a small model.** It handles navigation and filters reliably; spoken
  dates and Tamil names dictated into the admission form are where it is weakest. If
  that matters more than quota, set `GEMINI_MODEL=gemini-3.6-flash` in `.env`.
- **Latency is real.** Expect a second or two between speaking and the screen moving.
  The dock shows a spinner so it does not look frozen.
- **The agent only knows what a screen declares.** If a control is missing from a
  manifest, the assistant genuinely cannot operate it — and will say so rather than
  guess.
- SMS, payment gateway, EMIS upload and file downloads are simulated — they raise a
  toast rather than calling a real service.
- This is a demonstration build, not a production deployment: no backend, no
  authentication, no audit trail, no encryption.

---

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
- A **real backend with authentication**, encryption at rest and in transit, and an
  audit trail. This build has none of those, by design — it stores everything in
  `localStorage` so it can be demonstrated by opening a page.
- **Bias review of the intelligence layer.** A model fitted to historical attendance
  will happily learn which communities drop out and then help make that true. The
  engines here are deliberately transparent and rule-based so their reasoning can be
  argued with, but that is a starting point, not a clearance.

### Third-party assets

No third-party code is bundled — the application has no dependencies. The three
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
