/* ============================================================
   Regression tests for the voice.js value parsers.
   No dependencies — run with:   node tests/voice-parser.test.js
   ============================================================ */
const fs = require('fs');
const path = require('path');

/* voice.js expects a browser; give it just enough to evaluate. */
global.window = {};
global.Store = { get: (k, d) => d, set: () => {} };
global.fmtDate = s => s;
global.esc = s => s;
global.toast = () => {};
global.openModal = () => {};
global.document = { createElement: () => ({ style: {} }), body: { appendChild: () => {} } };
global.addEventListener = () => {};

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'voice.js'), 'utf8');
const Voice = eval(src + ';Voice');
const P = Voice.parse;

let pass = 0, fail = 0;
function t(label, got, want) {
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(48)} ${JSON.stringify(got)}${ok ? '' : '   expected ' + JSON.stringify(want)}`);
}

console.log('\n── numbers (marks, amounts) ──');
t('eighty seven',              P.wordsToNumber('eighty seven'), 87);
t('ninety two',                P.wordsToNumber('ninety two'), 92);
t('nine hundred fifty',        P.wordsToNumber('nine hundred fifty'), 950);
t('one hundred',               P.wordsToNumber('one hundred'), 100);
t('twelve',                    P.wordsToNumber('twelve'), 12);
t('bare digits "45"',          P.wordsToNumber('45'), 45);
t('twenty five thousand',      P.wordsToNumber('twenty five thousand'), 25000);
t('one lakh fifty thousand',   P.wordsToNumber('one lakh fifty thousand'), 150000);
t('zero',                      P.wordsToNumber('zero'), 0);
t('not a number at all',       P.wordsToNumber('karthik raja'), null);

console.log('\n── digit strings (phone, Aadhaar) ──');
t('nine eight four three',     P.digitsOnly('nine eight four three'), '9843');
t('"double one" shorthand',    P.digitsOnly('nine eight four three double one two three'), '98431123');
t('"triple seven"',            P.digitsOnly('triple seven'), '777');
t('ten-digit mobile',          P.digitsOnly('9 8 4 three zero four five six seven eight'), '9843045678');

console.log('\n── dates ──');
t('twelfth march two thousand ten', P.parseDate('twelfth march two thousand ten'), '2010-03-12');
t('12 march 2010',             P.parseDate('12 march 2010'), '2010-03-12');
t('march 12 2010',             P.parseDate('march 12 2010'), '2010-03-12');
t('12/03/2010',                P.parseDate('12/03/2010'), '2010-03-12');
t('12-3-2010',                 P.parseDate('12-3-2010'), '2010-03-12');
t('5 august 2011',             P.parseDate('5 august 2011'), '2011-08-05');
t('first january two thousand twelve', P.parseDate('first january two thousand twelve'), '2012-01-01');
t('twenty-fifth form',         P.parseDate('twenty fifth june two thousand nine'), '2009-06-25');
t('"twenty ten" year form',    P.parseDate('twelfth march twenty ten'), '2010-03-12');
t('rejects a non-date',        P.parseDate('karthik raja'), null);

console.log('\n── spoken option forms (dropdowns) ──');
const best = (spoken, options) => {
  const s = P.norm(spoken), tight = s.replace(/\s/g, '');
  let win = null;
  options.forEach(o => {
    let c = 0;
    P.spokenForms(o).forEach(f => { c = Math.max(c, P.score(s, f), P.score(tight, f.replace(/\s/g, ''))); });
    if (!win || c > win.c) win = { o, c };
  });
  return win.c >= .5 ? win.o : null;
};
const CLS = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
const BG = ['A+','A-','B+','B-','O+','O-','AB+','AB-'];
const COMM = ['OC','BC','BCM','MBC','SC','ST'];

t('"ten" → class X',           best('ten', CLS), 'X');
t('"twelve" → class XII',      best('twelve', CLS), 'XII');
t('"plus two" → class XII',    best('plus two', CLS), 'XII');
t('"eighth" → class VIII',     best('eighth', CLS), 'VIII');
t('"o positive" → O+',         best('o positive', BG), 'O+');
t('"b negative" → B-',         best('b negative', BG), 'B-');
t('"a b positive" → AB+',      best('a b positive', BG), 'AB+');
t('"mbc" → MBC',               best('mbc', COMM), 'MBC');
t('"m b c" spelled out',       best('m b c', COMM), 'MBC');
t('"s c" → SC',                best('s c', COMM), 'SC');

console.log('\n── text shaping ──');
t('name title-casing',         P.titleCase('karthik raja'), 'Karthik Raja');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
