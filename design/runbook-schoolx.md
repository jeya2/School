# Runbook — deploying schoolX, the first customer

`schoolx.brightneuronlabs.ca` · a real school · their own JSON file loaded fresh.

Companion to [architecture.md](architecture.md) and [deployment.md](deployment.md).
This is the ordered procedure. Follow it top to bottom.

---

## The two decisions, and why

**Host: Fly.io, Singapore (`sin`) region.**

- Runs the existing [Dockerfile](../Dockerfile) unmodified — no rewrite, no build step.
- `sin` is the nearest region to Tamil Nadu, roughly 30–50ms from Chennai, and it
  supports Managed Postgres.

> **Correction — read this before committing.** An earlier version of this
> runbook specified Chennai (`maa`) and rested on keeping records in India.
> **Fly.io no longer has an India region.** `flyctl platform regions` lists 17
> regions and neither `maa` nor `bom` is among them; the whole Asia-Pacific set
> is Singapore, Sydney and Tokyo.
>
> So on Fly, a Tamil Nadu school's records sit **outside India**. The DPDP Act
> 2023 permits transfer to any country not on the government's negative list, so
> Singapore is lawful today — this is not a hard localisation regime like the RBI
> payment rules. But it is a weaker position than in-country storage, it is a
> question a school's management committee may well ask, and the negative list
> can change.
>
> **If in-India residency is a requirement, Fly is the wrong host.** Use
> DigitalOcean Bangalore (`blr1`), AWS `ap-south-1` (Mumbai), Azure India, or an
> Indian provider such as E2E Networks. The Dockerfile runs unchanged on any of
> them; only §1 of this runbook changes.

**Database: Postgres. Not SQLite.**

For a real customer this is not a close call:

- `better-sqlite3` is an `optionalDependency` and a native addon. The pinned
  `^9.6.0` predates Node 22, which the Dockerfile builds on, and `node:22-slim`
  carries no compiler toolchain — so if no prebuilt binary matches, the install
  still *succeeds* and the module is simply absent.
- The failure is silent and late: `serve.js` records `storeError`, serves the
  site normally, and answers **503 `no_database`** on every data route. You would
  discover it with the customer watching.
- The Dockerfile's own comment says as much: *"the image simply runs
  Postgres-only, which is what a cloud deployment should be doing anyway."*
- `pg` is a hard dependency and [db_pg.js](../server/db_pg.js) is complete.
  [001_init.sql](../migrations/001_init.sql) is idempotent and applied on every
  boot, so there is no migration step to run.

Choosing Postgres makes the whole question moot. Don't gamble a first customer
on a native addon's prebuild matrix.

**Cost: roughly $0–3/month** — Fly machine scaled to zero plus a free-tier
Postgres. See §1.2. Verify current pricing; it moves.

---

## Phase 0 — Validate the customer's file *before* anything is deployed

Do this first, on your own machine, today. Your local Node (v21) has a working
`better-sqlite3`, so a throwaway SQLite file is the fastest way to run the real
importer over their data.

```bash
cd School
SCHOOL_DB=throwaway.db node server/provision.js import ~/path/to/schoolx.json
```

You get the actual validation report. Read it carefully:

**Errors — the import is refused, nothing is written.** Go back to the school:

| Error | What they must fix |
|---|---|
| `No "school" object` / `school.name is required` | The file must name the school |
| `N students missing "id" / "name" / "cls"` | Required on every record |
| `N duplicate student ids` | Every record must be uniquely addressable |
| `N students have a class outside I–XII` | `cls` is a Roman numeral, I to XII |
| `N attendance records do not match attDays` | **The most common one.** `attHistory[id]` must be exactly one P/A/L character per entry in `attDays` |
| `accounts[i] needs username, password and role` | See Phase 4 |

**Warnings — the import proceeds.** These are the ordinary defects of a real
student master: missing Aadhaar, short phone numbers, an unrecognised community
or medium. **Do not ask the school to fix these before onboarding.** They are
exactly what the Data Quality screen exists to surface, and refusing a file
because 3% of guardians lack a second phone number means no school ever
onboards. Note them, import anyway, and show the school the Data Quality screen
in week one — it is a better demonstration of the product than a clean file.

Then inspect what actually landed, and clean up:

```bash
SCHOOL_DB=throwaway.db node server/provision.js status
rm data/throwaway.db*
```

> **Treat their JSON as a secret from the moment it arrives.** It contains
> children's names, addresses, guardian phone numbers, Aadhaar numbers and — if
> it carries an `accounts` list — **plaintext passwords**. Do not put it in the
> repo, do not email it onward, and delete your copies once the import is done.
> It is gitignored nowhere; `git status` will happily offer to commit it.

---

## Phase 1 — Deploy the application

### 1.1 Create the app

On Windows the binary is `flyctl` — there is no `fly` alias, unlike macOS and
Linux. Every command below is written as `flyctl`.

`fly.toml` is already committed at the repo root with `app = "schoolx"` and
`primary_region = "sin"`, so `launch` is not needed. Run these from the project
root; flyctl reads `fly.toml` from the working directory.

```bash
flyctl auth login
flyctl apps create schoolx
flyctl config validate          # wants the app to exist first
```

### 1.2 The database

**`flyctl postgres create` is deprecated** — it refuses and points at Managed
Postgres. But **Fly Managed Postgres starts at $38/month**, which is absurd
against a ~$3/month application. Do not buy it for a demo school.

#### The cheap path: external Postgres, free tier

`serve.js` needs one thing: a `DATABASE_URL`. It does not care whose Postgres it
is. Neon and Supabase both have free tiers that scale to zero.

1. Create a free Postgres at neon.tech (or supabase.com). Pick the region nearest
   your app — and if an India region is offered, taking it also fixes the
   residency gap noted above.
2. Copy the connection string it gives you. It looks like this, with a real
   host, not the ellipsis:

   ```
   postgresql://myuser:npg_XXXX@ep-cool-name-12345.ap-southeast-1.aws.neon.tech/neondb
   ```

3. **Append `?sslmode=verify-full`** (replacing `?sslmode=require` if the provider
   put that there), then set it:

   ```bash
   flyctl secrets set DATABASE_URL='postgresql://myuser:npg_XXXX@ep-cool-name-12345.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full' --app schoolx
   ```

Use `verify-full`, not `require`. `pg` currently treats `require` as an alias for
`verify-full` but warns that in pg v9 it will adopt libpq semantics, where
`require` means *encrypt but do not check the certificate* — a silent downgrade
on a connection carrying children's records. Writing `verify-full` says what we
mean and survives the change.

That is the whole integration. `pg` is already a hard dependency and
[db_pg.js](../server/db_pg.js) is complete;
[001_init.sql](../migrations/001_init.sql) is idempotent and applied on every
boot, so there is no migration step.

A free-tier database suspends when idle, so the first query after a quiet period
takes a second or two. For a demo that is fine. For a real school, pay for a
plan that does not sleep — from any provider — rather than accepting a cold
database on Monday morning.

#### Cost

| | |
|---|---|
| Fly machine, `shared-cpu-1x` 512MB, scale-to-zero | **~$0–3/mo** — you pay for minutes actually served |
| Neon / Supabase free tier | **$0** |
| **Total** | **~$0–3/mo**, pay as you go |

`fly.toml` ships with `auto_stop_machines = "stop"` and
`min_machines_running = 0` for exactly this. **Flip both back for a real
school** — the comments in the file say how, and why.

#### If you do want Fly Managed Postgres later

```bash
flyctl mpg create --name schoolx-db --region sin --plan Basic
flyctl mpg list                 # note the CLUSTER ID — attach takes the id, not the name
flyctl mpg attach <CLUSTER_ID> --app schoolx
```

`mpg attach` takes the **cluster id**, not the name, and sets `DATABASE_URL` for
you (its default `--variable-name`).

#### Why not SQLite on a Fly volume — the genuinely cheapest option

A volume costs about $0.15/GB/month, so this would be cheaper still, and
[db.js](../server/db.js) is a complete adapter. The blocker is the pinned
dependency: `better-sqlite3@^9.6.0` declares no supported Node versions at all,
and only 12.x onward declares `20.x || 22.x || 23.x || 24.x`. The Dockerfile
builds on `node:22-slim` with no compiler toolchain, so if no prebuilt binary
matches, the optional dependency installs "successfully" while the module is
absent — and the school serves its site while answering **503 on every data
route**.

Bumping to `^12` would fix the container but drop support for local Node 21,
which is what this machine runs. Worth revisiting when local Node moves to 22
LTS; not worth risking a deployment over a few dollars today.

### 1.3 Set the first administrator

```bash
flyctl secrets set \
  ADMIN_USERNAME=bnladmin \
  ADMIN_PASSWORD='<25+ random characters>' \
  ADMIN_NAME='Bright Neuron Labs' \
  SESSION_DAYS=7 \
  --app schoolx
```

`serve.js` creates this account on first boot **only if the instance has no
accounts at all**, so it is a bootstrap, not a backdoor. This is your operator
account, deliberately named for you rather than the school — the school's own
admin arrives in their JSON.

Generate the password properly:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

### 1.4 Deploy

```bash
flyctl deploy --app schoolx
flyctl logs --app schoolx
```

In the logs you want to see the Postgres adapter selected and
`Created the first administrator from ADMIN_USERNAME`. If you instead see a
`storeError`, stop — `DATABASE_URL` did not arrive.

### 1.5 Prove it before touching DNS

```bash
curl https://schoolx.fly.dev/api/health
```

---

## Phase 2 — Point the subdomain at it

In the Cloudflare dashboard, zone **brightneuronlabs.ca** → DNS:

| Type | Name | Content | Proxy status |
|---|---|---|---|
| CNAME | `schoolx` | `schoolx.fly.dev` | **DNS only (grey cloud)** |

Grey cloud, deliberately. Fly then terminates TLS itself with its own Let's
Encrypt certificate: fewer moving parts, no ACME challenge intercepted by
Cloudflare's proxy, and no chance of anyone leaving SSL/TLS on **Flexible** —
which would have Cloudflare talk to the origin over plain HTTP, causing
[auth.js](../server/auth.js#L64) to see no `x-forwarded-proto: https` and drop
the `Secure` flag from the session cookie. An unprotected session token for an
application holding children's records is not a risk worth taking for a CDN you
don't need.

Then issue the certificate:

```bash
flyctl certs add schoolx.brightneuronlabs.ca --app schoolx
flyctl certs show schoolx.brightneuronlabs.ca --app schoolx
```

Wait for `Certificate Status: Ready` (usually a minute or two), then:

```bash
curl -I https://schoolx.brightneuronlabs.ca/api/health
```

If you later want Cloudflare's proxy for DDoS protection, turn the cloud orange
**and set SSL/TLS to Full (strict) in the same sitting.** Never Flexible.

---

## Phase 3 — Load the school

Use the browser, not the CLI. The **School Data** screen runs the identical
validate-then-import path through `/api/provision/validate` and
`/api/provision/import`, needs no file copied onto the machine, and shows the
school's own staff the report — which is a far better onboarding conversation
than a terminal transcript.

1. Sign in at `https://schoolx.brightneuronlabs.ca/` as `bnladmin`.
2. **School Data** (admin-only, under System) → select their JSON.
3. Read the report on screen. It is the same report you saw in Phase 0.
4. Import.

The import is transactional — a failure never leaves half a school.

Body size is capped at **25 MB** by default. A few thousand students with a full
year of attendance history is comfortably inside that; if their file is larger,
`flyctl secrets set MAX_UPLOAD_MB=50` and redeploy.

Confirm:

```bash
flyctl ssh console -C "node server/provision.js status" --app schoolx
```

Expect the Postgres adapter, their school name, and the student count from their
file. The portal now brands itself from their profile — `paintNav()` fills the
crest, name and academic year from the loaded school, and nothing about schoolX
is hardcoded in the markup.

---

## Phase 4 — Accounts

### If their JSON carried an `accounts` array

It was applied during the import. The rules, from
[auth.js](../server/auth.js) and [importer.js](../server/importer.js):

- `username`, `password` and `role` are mandatory on every entry — a missing one
  is a hard **error** that refuses the whole file.
- Roles: `admin`, `principal`, `teacher`, `accountant`, `parent`, `student`.
- **Parent and student accounts need a `sid`** — the one student that account may
  read. Without it the account signs in and sees nothing.
- Existing usernames are **skipped, not overwritten**, so a re-import never
  resets a password someone has already changed.
- Passwords are scrypt-hashed on arrival; the plaintext is never stored.

### If it carried no accounts

You'll have seen the warning. Create them on the **Users** screen (System →
admin only), or `POST /api/users`.

### Before handing over — non-negotiable

Every password in that JSON existed in plaintext, in a file, that travelled to
you by some means you do not control.

1. Have the school's admin sign in and change their password immediately.
2. Change your own `bnladmin` password from the Settings screen — it sat in your
   shell history and in Fly's secret store.
3. Walk the **Users** screen and confirm the list is exactly who it should be.
4. Delete every copy of their JSON that still has plaintext passwords in it.

### Check the role boundary yourself

Sign in as one of their parent accounts and confirm: **My Record** only, one
child, no student master, and none of the three AI screens. Parents and students
never see risk scores about a child — that's a product decision, and it is worth
being able to tell the school you verified it rather than assuming it.

---

## Phase 5 — Backups, before you call it live

This is the step that separates a deployment from a liability. Two things must
be backed up, and **neither one covers the other**:

| What | How | Contains |
|---|---|---|
| **Records** | `node server/provision.js export <file>.json` | School profile + all nine collections. Re-importable as-is. |
| **Accounts** | `pg_dump` of the Postgres database | Users and sessions |

`provision.js export` **deliberately omits accounts** — the hashes are useless to
a reader and a leaked dump should not hand anyone the login table. Correct
decision, but it means a JSON export alone cannot restore a working school:
you'd get every record back and nobody able to sign in.

A weekly job, off the host:

```bash
flyctl ssh console -C "node server/provision.js export /tmp/backup.json" --app schoolx
flyctl ssh sftp get /tmp/backup.json ./backups/schoolx-$(date +%F).json --app schoolx
flyctl postgres db dump schoolx-db > ./backups/schoolx-db-$(date +%F).sql
```

Store them encrypted. They are children's records.

**Then test the restore path once, now, while nothing depends on it:** create a
scratch Fly app, import the backup JSON, and confirm the school comes up. An
untested backup is a hope.

---

## Phase 6 — Sign-off checklist

- [ ] `https://schoolx.brightneuronlabs.ca/api/health` answers over HTTPS
- [ ] `/server/db.js` returns **403 Forbidden**, not source
- [ ] `/data/` returns **403**
- [ ] `/.env` returns **403**
- [ ] Session cookie shows `Secure`, `HttpOnly`, `SameSite=Lax` in devtools
- [ ] `provision.js status` reports the Postgres adapter and their student count
- [ ] The school's name and academic year appear in the sidebar — not a fallback
- [ ] A parent account sees **My Record** only, for one child, with no AI screens
- [ ] A parent session cannot `PUT /api/collection/students` — the API refuses,
      not merely the sidebar
- [ ] `flyctl apps restart schoolx` — **and the school is still there afterwards**
- [ ] Both backup artefacts exist, and a restore has been tested once
- [ ] Every plaintext-password copy of their JSON is deleted
- [ ] `bnladmin` and the school admin have both changed their passwords

The restart item is the one people skip. Do it deliberately, before the school
depends on the deployment, not after.

---

## What to ask schoolX for

Send them [samples/school-template.json](../samples/school-template.json) — it is
annotated, and keys beginning with `_` are ignored so the notes can stay in the
file. The essentials:

```
school.name                required
school.year                e.g. "2026–27"
school.udise               needed for UDISE+ returns later
school.yearStart           e.g. "2026-06-01"
school.yearWorkingDays     e.g. 220
school.minAttendance       0.75 — the public-exam bar

students[].id              required, unique
students[].name            required
students[].cls             required, Roman I–XII
students[].community       OC / BC / BCM / MBC / SC / ST  → drives scholarships
students[].medium          Tamil / English
students[].group           Std XI–XII only
students[].income, firstGraduate, cwsn, rte    → the scholarship matcher

attDays[]                  the working-day calendar
attHistory{id}             one P/A/L character per attDay — lengths MUST match

accounts[]                 username + password + role; parents/students need sid
```

Two points worth making to them directly:

**Community, income, `firstGraduate`, `cwsn` and `rte` are what the scholarship
matcher reads.** If those columns come over blank, the Scholarship Match screen
has nothing to work with and the school loses the feature they are most likely
to renew for. Worth one phone call to get right.

**Don't let them clean the file first.** Schools will want to tidy up before
sending. Ask them not to: the missing Aadhaars and short phone numbers are
warnings, they import fine, and the Data Quality screen turning up 200 real
defects in their own records during week one is the single most convincing thing
this product does.
