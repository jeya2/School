# sysadmin/ — the control plane

The single-operator console for administering every school deployment.
Design and rationale: [../design/sysadmin-control-plane.md](../design/sysadmin-control-plane.md).

**Status: stage 1 built and tested — read only.** It can watch the fleet and
nothing else. There is no deploy, no destroy, no database maintenance, and no
route that writes to a school. Later stages are listed in §10 of the design
document. This file is the contract the code here must hold to.

## Running it

```bash
node sysadmin/setup.js init jeya "Your Name"    # prints password, TOTP secret,
                                                # and 10 recovery codes — ONCE
node sysadmin/setup.js add schoolx "St. Xavier's" https://schoolx.brightneuronlabs.ca
node sysadmin/serve.js                          # → http://localhost:5590
```

```bash
node sysadmin/setup.js list      # fleet + last known health
node sysadmin/setup.js poll      # poll every school now
node sysadmin/setup.js status    # what the registry holds
node tests/sysadmin.test.js      # 65 assertions; also runs under `npm test`
```

Stage 1 reads only what a school publishes to anyone — `/api/health` and
`/api/status`, both unauthenticated on the school side. **The fleet view holds
no credential against any school**, so compromising the control plane today
yields no student data. Keep that property as long as possible: anything needing
a per-school `AGENT_SECRET` belongs in stage 2 or later.

---

## What this is, and what it is not

**It is** a control plane. It knows *about* schools — where each one is deployed,
whether it is healthy, when it was last backed up, what it is configured to do.

**It is not** a school portal, and it does not hold student records. The
registry database in this folder stores deployment metadata. Children's records
stay in the school deployment that owns them, and nowhere else.

This distinction is the entire reason the design survives contact with the
project's central invariant:

> One deployment serves one school. There is no tenant column anywhere, on
> purpose: schools are isolated by deployment, so a query cannot cross from one
> school's children to another's.

The control plane manages deployments, not students. Each school database still
has no tenant column. When a school's data is needed, this plane asks that one
deployment over a per-school authenticated channel, and the request is logged on
both sides.

---

## Five rules

**1. The dependency arrow points one way.**
Nothing in `server/` or `assets/` may `require` anything from `sysadmin/`, and
nothing here may be loaded by a school's `serve.js`. A school deployment that
cannot import control-plane code cannot be made to execute it.

**2. `sysadmin` is in `PRIVATE`.**
[serve.js](../serve.js#L70) refuses `/sysadmin/...` with 403 on every school
deployment. This folder shares the repository with the school app but is never
served by it. Do not remove it from that list.

**3. Per-school secrets, never a global one.**
Each deployment gets its own `AGENT_SECRET`. A single shared secret would rebuild
exactly the cross-school key this design exists to avoid.

**4. No student records at rest here.**
Backups pass through; they do not accumulate. If a feature needs a school's
records stored in this plane, that is a design change, not an implementation
detail — take it back to the design document.

**5. Every action is audited, append-only, off-box.**
An audit log the control plane can rewrite is decoration. Under the DPDP Act
2023 this surface is privileged access to children's personal data; who did
what, when, and why is what makes that access defensible.

---

## Layout

```
sysadmin/
├── README.md              this file
├── serve.js               control-plane HTTP server — own port, own process
├── auth/
│   ├── totp.js            RFC 6238 — the primary second factor
│   ├── otp.js             SMS OTP — issue, verify, rate-limit, expire
│   ├── sms.js             provider adapter (MSG91 / Twilio / Gupshup)
│   ├── recovery.js        one-time recovery codes
│   └── session.js         30 min idle, 8 h absolute, step-up re-auth
├── registry/
│   ├── db.js              schools, operators, audit
│   └── schema.sql         idempotent, per migrations/001_init.sql convention
├── providers/
│   └── fly.js             deploy · restart · destroy · secrets · logs
├── ops/
│   ├── provision.js       stand up a new school end to end
│   ├── backup.js          pull · verify · store · restore-test
│   ├── maintenance.js     tiered database operations
│   └── health.js          poll every school's /api/health
├── ui/                    dependency-free, no bundler — the school app's idiom
│   ├── index.html         login + OTP challenge
│   ├── app.html           the console
│   └── assets/
└── config/
    └── schools.example.json
```

---

## Conventions

Follow the school application's, because they are good and because two idioms in
one repository is worse than either:

- **Browser code**: no modules, no bundler, no build step. Classic `<script>`
  tags in a fixed order, communicating through globals.
- **Storage**: one documented contract, every method async, so `serve.js` never
  learns which adapter it holds.
- **Roles enforced server-side.** Here there is one operator, so the equivalent
  rule is: every destructive action re-challenges the second factor. A session is
  not a standing licence.
- **Comments explain *why*.** Several in this project encode constraints — DPDP,
  transactional import, whole-collection writes. Match that register.
- **Timing parity on unknown usernames**, exactly as
  [server/auth.js](../server/auth.js) does.

---

## Environment

```
SYSADMIN_USERNAME          the single operator
SYSADMIN_PASSWORD_HASH     scrypt; never a plaintext password
SYSADMIN_TOTP_SECRET       base32; primary second factor
SYSADMIN_MOBILE            E.164, e.g. +91XXXXXXXXXX — set here, NOT editable in the UI
SYSADMIN_ALLOWED_IPS       optional CIDR allowlist
SMS_PROVIDER               msg91 | twilio | gupshup
SMS_API_KEY
SMS_SENDER_ID              DLT-registered header (India)
SMS_TEMPLATE_ID            DLT-registered template (India)
FLY_API_TOKEN              host API access
REGISTRY_DATABASE_URL      the registry's own Postgres — not any school's
AUDIT_SINK                 append-only destination outside this database
```

**`SYSADMIN_MOBILE` is set at deploy time and is not changeable from the UI.**
A "change my number" screen is a complete account-takeover primitive for a
single-operator system. Changing it is a redeploy, deliberately.

---

## Before writing code here

Two things in the design document decide the shape of the first commit, and both
are still open:

1. **TOTP primary with SMS as fallback, or SMS only?** Indian transactional SMS
   needs DLT registration through an operator — budget two to three weeks. TOTP
   needs no provider and works this week. SIM swap is the specific attack against
   a single phone number that unlocks every school.
2. **Does this plane store backups, or only orchestrate them?** Storing them makes
   this a repository of every school's children's records — a much larger target
   and a much bigger DPDP obligation.

Build in the order in §10 of the design document, not in the order the console's
tabs will appear. Stages 1 and 2 — fleet visibility and backups — are worth more
than the deploy button and carry almost no risk.
