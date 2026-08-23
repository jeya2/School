# Deployment — hosting, domains and cost

Companion to [architecture.md](architecture.md). Prices are approximate and
change; verify each against the vendor's current page before committing.

---

## 1. Why the app needs an origin root, not a path

The portal must be served at the root of an origin — `https://schoolx.com/`,
not `https://brightneuronlabs.ca/schoolx/`. Three places in the code assume it:

| Assumption | Where | What breaks under a path prefix |
|---|---|---|
| `fetch('/api' + path)` | [core.js:56](../assets/js/core.js#L56) | Every API call goes to `brightneuronlabs.ca/api/...`, colliding with the marketing site |
| `Path=/` on the session cookie | [auth.js:68](../server/auth.js#L68) | The session cookie is scoped to the whole parent domain and is sent to the marketing site on every request |
| `PRIVATE` matches the **first** path segment | [serve.js:314](../serve.js#L314) | `normalised.split('/')[0]` — behind a prefix the first segment is `schoolx`, so `server`, `data` and `.env` stop being caught |

Also `location.replace('index.html')` and `location.href = 'app.html'` are
relative, so they only resolve correctly from a known root.

This is fixable, but it would mean a `BASE_PATH` setting threaded through
`api()`, the cookie, the router and the static server — and the cookie-scope
problem is a genuine security issue, not just a routing annoyance. Not worth it.

### A subdomain is an origin root

Worth being precise, because the two get conflated:

```
brightneuronlabs.ca/schoolx     ← sub-URL (a path). Broken, per the table above.
schoolx.brightneuronlabs.ca     ← subdomain. Its own origin, its own root. Works.
schoolx.com                     ← separate domain. Also works. Costs money.
```

**A subdomain satisfies the constraint completely.** Its own cookie jar, its own
root, no code changes. It is free, you already control the DNS zone, and it can
be live in ten minutes. Buy `schoolx.com` only if you want the demo to read as
an independent product rather than a Bright Neuron Labs sub-brand — that is a
marketing decision, not a technical one.

---

## 2. Is Cloudflare suitable?

Split the question in two, because the answer differs.

### Cloudflare as DNS + CDN + TLS — yes, keep it

Nothing to change. The app already reads `x-forwarded-proto` to decide whether
to set `Secure` on the cookie ([auth.js:64](../server/auth.js#L64)), which is
exactly what Cloudflare's proxy sends. Proxying (orange cloud) works.

### Cloudflare as the *host* — not as the app stands

| Cloudflare product | Can it run this app? | Why |
|---|---|---|
| **Pages** (what `brightneuronlabs.ca` almost certainly uses) | **No** | Static assets only. There is no Node process, no persistent database, no `/api`. It would serve `index.html` and every data route would 404. |
| **Workers** | **No, without a rewrite** | Workers are V8 isolates, not Node. `http.createServer` has no equivalent — `serve.js` would be rebuilt as a `fetch` handler. `better-sqlite3` is a native `.node` addon and can never load there. |
| **Workers + D1** | Only after that rewrite | D1 is reached through a binding, not the Postgres wire protocol, so `pg` and `db_pg.js` do not apply. You would write a third adapter. |
| **Workers + Hyperdrive → external Postgres** | Only after that rewrite | Solves the database, not the `http.createServer` problem. |
| **Cloudflare Containers** | **Yes, in principle** | Runs the [Dockerfile](../Dockerfile) as-is. Newer product on the Workers Paid plan; confirm current pricing and limits before relying on it. |

**So: `brightneuronlabs.ca` being on Cloudflare tells you nothing useful about
where this app can live.** The marketing site is static; this is a stateful Node
application with a database. They are different hosting problems.

### The rewrite, if you ever wanted it

Not catastrophic, and the architecture helps: `db.js` and `db_pg.js` already
implement one documented contract with every method async, so a `db_d1.js` is a
third sibling rather than a redesign. The real work is `serve.js` — routing,
static serving, session handling and role checks moved into a `fetch` handler.
Call it a few days, plus re-proving `tests/server.test.js`, which currently
starts a real Node server.

**Don't do it for schoolX.** The Dockerfile already exists and works.

---

## 3. Does it support a database-based complete application?

The app is one, and it is built for exactly this deployment shape:

- `pg` is a hard dependency; [server/db_pg.js](../server/db_pg.js) is a complete
  Postgres adapter.
- [migrations/001_init.sql](../migrations/001_init.sql) is idempotent and
  re-runnable on every boot, so there is no migration step to orchestrate.
- The [Dockerfile](../Dockerfile) builds one image for every school; identity
  arrives through the data file after deployment, never baked in.
- `serve.js` binds `0.0.0.0` whenever `PORT` is set — what a container needs.
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` provision the first account on first boot,
  so a platform where running a one-off command is awkward still works.

**Choose Postgres for any cloud deployment.** SQLite is correct only where there
is a real persistent disk — a VPS, or a mounted volume. On a platform with an
ephemeral filesystem the school disappears on the next restart. The comment in
[.env.example](../.env.example) says this; it is not a preference.

---

## 4. Cost of running 24/7

The app is small: one Node process, no build step, a database measured in
megabytes for a school of a few thousand students. It does not need much.

| Option | Rough monthly | Notes |
|---|---|---|
| **VPS + Docker + SQLite on the disk** (Hetzner, DigitalOcean droplet, Vultr) | **~$5–7** | Cheapest and simplest. Real disk, so SQLite is legitimate. You own backups and OS patching. |
| **Fly.io + Postgres** | **~$5–12** | Runs the Dockerfile directly. Persistent volumes available, so SQLite is also viable. Scales to zero if you want the demo cheaper still. |
| **Railway** | **~$5–20** | Usage-based, deploys the Dockerfile, managed Postgres one click away. |
| **Render** | **~$14** | ~$7 web service + ~$7 Postgres. Its free tier spins down when idle — a portal that takes 30 seconds to answer the first request is not a good demo. |
| **DigitalOcean App Platform** | **~$5 + ~$15** | Managed Postgres is the expensive half. |
| **Cloudflare Containers** | verify | Workers Paid ($5) plus container usage. Confirm current rates. |
| **Azure / AWS** | **~$30+** | Only worth it if a school's procurement demands that specific cloud. |

Add **~$10–15/year** for a `.com` domain, if you buy one.

**For schoolX, a demo school: a $5–7 VPS or Fly.io.** At that size the database
choice barely matters — pick SQLite on a persistent volume and skip the managed
Postgres bill entirely, since a demo has no uptime obligation.

### One deployment, one school — the cost consequence

There is no tenant column anywhere, by design. Ten schools means ten
deployments, ten databases, ten domains or subdomains. Roughly linear cost per
school, which is fine at $5–7 each and is the price of the isolation guarantee:
a query cannot cross from one school's children to another's.

Budget for it as per-school hosting, and prefer
`<school>.brightneuronlabs.ca` subdomains for real customers so each one costs
hosting only, not hosting plus a domain.

---

## 5. Deploying schoolX

### Before anything: check the domain

`schoolx.com` is short and generic and is **very likely already registered.**
Check it before planning around it. If it is taken:

- `schoolx.brightneuronlabs.ca` — free, works today, no code changes
- `schoolxdemo.com`, `schoolx.app`, `schoolx.school`, `getschoolx.com`
- `.app` and `.dev` are HSTS-preloaded, so they are HTTPS-only by definition — a
  small point in their favour for something handling children's records

The steps below are identical for a subdomain; skip step 1 and 2.

### Step 1 — Register the domain

Any registrar. Cloudflare Registrar sells at cost and puts the domain in the
account you already use.

### Step 2 — Add the zone to Cloudflare

Cloudflare dashboard → **Add a site** → `schoolx.com` → Free plan. Cloudflare
gives you two nameservers; set them at the registrar. Propagation is usually
under an hour. This is a separate zone from `brightneuronlabs.ca` and does not
disturb it.

### Step 3 — Deploy the container

Fly.io shown; the shape is the same anywhere that takes a Dockerfile.

```bash
flyctl launch --no-deploy            # detects the Dockerfile, writes fly.toml
flyctl volumes create school_data --size 1     # only if using SQLite
flyctl secrets set ADMIN_USERNAME=admin ADMIN_PASSWORD='<a long random password>'
# for Postgres instead of SQLite:
# flyctl mpg create && flyctl mpg attach <cluster-id>   # sets DATABASE_URL (postgres create is deprecated)
flyctl deploy
```

Mount the volume at `/app/data` in `fly.toml` if you are on SQLite — the
Dockerfile already declares that path.

Confirm it is alive before touching DNS:

```bash
curl https://<app>.fly.dev/api/health
```

### Step 4 — Point the domain at it

In Cloudflare DNS for `schoolx.com`:

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `@` | `<app>.fly.dev` | Proxied (orange) |
| CNAME | `www` | `schoolx.com` | Proxied (orange) |

Then register the hostname with the platform so it issues its own certificate:

```bash
flyctl certs add schoolx.com
```

### Step 5 — Set SSL/TLS to Full (strict)

Cloudflare → SSL/TLS → Overview → **Full (strict)**.

This one matters. On **Flexible**, Cloudflare talks to your origin over plain
HTTP, and the app — seeing no `x-forwarded-proto: https` — may omit the `Secure`
flag from the session cookie. That is a session token travelling unprotected on
the back half of the connection, for an application holding children's records.
Full (strict) also avoids redirect loops. Turn on **Always Use HTTPS** while you
are there.

### Step 6 — Provision the school

Sign in at `https://schoolx.com/` with the admin account created from
`ADMIN_USERNAME` / `ADMIN_PASSWORD` on first boot, then either:

- **School Data** screen → load the sample school, or
- `flyctl ssh console -C "node server/provision.js demo"`

The demo generator runs from a fixed seed, so the same records come out every
time and the data-quality engine has its seeded faults to find. Since schoolX is
a demo, this is the right choice — a real school would import its own JSON file
through the same path.

Verify:

```bash
flyctl ssh console -C "node server/provision.js status"
```

### Step 7 — Change the admin password

`ADMIN_PASSWORD` sat in your shell history and in the platform's secret store.
Change it from the Settings screen once you are in, and check the account list
under **Users**.

---

## 6. Post-deploy checklist

- [ ] `https://schoolx.com/api/health` answers
- [ ] `https://schoolx.com/server/db.js` returns **403 Forbidden**, not source — the `PRIVATE` guard
- [ ] `https://schoolx.com/data/school.db` returns **403**
- [ ] `https://schoolx.com/.env` returns **403**
- [ ] The session cookie shows `Secure`, `HttpOnly`, `SameSite=Lax` in devtools
- [ ] Signing in as a parent account shows **My Record** only — no AI screens, no student master
- [ ] A parent's session cannot `PUT /api/collection/students` (the API refuses, not just the sidebar)
- [ ] SQLite volume is mounted at `/app/data`, or `DATABASE_URL` is set — restart the app and confirm the school is still there
- [ ] A backup exists: `node server/provision.js export` on a schedule, stored off the host
- [ ] `brightneuronlabs.ca` links to `schoolx.com` for the demo

That fourth-from-last item is the one people skip. Restart the deployment once,
deliberately, before you show it to anyone.
