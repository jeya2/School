# Architecture — School Management Portal

Diagrams of the code as it stands. Every box below is a real file; the notes
record the constraints that made the shape what it is (see `CLAUDE.md`).

**One deployment serves one school.** There is no tenant column anywhere, so a
query can never cross from one school's children to another's. Schools are
isolated by deployment, not by a `WHERE` clause.

Sections 1–9 describe **one school deployment** — the data plane. A separate
control plane administers the fleet of them; see
[sysadmin-control-plane.md](sysadmin-control-plane.md) and §10 below.

---

## 1. System context

```mermaid
flowchart LR
    subgraph Users["People"]
        A["Admin / Principal"]
        T["Teacher"]
        AC["Accountant"]
        P["Parent / Student"]
    end

    subgraph Browser["Browser — dependency-free, no bundler"]
        IDX["index.html<br/>public site + sign-in"]
        APP["app.html<br/>the portal shell"]
    end

    subgraph Node["Node process — serve.js :5490"]
        STATIC["Static file server"]
        API["/api surface"]
    end

    subgraph Storage["Storage — one adapter, chosen at boot"]
        SQL[("SQLite<br/>data/school.db")]
        PG[("Postgres<br/>DATABASE_URL")]
    end

    CLI["server/provision.js<br/>admin · demo · import · export · status · wipe"]

    A --> IDX
    T --> IDX
    AC --> IDX
    P --> IDX
    IDX -->|session cookie| APP
    IDX --> STATIC
    APP --> STATIC
    APP -->|"fetch, same-origin, HttpOnly cookie"| API
    API --> SQL
    API --> PG
    CLI -.->|"same adapter, no HTTP"| SQL
    CLI -.-> PG

    NOAI>"No model API in the request path.<br/>Student data never leaves the device — DPDP Act 2023."]
    style NOAI fill:#fff3cd,stroke:#d39e00,color:#523e02
```

---

## 2. Module map

```mermaid
flowchart TB
    subgraph B["Browser — assets/js, four classic script tags in a fixed order"]
        direction TB
        D["domain.js<br/><i>Tamil Nadu rules + calendar</i><br/>CLASSES · COMMUNITIES · GROUPS<br/>SUBJECTS_BY_LEVEL · FEE_BY_CLASS<br/>MIN_ATTENDANCE · WORKING_DAYS"]
        C["core.js<br/><i>session, DB access, formatters</i><br/>SCHOOL · USER · Store · DB · api()<br/>DB.load() / DB.save(name)"]
        AIJS["ai.js<br/><i>intelligence layer</i><br/>AI.attendance · AI.quality<br/>AI.scholarships · AI.summary()"]
        APPJS["app.js<br/><i>nav, router, 19 screens</i><br/>NAV · ROUTES · allowed()"]
        D --> C --> AIJS --> APPJS
    end

    subgraph S["Server"]
        direction TB
        SRV["serve.js<br/><i>static server + /api + role checks</i><br/>PRIVATE = server, node_modules, tests,<br/>.git, .env, data, migrations"]
        AUTH["server/auth.js<br/>scrypt + per-user salt<br/>opaque server-side sessions"]
        IMP["server/importer.js<br/>validate → errors vs warnings<br/>transactional import"]
        DEMO["server/demo.js<br/>fixed-seed sample school"]
        PROV["server/provision.js<br/>CLI"]
        MIG["server/migrate.js"]
        ADP{{"one storage contract"}}
        DBS["server/db.js<br/>SQLite"]
        DBP["server/db_pg.js<br/>Postgres"]
        SRV --> AUTH
        SRV --> IMP
        SRV --> ADP
        PROV --> IMP
        PROV --> DEMO
        PROV --> ADP
        MIG --> DBP
        ADP --> DBS
        ADP --> DBP
    end

    APPJS -.->|"fetch /api/*"| SRV
    D ---|"require() — the only shared file"| IMP
    D ---|require| DEMO

    SHARED>"domain.js is loaded twice: as a plain script in the browser,<br/>and via require() by Node. So it touches no DOM, no localStorage,<br/>no fetch, no filesystem. Its module.exports tail is guarded."]
    style SHARED fill:#e7f1ff,stroke:#2b6cb0,color:#12345b

    ADPNOTE>"Every adapter method is async even where SQLite is synchronous,<br/>so serve.js never learns which adapter it holds.<br/>Adding a method means adding it to both."]
    style ADPNOTE fill:#e7f1ff,stroke:#2b6cb0,color:#12345b
```

---

## 3. Request lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant U as Staff member
    participant BR as Browser — core.js api()
    participant SV as serve.js
    participant AU as auth.js
    participant ST as storage adapter

    Note over U,ST: Sign in
    U->>BR: username + password
    BR->>SV: POST /api/login
    SV->>AU: login()
    AU->>ST: getUser(username)
    AU-->>AU: scrypt verify, constant-time compare
    Note right of AU: An unknown username burns the same<br/>time as a wrong password — the login<br/>cannot be used to enumerate staff.
    AU->>ST: createSession(token)
    SV-->>BR: Set-Cookie (HttpOnly) + user
    BR->>BR: location → app.html

    Note over U,ST: Load the school
    BR->>SV: GET /api/bootstrap
    SV->>AU: currentUser(cookie)
    SV->>ST: getSchool() + exportAll()
    SV-->>BR: profile + every collection
    BR->>BR: applyCalendar(profile) · DB populated · AI.summary()

    Note over U,ST: Save a change
    U->>BR: edit a record
    BR->>SV: PUT /api/collection/students — the whole collection
    SV->>SV: role check — the API refuses regardless of the sidebar
    SV->>ST: setCollection('students', data)
    SV-->>BR: ok
    BR->>BR: AI.bust() — recompute findings
```

> `DB.save(name)` writes a **whole collection**, never a delta. What the browser
> holds after a save is exactly what the database holds.
> `localStorage` holds exactly one thing: the theme.

---

## 4. The `/api` surface and who may reach it

```mermaid
flowchart LR
    subgraph Open["No session required"]
        H["GET /api/health"]
        L["POST /api/login"]
        ST0["GET /api/status<br/><i>school name for index.html</i>"]
    end

    subgraph Session["Any signed-in role"]
        ME["GET /api/me"]
        BOOT["GET /api/bootstrap"]
        DATA["GET /api/data"]
        STU["GET /api/students<br/>GET /api/students/:id"]
        PW["POST /api/password"]
        LO["POST /api/logout"]
    end

    subgraph Staff["Staff write"]
        COL["GET · PUT /api/collection/:name"]
        SCH["GET · PUT /api/school"]
    end

    subgraph Admin["admin only"]
        PV["POST /api/provision/validate<br/>POST /api/provision/import<br/>POST /api/provision/demo<br/>POST /api/provision/wipe"]
        US["GET · POST /api/users<br/>DELETE /api/users/:username"]
    end

    Open --> Session --> Staff --> Admin
    style Open fill:#e6f4ea,stroke:#34a853,color:#0b3d1b
    style Session fill:#e7f1ff,stroke:#2b6cb0,color:#12345b
    style Staff fill:#fff3cd,stroke:#d39e00,color:#523e02
    style Admin fill:#fde7e9,stroke:#c5221f,color:#5c1512
```

**Roles are enforced in `serve.js`, not in the sidebar.** `allowed()` in `app.js`
hides navigation as a convenience; the API refuses regardless.
`tests/server.test.js` asserts both halves. Parents and students may read one
child (`user.sid`) and write nothing.

| Screen group | admin | principal | teacher | accountant | parent/student |
|---|:--:|:--:|:--:|:--:|:--:|
| Dashboard · Circulars · Settings | ✓ | ✓ | ✓ | ✓ | ✓ |
| My Record | | | | | ✓ |
| Student Master | ✓ | ✓ | ✓ | ✓ | |
| New Admission | ✓ | ✓ | | | |
| Attendance · Mark Entry · Report Cards | ✓ | ✓ | ✓ | | |
| Fee Collection · Fee Dues | ✓ | ✓ | | ✓ | |
| Staff · Reports & Govt. | ✓ | ✓ | | | |
| **Attendance Alerts** (AI) | ✓ | ✓ | ✓ | | |
| **Data Quality** (AI) | ✓ | ✓ | | | |
| **Scholarship Match** (AI) | ✓ | ✓ | | ✓ | |
| School Data — provisioning | ✓ | | | | |

The AI screens are staff-only: parents and students never see risk scores about
a child.

---

## 5. Data model

```mermaid
erDiagram
    USERS ||--o{ SESSIONS : has
    SCHOOL {
        int id "CHECK (id = 1) — exactly one row"
        jsonb data "name, code, udise, year, calendar"
    }
    COLLECTIONS {
        text name PK "one row per collection"
        jsonb data "the WHOLE collection"
        timestamptz updated_at
    }
    USERS {
        text username PK
        text name
        text title
        text role "admin, principal, teacher, accountant, parent, student"
        text sid "the one student a parent or student account may see"
        text salt
        text hash "scrypt — no plaintext ever stored or logged"
    }
    SESSIONS {
        text token PK "opaque; the browser holds only this"
        text username FK
        timestamptz expires_at
    }
```

The nine rows in `collections`:

```mermaid
flowchart LR
    COL[("collections")] --> S["students[]"]
    COL --> M["marks{}"]
    COL --> R["receipts[]"]
    COL --> N["notices[]"]
    COL --> SF["staff[]"]
    COL --> A["attendance{}"]
    COL --> AH["attHistory{}<br/><i>one character per working day, per student</i>"]
    COL --> AD["attDays[]<br/><i>the working-day calendar</i>"]
    COL --> AP["applications[]"]
```

> Stored whole rather than a row per record because the portal saves a whole
> collection at a time. Correct at school scale; the wrong shape at district
> scale — a comment in `db.js`, not a TODO.
>
> `attHistory[sid].length` must equal `attDays.length`; the importer treats a
> mismatch as a hard error.

---

## 6. Provisioning — how a deployment becomes a school

```mermaid
flowchart TB
    START(["Fresh deployment"]) --> ADMIN["node server/provision.js admin USER PASSWORD"]
    ADMIN --> CHOOSE{"Which school?"}
    CHOOSE -->|sample| DEMO["server/demo.js<br/>fixed seed → the same records every time"]
    CHOOSE -->|real| FILE["the school's JSON file"]

    DEMO --> VAL
    FILE --> VAL["server/importer.js — validate"]

    VAL --> ERR{"errors?"}
    ERR -->|"missing students ·<br/>duplicate ids ·<br/>attHistory length ≠ attDays"| REFUSE["✗ refuse the import"]
    ERR -->|none| WARN["warnings recorded<br/><i>short phone, missing Aadhaar</i><br/>the import proceeds"]
    WARN --> TX["importBundle() — one transaction"]
    TX --> DB[("school profile + 9 collections replaced")]
    DB --> LIVE(["The deployment IS that school"])
    WARN -.->|"surfaced later, inside the app"| DQ["AI.quality — the Data Quality screen"]

    style REFUSE fill:#fde7e9,stroke:#c5221f,color:#5c1512
    style WARN fill:#fff3cd,stroke:#d39e00,color:#523e02
    style LIVE fill:#e6f4ea,stroke:#34a853,color:#0b3d1b
```

The importer **reports rather than repairs**, and the two categories are
load-bearing. Refusing a file because 3% of guardians have no second phone
number would mean no school could ever onboard — those defects are exactly what
the data-quality engine exists to surface later. Import is transactional: a
failed import never leaves half a school.

The sample school seeds a malformed Aadhaar, short phone numbers and missing
groups **on purpose**, at realistic rates, so the data-quality engine has true
faults to find. It is imported through the same path as a real school, with no
privileged route into the app.

---

## 7. Intelligence layer

```mermaid
flowchart TB
    DBIN[("DB — in the browser, from /api/bootstrap")] --> AI

    subgraph AI["ai.js — pure rule-based functions, VERSION 1.0"]
        direction TB
        A1["<b>AI.attendance</b><br/>the day-level sequence, not the average"]
        A2["<b>AI.quality</b><br/>EMIS / UDISE+ readiness"]
        A3["<b>AI.scholarships</b><br/>community + income + class → schemes"]
        SUM["AI.summary() → the dashboard band"]
        BUST["AI.bust() — invalidate after a save"]
    end

    A1 --> D1["DRIFT · ONGOING · BLOCK<br/>WEEKDAY · ERRATIC · BASELINE<br/>weighted critical 42 / high 26 / medium 13 / low 5"]
    A2 --> D2["field-level defects across the roll"]
    A3 --> D3["matched schemes per student"]

    D1 --> OUT
    D2 --> OUT
    D3 --> OUT
    OUT["Every finding carries<br/><b>evidence · title · action · severity</b><br/><i>tests/ai.test.js enforces all four</i>"]

    OUT --> SCR["Screens: #insights · #dataquality · #scholarships<br/>staff-only"]

    NET>"tests/ai.test.js stubs global.fetch to throw.<br/>There is no model API in the request path<br/>and there must not be one."]
    style NET fill:#fde7e9,stroke:#c5221f,color:#5c1512
```

This is the part of the product that matters — it is why the application exists
rather than being another CRUD form set. Under the DPDP Act 2023 every student
here is a child, so no student data leaves the device.

Attendance detection works on the day sequence because the aggregate hides the
thing that matters: a child at 68% drifting downward week by week and a child at
68% who missed one illness block are the same number and completely different
problems.

---

## 8. Failure modes designed in

```mermaid
flowchart LR
    subgraph F1["better-sqlite3 fails to load"]
        X1["a native addon, with prebuilt binaries<br/>for only some Node ABIs"] --> Y1["serve.js records storeError"]
        Y1 --> Z1["the site is still served ·<br/>data routes answer 503 no_database"]
    end
    subgraph F2["The session disappears"]
        X2["the API returns 401"] --> Y2["core.js api() redirects to index.html"]
    end
    subgraph F3["Un-provisioned instance"]
        X3["no school row"] --> Y3["the let-bindings in domain.js are the fallback;<br/>applyCalendar() overwrites them once a school loads"]
    end
    style Z1 fill:#e6f4ea,stroke:#34a853,color:#0b3d1b
```

`PRIVATE` in `serve.js` refuses `server`, `node_modules`, `tests`, `.git`,
`.env`, `data`, `migrations` over HTTP, whatever the URL says. **Any new
directory holding data or server code must be added there** — `data/` holds the
SQLite file with every student record in it.

---

## 9. Repository layout

```
School/
├── index.html            public site + sign-in  (fills [data-school-name] from /api/status)
├── app.html              portal shell; four <script> tags, in a fixed order
├── serve.js              static server + /api + role enforcement + the PRIVATE list
├── assets/
│   ├── css/              base · site · app · ai
│   └── js/               domain → core → ai → app   (globals, no modules)
├── server/
│   ├── auth.js           scrypt, opaque sessions, HttpOnly cookie
│   ├── db.js             SQLite adapter        ┐ one contract,
│   ├── db_pg.js          Postgres adapter      ┘ documented at the top of db.js
│   ├── importer.js       validate → errors vs warnings, transactional
│   ├── demo.js           fixed-seed sample school (tests assert on S4102)
│   ├── provision.js      CLI: admin · import · demo · export · status
│   └── migrate.js        applies migrations/
├── migrations/001_init.sql   idempotent; re-runnable on every boot
├── samples/school-template.json
├── tests/
│   ├── ai.test.js        the three engines; stubs fetch to throw
│   └── server.test.js    sessions, roles, provisioning, persistence
│                         (real server, throwaway SQLite, skips without better-sqlite3)
├── data/                 the SQLite file — gitignored, never served
├── sysadmin/             the control plane — separate deployment, in PRIVATE
└── design/               these diagrams
```

No build step, no bundler, no linter. Tests are plain Node scripts that print
`PASS`/`FAIL` and call `process.exit(1)` on any failure.

---

## 10. Two planes

The diagrams above are one school. Administering many of them is a separate
application with a separate deployment, database and domain.

```mermaid
flowchart TB
    subgraph CP["CONTROL PLANE — sysadmin/"]
        UI["Sysadmin console<br/>one operator, OTP-gated"]
        REG[("Registry<br/><i>deployment metadata only</i>")]
        UI --> REG
    end

    subgraph DP["DATA PLANE — §1–9, once per school"]
        S1["schoolx.brightneuronlabs.ca"]
        S2["…"]
    end

    UI -->|"host API — deploy · restart · destroy"| DP
    UI -->|"/api/agent/* — per-school secret, HMAC-signed"| S1

    N>"The control plane manages DEPLOYMENTS, not students.<br/>No tenant column is added to any school database.<br/>SYSADMIN is deliberately NOT a role in domain.js."]
    style N fill:#e6f4ea,stroke:#34a853,color:#0b3d1b
```

`sysadmin/` shares this repository but is never served by a school's `serve.js` —
it is in `PRIVATE`, and the dependency arrow points one way: no school code may
`require` control-plane code.

The tradeoff is stated honestly in the design document: the isolation property
weakens from *"there is no wire between deployments"* to *"every wire is
per-school, authenticated, and audited."*
