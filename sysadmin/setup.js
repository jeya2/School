#!/usr/bin/env node
/* ============================================================
   sysadmin/setup.js — provisioning the control plane

       node sysadmin/setup.js init <username> ["Full Name"]
       node sysadmin/setup.js recovery <username>
       node sysadmin/setup.js add <id> <name> <url>
       node sysadmin/setup.js forget <id>
       node sysadmin/setup.js list
       node sysadmin/setup.js poll
       node sysadmin/setup.js status

   Talks to the registry directly, not over HTTP, so it works before the
   server is running and cannot be reached from the network — the same
   reasoning as server/provision.js for a school.

   `init` prints the TOTP secret and the recovery codes ONCE. They are
   stored hashed; there is no command that will show them again, because
   a command that could would be a way to bypass the second factor.
   ============================================================ */
const crypto = require('crypto');

/* Before anything that reads process.env at load time — registry/db.js
   resolves its file path there. serve.js requires the same module, so
   the CLI and the server can never open different registries. */
require('./env');

const reg = process.env.REGISTRY_DATABASE_URL ? require('./registry/db_pg') : require('./registry/db');
const operator = require('./auth/operator');
const recovery = require('./auth/recovery');
const totp = require('./auth/totp');
const health = require('./ops/health');

function usage(code = 0) {
  console.log(`
  Control plane setup

    node sysadmin/setup.js init <username> ["Full Name"]
        Create the operator. Prints the TOTP secret and recovery codes once.

    node sysadmin/setup.js recovery <username>
        Issue a fresh set of recovery codes, invalidating the old ones.

    node sysadmin/setup.js code [username]
        Print the current six-digit code from the STORED secret.
        Local testing only — refused when NODE_ENV=production.

    node sysadmin/setup.js add <id> <name> <url>
        Register a school deployment.   e.g.
        node sysadmin/setup.js add schoolx "St. Xavier's" https://schoolx.brightneuronlabs.ca

    node sysadmin/setup.js forget <id>
        Remove a school from the registry. Does NOT touch the deployment.

    node sysadmin/setup.js list | poll | status
`);
  process.exit(code);
}

function rule() { console.log('  ' + '─'.repeat(58)); }

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  await reg.init();

  if (cmd === 'init') {
    const [username, name] = args;
    if (!username) usage(1);

    /* The password is generated, not chosen. One operator guarding every
       school is precisely the account that should not have a password a
       human invented and can remember. Put it in a password manager. */
    const password = crypto.randomBytes(24).toString('base64url');
    const { salt, hash } = operator.hashSecret(password);
    const secret = totp.generateSecret();

    await reg.putOperator({
      username, name: name || username, salt, hash,
      totp_secret: secret,
      mobile: process.env.SYSADMIN_MOBILE || null
    });

    const codes = recovery.generate(operator.hashSecret);
    await reg.setRecoveryCodes(username, codes.stored);
    await reg.audit({ actor: username, action: 'operator.created', ok: true, detail: 'via setup.js' });

    console.log('\n  Operator created. This is shown ONCE.\n');
    rule();
    console.log(`  Username     ${String(username).toLowerCase()}`);
    console.log(`  Password     ${password}`);
    rule();
    console.log(`  TOTP secret  ${secret}`);
    console.log(`  Add to your authenticator with either the secret above or:`);
    console.log(`\n  ${totp.provisioningUri(secret, String(username).toLowerCase())}\n`);
    rule();
    console.log('  Recovery codes — print these and store them physically.');
    console.log('  Each works once, and only if TOTP fails.\n');
    codes.display.forEach((c, i) => console.log(`    ${String(i + 1).padStart(2)}.  ${c}`));
    rule();
    console.log(`\n  Verify your authenticator now, before you close this window:`);
    console.log(`  the current code is ${totp.current(secret)}\n`);
    if (!process.env.SYSADMIN_MOBILE) {
      console.log('  SYSADMIN_MOBILE is not set. That is only needed for the stage 6');
      console.log('  SMS fallback, which needs DLT registration first.\n');
    }
    return;
  }

  if (cmd === 'recovery') {
    const [username] = args;
    if (!username) usage(1);
    if (!await reg.getOperator(username)) {
      console.error(`\n  No operator "${username}".\n`);
      process.exit(1);
    }
    const codes = recovery.generate(operator.hashSecret);
    await reg.setRecoveryCodes(username, codes.stored);
    await reg.audit({ actor: username, action: 'operator.recovery_reissued', ok: true });
    console.log('\n  New recovery codes. The previous set no longer works.\n');
    codes.display.forEach((c, i) => console.log(`    ${String(i + 1).padStart(2)}.  ${c}`));
    console.log('');
    return;
  }

  /* The second factor, from the secret the SERVER will check against.
     This exists because hand-copying a 32-character secret between a
     terminal and a `node -e` invocation is a reliable way to generate
     codes that are perfectly valid for the wrong secret — and the error
     the login gives back ("that code is not right") looks identical to a
     genuinely wrong code.

     It is not a weakening: anyone who can run this can already read the
     registry file and compute the same number. It is refused in
     production anyway, because there the answer is an authenticator. */
  if (cmd === 'code') {
    if (process.env.NODE_ENV === 'production') {
      console.error('\n  Refusing: this is a local-testing aid. Use your authenticator.\n');
      process.exit(1);
    }
    const username = args[0] || process.env.SYSADMIN_USERNAME;
    const ops = username ? [await reg.getOperator(username)] : [];
    const op = ops[0];
    if (!op) {
      console.error(`\n  No operator${username ? ` "${username}"` : ''}. Run \`setup.js init <username>\` first.`);
      console.error(`  Registry: ${reg.describe()}\n`);
      process.exit(1);
    }
    if (!op.totp_secret) {
      console.error('\n  That operator has no TOTP secret. Re-run `setup.js init`.\n');
      process.exit(1);
    }
    const left = totp.STEP - Math.floor((Date.now() / 1000) % totp.STEP);
    console.log(`\n  Registry  : ${reg.describe()}`);
    console.log(`  Operator  : ${op.username}`);
    console.log(`  Code      : ${totp.current(op.totp_secret)}`);
    console.log(`  Valid     : ${left}s more (the previous code is still accepted)\n`);
    return;
  }

  if (cmd === 'add') {
    const [id, name, url] = args;
    if (!id || !name || !url) usage(1);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      console.error('\n  id must be a lowercase slug, e.g. schoolx\n');
      process.exit(1);
    }
    if (!/^https?:\/\//i.test(url)) {
      console.error('\n  url must start with http:// or https://\n');
      process.exit(1);
    }
    await reg.putSchool({ id, name, url, provider: 'fly', region: process.env.DEFAULT_REGION || 'sin' });
    await reg.audit({ action: 'registry.school.put', target: id, ok: true, detail: url });

    const snap = await health.check({ url });
    await reg.recordHealth(id, snap);
    console.log(`\n  Registered ${id} — ${name}`);
    console.log(`  ${url}  →  ${health.verdict(snap)}${snap.error ? ' (' + snap.error + ')' : ''}\n`);
    return;
  }

  if (cmd === 'forget') {
    const [id] = args;
    if (!id) usage(1);
    await reg.deleteSchool(id);
    await reg.audit({ action: 'registry.school.forget', target: id, ok: true, detail: 'registry row only' });
    console.log(`\n  Removed ${id} from the registry. The deployment is untouched.\n`);
    return;
  }

  if (cmd === 'list' || cmd === 'poll') {
    if (cmd === 'poll') await health.pollAll(reg);
    const [schools, snaps] = await Promise.all([reg.listSchools(), reg.listHealth()]);
    if (!schools.length) {
      console.log('\n  No schools registered. Add one with `setup.js add`.\n');
      return;
    }
    console.log('');
    for (const s of schools) {
      const snap = snaps[s.id];
      const v = health.verdict(snap);
      const detail = snap
        ? `${snap.school_name || '—'} · ${snap.adapter || '—'} · v${snap.version || '—'} · ${snap.latency_ms ?? '—'}ms`
        : 'never polled';
      console.log(`  ${v.padEnd(8)} ${s.id.padEnd(14)} ${detail}`);
      if (snap && snap.store_error) console.log(`           ${' '.repeat(14)} storeError: ${snap.store_error}`);
      if (snap && snap.error) console.log(`           ${' '.repeat(14)} ${snap.error}`);
    }
    console.log('');
    return;
  }

  if (cmd === 'status') {
    const [ops, schools] = await Promise.all([reg.countOperators(), reg.listSchools()]);
    const audit = await reg.listAudit(1);
    console.log(`\n  Registry    : ${reg.describe()}`);
    console.log(`  Operators   : ${ops}${ops ? '' : ' — run `setup.js init <username>`'}`);
    console.log(`  Schools     : ${schools.length}`);
    console.log(`  Last audit  : ${audit.length ? audit[0].at + '  ' + audit[0].action : '(none)'}`);
    console.log(`  Stage       : 1 — read only\n`);
    return;
  }

  usage(cmd ? 1 : 0);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('\n  Failed:', err.message, '\n'); process.exit(1); });
