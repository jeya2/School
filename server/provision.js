#!/usr/bin/env node
/* ============================================================
   server/provision.js — command-line provisioning

   Solves the chicken and egg of a fresh deployment: the admin screens
   need an admin account, and creating an account needs the admin
   screens. Run this once against a new instance and sign in normally
   afterwards.

       node server/provision.js admin <username> <password> ["Full Name"]
       node server/provision.js import <school-file.json>
       node server/provision.js demo
       node server/provision.js status

   It talks to the database directly, not over HTTP, so it works before
   the server is running and cannot be reached from the network.

   On a cloud platform where running a one-off command is awkward, set
   ADMIN_USERNAME and ADMIN_PASSWORD instead: serve.js creates that
   account on first boot if no accounts exist yet.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const store = (process.env.DATABASE_URL || process.env.PG_CONNECTION || process.env.USE_PG === '1')
  ? require('./db_pg')
  : require('./db');
const auth = require('./auth');
const importer = require('./importer');

function usage(code = 0) {
  console.log(`
  Provisioning a school instance

    node server/provision.js admin <username> <password> ["Full Name"]
        Create (or reset) an administrator account.

    node server/provision.js import <school-file.json>
        Validate and load a school's data file. Refuses on any error.

    node server/provision.js demo
        Load the built-in sample school, for a first look at the portal.

    node server/provision.js export <file.json>
        Write the whole school out as JSON — a backup, and the readable
        way to inspect what the database holds. Re-importable as-is.

    node server/provision.js status
        Show what this instance currently holds.
`);
  process.exit(code);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  await store.init();

  if (cmd === 'admin') {
    const [username, password, name] = args;
    if (!username || !password) usage(1);
    if (password.length < 8) {
      console.error('  Refusing: use a password of at least 8 characters.');
      process.exit(1);
    }
    await auth.putAccount(store, {
      username, password, role: 'admin',
      name: name || username, title: 'Administrator'
    });
    console.log(`  Administrator "${username.toLowerCase()}" is ready. Sign in at /index.html`);
    return;
  }

  if (cmd === 'import') {
    const file = args[0];
    if (!file) usage(1);
    const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    const report = importer.validate(raw);

    report.warnings.forEach(w => console.log('  warning  ' + w));
    if (!report.ok) {
      report.errors.forEach(e => console.error('  ERROR    ' + e));
      console.error(`\n  Refused: ${report.errors.length} error(s). Nothing was written.\n`);
      process.exit(1);
    }
    await store.importBundle(report.bundle);
    const accounts = await auth.provisionAccounts(store, report.accounts);
    console.log(`\n  Imported ${report.summary.students} students into "${report.summary.school}".`);
    console.log(`  Accounts: ${accounts.created} created, ${accounts.skipped} already existed.\n`);
    return;
  }

  if (cmd === 'demo') {
    const demo = require('./demo');
    const bundle = demo.generate();
    const report = importer.validate({ ...bundle, accounts: demo.DEMO_ACCOUNTS });
    if (!report.ok) {
      report.errors.forEach(e => console.error('  ERROR    ' + e));
      process.exit(1);
    }
    await store.importBundle(report.bundle);
    const accounts = await auth.provisionAccounts(store, demo.DEMO_ACCOUNTS);
    console.log(`\n  Loaded the sample school: ${report.summary.students} students, ${report.summary.staff} staff.`);
    console.log(`  Accounts: ${accounts.created} created, ${accounts.skipped} already existed.`);
    console.log('  Every demo account uses the password "demo" — change them before this is reachable.\n');
    return;
  }

  if (cmd === 'export') {
    const file = args[0];
    if (!file) usage(1);
    const data = await store.exportAll();
    /* Accounts are deliberately not exported: the hashes are useless to a
       reader and a leaked dump should not hand anyone the login table. A
       re-import creates accounts from the file's own `accounts` list. */
    fs.writeFileSync(path.resolve(file), JSON.stringify(data, null, 2));
    const size = (fs.statSync(path.resolve(file)).size / 1024).toFixed(0);
    console.log(`\n  Wrote ${file} — ${size} KB`);
    console.log(`  School    : ${data.school ? data.school.name : '(not provisioned)'}`);
    console.log(`  Students  : ${(data.students || []).length}`);
    console.log(`  Note      : accounts are not included; add an "accounts" list to re-create sign-ins.\n`);
    return;
  }

  if (cmd === 'status') {
    const [school, users] = await Promise.all([store.getSchool(), store.countUsers()]);
    const data = await store.exportAll();
    console.log(`\n  Adapter   : ${store.describe()}`);
    console.log(`  School    : ${school ? school.name : '(not provisioned)'}`);
    console.log(`  Accounts  : ${users}`);
    console.log(`  Students  : ${(data.students || []).length}`);
    console.log(`  Staff     : ${(data.staff || []).length}`);
    console.log(`  Receipts  : ${(data.receipts || []).length}\n`);
    return;
  }

  usage(cmd ? 1 : 0);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('\n  Failed:', err.message, '\n'); process.exit(1); });
