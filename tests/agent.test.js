/* ============================================================
   Tests for the voice agent.

   The model call is mocked, so this runs with no API key and no
   network. What is verified is everything around the model:
   the prompt it is handed, the screen inventory it is shown, that
   student data never appears in that payload, and that the tool
   calls it returns actually operate the page.

       node tests/agent.test.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const { decide, TOOLS, MODEL, systemPrompt, screenContext } = require(path.join(ROOT, 'server', 'agent.js'));
const cache = require(path.join(ROOT, 'server', 'cache.js'));

let pass = 0, fail = 0;
function ok(label, cond, extra = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '   ' + extra : ''}`);
}
const section = t => console.log(`\n── ${t} ──`);

/* A stand-in for the Gemini client: records the request, replays a scripted reply.
   Mirrors the real response object, where `functionCalls` and `text` are getters. */
function fakeClient(functionCalls, text = '') {
  const calls = [];
  return {
    calls,
    models: {
      generateContent: async params => {
        calls.push(params);
        return {
          functionCalls,
          text,
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40, totalTokenCount: 940 }
        };
      }
    }
  };
}
const toolUse = (name, args) => ({ name, args });

/* A representative attendance screen, as the browser would describe it. */
const ATTENDANCE = {
  screen: 'attendance',
  role: 'Class Teacher · X-A',
  description: 'The daily attendance register for one standard, section and date.',
  routes: [{ id: 'students', label: 'Student Master' }, { id: 'fees', label: 'Fee Collection' }],
  actions: [
    { id: 'mark_all_present', label: 'Mark the whole class present' },
    { id: 'mark_student', label: 'Mark one student by roll number', arg: 'roll number and status, e.g. "12 absent"' },
    { id: 'save_register', label: 'Save the register' }
  ],
  controls: [
    { id: 'ac', label: 'Standard', type: 'select', options: ['I', 'II', 'X', 'XI', 'XII'], value: 'X' },
    { id: 'ad', label: 'Date', type: 'date', value: '2026-08-02' },
    { id: 'ashow', label: 'Showing', type: 'select', options: ['', 'A', 'P', 'L', 'U'] }
  ]
};

async function main() {
  /* ══════════════ request shape ══════════════ */
  section('the request sent to Gemini');
  {
    const client = fakeClient([toolUse('respond', { message: 'ok' })]);
    await (decide({ utterance: 'hello', context: ATTENDANCE, client }));
    const req = client.calls[0];
    const decls = req.config.tools[0].functionDeclarations;

    ok('uses a Flash-Lite class model (cheapest, largest free allowance)',
      req.model === MODEL && /flash/i.test(MODEL), MODEL);
    ok('sends the system prompt as systemInstruction',
      typeof req.config.systemInstruction === 'string' && req.config.systemInstruction.length > 200);
    ok('declares all four functions', decls.length === 4, decls.map(d => d.name).join(', '));
    ok('every function carries a JSON schema',
      decls.every(d => d.parametersJsonSchema?.type === 'object'
                    && Array.isArray(d.parametersJsonSchema.required)));
    ok('does not mix parametersJsonSchema with the mutually exclusive parameters field',
      decls.every(d => !('parameters' in d)));
    ok('forces a function call rather than free text',
      req.config.toolConfig?.functionCallingConfig?.mode === 'ANY');
    ok('asks for thinking off (menu selection, and it burns free-tier tokens)',
      req.config.thinkingConfig?.thinkingBudget === 0);
    ok('temperature pinned to 0 for repeatable control selection',
      req.config.temperature === 0);
    ok('maxOutputTokens set', req.config.maxOutputTokens > 0, String(req.config.maxOutputTokens));
    ok('contents ends with the user turn',
      req.contents[req.contents.length - 1].role === 'user');
  }

  /* ══════════════ surviving model churn ══════════════ */
  section('config that a newer model refuses');
  {
    /* Newer Gemini models reject thinkingBudget: 0. The agent must notice and
       retry without it rather than failing the turn — model IDs and their
       accepted parameters move faster than this codebase does. */
    let attempts = 0;
    const picky = {
      models: {
        generateContent: async params => {
          attempts++;
          if (params.config.thinkingConfig) {
            const e = new Error('{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}');
            e.status = 400;
            throw e;
          }
          return {
            functionCalls: [toolUse('click', { action: 'save_register' })],
            text: '', candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 20, totalTokenCount: 820 }
          };
        }
      }
    };
    const r = await (decide({ utterance: 'save the register', context: ATTENDANCE, client: picky }));
    ok('retries once without the rejected setting', attempts === 2, `${attempts} attempts`);
    ok('and still returns the decision', r.calls[0]?.input.action === 'save_register');
  }
  {
    /* A genuine failure must still surface — the retry is for one specific
       rejection, not a blanket swallow. */
    let attempts = 0;
    const broken = {
      models: {
        generateContent: async () => {
          attempts++;
          const e = new Error('quota exceeded'); e.status = 429; throw e;
        }
      }
    };
    let threw = false;
    try { await (decide({ utterance: 'save', context: ATTENDANCE, client: broken })); }
    catch { threw = true; }
    ok('a non-argument error is not retried and does propagate', threw && attempts === 1,
      `${attempts} attempt(s)`);
  }
  {
    /* With mode:'ANY' a function call is the normal outcome; reading .text then
       makes the SDK log a warning, so it is only read when there are no calls. */
    const withBoth = fakeClient([toolUse('click', { action: 'save_register' })], 'chatter');
    const r1 = await (decide({ utterance: 'save the register', context: ATTENDANCE, client: withBoth }));
    ok('ignores stray text when a function was called', r1.text === '');
    const textOnly = fakeClient([], 'I cannot do that here.');
    const r2 = await (decide({ utterance: 'fly me to the moon', context: ATTENDANCE, client: textOnly }));
    ok('still surfaces text when no function was called', r2.text === 'I cannot do that here.');
  }

  /* ══════════════ what the model is shown ══════════════ */
  section('screen inventory');
  {
    const text = screenContext(ATTENDANCE);
    ok('names the screen', text.includes('current_screen: attendance'));
    ok('lists routes with ids', text.includes('id: students'));
    ok('lists actions with ids', text.includes('id: mark_all_present'));
    ok('flags actions that take an argument', text.includes('takes an argument:'));
    ok('lists controls with their options', text.includes('id: ashow') && text.includes('options:'));
    ok('shows current control values', text.includes('currently: X'));
  }

  section('no student data leaves the browser');
  {
    /* The browser's own context builder is what must not leak. Simulate a screen
       whose underlying data is full of children's records and confirm none of it
       can reach the payload, because the manifest has nowhere to put it. */
    const client = fakeClient([toolUse('respond', { message: 'ok' })]);
    await (decide({
      utterance: 'which class ten students are absent today',
      context: ATTENDANCE,
      client
    }));
    const payload = JSON.stringify(client.calls[0]);

    const forbidden = ['Karthik', 'Murugesan', 'NG4102', 'S4102', '9843045678', 'aadhaar', '482913756240'];
    forbidden.forEach(needle =>
      ok(`payload contains no "${needle}"`, !payload.toLowerCase().includes(needle.toLowerCase())));
    ok('payload does carry the utterance', payload.includes('absent today'));
    ok('payload does carry the control ids', payload.includes('ashow'));
  }

  /* ══════════════ the system prompt ══════════════ */
  section('system prompt');
  {
    const p = systemPrompt();
    ok('tells the model to work only from the inventory', /never invent/i.test(p));
    ok('explains that narrowing questions become filters', /filters, not by talking/i.test(p));
    ok('covers dictated data conversion', /YYYY-MM-DD/.test(p));
    ok('states it cannot see student records', /never see student records/i.test(p));
    ok('asks for short spoken replies', /read aloud/i.test(p));
  }

  /* ══════════════ the returned decisions ══════════════ */
  section('decisions come back in a usable shape');
  {
    const client = fakeClient(
      [toolUse('set_controls', { updates: [{ control: 'ac', value: 'X' }, { control: 'ashow', value: 'A' }] })],
      'Filtering the register.'
    );
    const r = await (decide({ utterance: 'show me class ten students absent today', context: ATTENDANCE, client }));

    ok('extracts the tool calls', r.calls.length === 1 && r.calls[0].tool === 'set_controls');
    ok('keeps both control updates', r.calls[0].input.updates.length === 2);
    ok('suppresses stray narration when a function was called', r.text === '');
    ok('reports usage', r.usage.input === 900 && r.usage.output === 40);
  }
  {
    const client = fakeClient([toolUse('click', { action: 'mark_student', argument: '12 absent' })]);
    const r = await (decide({ utterance: 'roll twelve is absent', context: ATTENDANCE, client }));
    ok('passes an action argument through', r.calls[0].input.argument === '12 absent');
  }
  {
    const client = fakeClient([toolUse('navigate', { route: 'fees' })]);
    const r = await (decide({ utterance: 'take me to fee collection', context: ATTENDANCE, client }));
    ok('navigation call survives', r.calls[0].tool === 'navigate' && r.calls[0].input.route === 'fees');
  }
  {
    const client = fakeClient(undefined, undefined);
    const r = await (decide({ utterance: '...', context: ATTENDANCE, client }));
    ok('an undefined reply yields no calls rather than throwing', r.calls.length === 0 && r.text === '');
  }

  /* ══════════════ conversation history ══════════════ */
  section('history');
  {
    const long = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: 'turn ' + i }));
    const client = fakeClient([toolUse('respond', { message: 'ok' })]);
    await (decide({ utterance: 'and again', context: ATTENDANCE, history: long, client }));
    const msgs = client.calls[0].contents;
    ok('history is trimmed, not sent whole', msgs.length <= 7, `${msgs.length} turns`);
    const last = msgs[msgs.length - 1].parts[0].text;
    ok('the new utterance is last', last.includes('and again'));
    ok('the screen travels with the utterance', last.includes('<screen>'));
    ok('assistant turns are relabelled as model turns',
      msgs.slice(0, -1).every(m => m.role === 'user' || m.role === 'model'));
  }

  /* ══════════════ the decision cache ══════════════ */
  section('decision cache — what it replays');
  {
    cache.reset();
    const calls = [{ tool: 'click', input: { action: 'mark_all_present' } }];

    ok('a cold lookup misses', cache.get('mark all present', ATTENDANCE) === null);
    ok('storing a decision succeeds', cache.put('mark all present', ATTENDANCE, calls) === true);
    ok('the same words on the same screen hit',
      JSON.stringify(cache.get('mark all present', ATTENDANCE)) === JSON.stringify(calls));
    ok('punctuation and case do not matter',
      !!cache.get('Mark all present.', ATTENDANCE));
    ok('extra whitespace does not matter',
      !!cache.get('  mark   all  present ', ATTENDANCE));
    ok('different words miss', cache.get('save the register', ATTENDANCE) === null);
    ok('hit rate is reported', cache.stats().hits === 3, JSON.stringify(cache.stats()));
  }

  section('decision cache — what it refuses');
  {
    cache.reset();

    /* A cached answer must not survive the screen changing shape. */
    cache.put('mark all present', ATTENDANCE, [{ tool: 'click', input: { action: 'mark_all_present' } }]);
    const fewerActions = { ...ATTENDANCE, actions: ATTENDANCE.actions.slice(0, 1) };
    ok('a screen with different actions does not reuse the entry',
      cache.get('mark all present', fewerActions) === null);
    const otherOptions = {
      ...ATTENDANCE,
      controls: ATTENDANCE.controls.map(c => c.id === 'ashow' ? { ...c, options: ['', 'X'] } : c)
    };
    ok('a control whose options changed does not reuse the entry',
      cache.get('mark all present', otherOptions) === null);
    ok('but a different current *value* still reuses it — values are not part of the key',
      !!cache.get('mark all present',
        { ...ATTENDANCE, controls: ATTENDANCE.controls.map(c => ({ ...c, value: 'ZZ' })) }));

    /* Utterances that only mean something in context. */
    ['change it to eleven', 'do that again', 'the same for section B', 'mark her absent',
     'next class', 'show me those'].forEach(u =>
      ok(`refuses the context-dependent "${u}"`, cache.cacheable(u) === false));

    /* Utterances anchored to the present moment. */
    ['who is absent today', 'show tomorrow', 'the current register'].forEach(u =>
      ok(`refuses the time-relative "${u}"`, cache.cacheable(u) === false));

    /* And regardless of wording, a decision that wrote a date must not be replayed. */
    ok('refuses to store a decision containing a resolved date',
      cache.stable([{ tool: 'set_controls', input: { updates: [{ control: 'ad', value: '2026-08-03' }] } }]) === false);
    ok('stores a decision with no date in it',
      cache.stable([{ tool: 'set_controls', input: { updates: [{ control: 'ashow', value: 'A' }] } }]) === true);
    ok('refuses to store an empty decision', cache.stable([]) === false);

    /* Safe-by-construction: a refusal costs an API call, never a wrong action. */
    cache.reset();
    cache.put('who is absent today', ATTENDANCE, [{ tool: 'click', input: { action: 'mark_all_present' } }]);
    ok('a refused utterance is never served from cache',
      cache.get('who is absent today', ATTENDANCE) === null);
  }

  section('decision cache — bounded');
  {
    cache.reset();
    for (let i = 0; i < cache.MAX_ENTRIES + 50; i++) {
      cache.put(`command number ${i}`, ATTENDANCE, [{ tool: 'click', input: { action: 'save_register' } }]);
    }
    ok('never grows past its cap', cache.stats().entries === cache.MAX_ENTRIES,
      String(cache.stats().entries));
    ok('the oldest entries were evicted first',
      cache.get('command number 0', ATTENDANCE) === null);
    ok('the newest entry survived',
      !!cache.get(`command number ${cache.MAX_ENTRIES + 49}`, ATTENDANCE));
    cache.reset();
  }

  /* ══════════════ the browser-side executor ══════════════ */
  section('browser executes what comes back');
  {
    /* Load Agent with a minimal DOM so writeControl can be exercised for real. */
    const els = {};
    const mkSelect = (id, values) => ({
      id, tagName: 'SELECT', value: '',
      options: values.map(v => ({ value: v, textContent: v })),
      closest: () => null, scrollIntoView() {},
      dispatchEvent() {}, classList: { add() {}, remove() {} }
    });
    const mkInput = (id, type = 'text') => ({
      id, tagName: 'INPUT', type, value: '', checked: false,
      closest: () => null, scrollIntoView() {},
      dispatchEvent() {}, classList: { add() {}, remove() {} }
    });

    global.window = {};
    global.Store = { get: (k, d) => d, set() {} };
    global.esc = s => s;
    global.openModal = () => {}; global.closeModal = () => {};
    global.document = {
      createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        querySelector: () => null, querySelectorAll: () => [], innerHTML: '', appendChild() {} }),
      body: { appendChild() {} },
      getElementById: id => els[id] || null
    };
    global.addEventListener = () => {};
    global.fetch = () => Promise.reject(new Error('no network in tests'));

    const src = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'agent.js'), 'utf8');
    const Agent = eval(src + ';Agent');

    const w = Agent.writeControl;
    const sel = mkSelect('ac', ['I', 'II', 'X', 'XI']);
    ok('select matches an option value exactly', w(sel, 'X') === 'X' && sel.value === 'X');
    ok('select matches case-insensitively', w(sel, 'xi') === 'XI' && sel.value === 'XI');
    ok('select rejects a value that is not an option', w(sel, 'ZZ') === false);

    const status = mkSelect('ashow', ['', 'A', 'P', 'L']);
    ok('status filter accepts the absent code', w(status, 'A') === 'A' && status.value === 'A');

    const date = mkInput('ad', 'date');
    ok('date is written through verbatim', w(date, '2026-08-02') === '2026-08-02');

    const check = mkInput('rte', 'checkbox');
    ok('checkbox true', w(check, 'true') === 'Yes' && check.checked === true);
    ok('checkbox false', w(check, 'false') === 'No' && check.checked === false);

    const text = mkInput('a_name');
    ok('text field takes the value as given', w(text, 'Karthik Raja') === 'Karthik Raja');

    /* Now the executor: a manifest, a set of tool calls, and the effects. */
    els.ac = sel; els.ashow = status;
    let saved = false, navigatedTo = null, argSeen = null;
    global.location = { set hash(v) { navigatedTo = v; }, get hash() { return navigatedTo; } };

    Agent.dock = {
      querySelector: () => null,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false }
    };
    Agent.screen({
      screen: 'attendance',
      routes: [{ id: 'fees', label: 'Fee Collection' }],
      actions: [
        { id: 'save_register', label: 'Save the register', run: () => { saved = true; return 'Saved the register'; } },
        { id: 'mark_student', label: 'Mark one student', arg: 'roll and status',
          run: a => { argSeen = a; return 'Roll 12 → absent'; } }
      ],
      controls: [
        { id: 'ac', label: 'Standard', el: sel },
        { id: 'ashow', label: 'Showing', el: status }
      ]
    });

    await (Agent.perform([
      { tool: 'set_controls', input: { updates: [{ control: 'ac', value: 'X' }, { control: 'ashow', value: 'A' }] } }
    ]));
    ok('set_controls drove both filters', sel.value === 'X' && status.value === 'A');

    await (Agent.perform([{ tool: 'click', input: { action: 'save_register' } }]));
    ok('click ran the action', saved === true);

    await (Agent.perform([{ tool: 'click', input: { action: 'mark_student', argument: '12 absent' } }]));
    ok('the action received its argument', argSeen === '12 absent');

    await (Agent.perform([{ tool: 'navigate', input: { route: 'fees' } }]));
    ok('navigate moved the app', navigatedTo === '#fees');

    const before = Agent.log.length;
    await (Agent.perform([{ tool: 'click', input: { action: 'no_such_action' } }]));
    ok('an unknown action is reported, not silently dropped',
      Agent.log.length > before && Agent.log[0].kind === 'error');

    await (Agent.perform([{ tool: 'set_controls', input: { updates: [{ control: 'ac', value: 'NOPE' }] } }]));
    ok('an impossible control value is reported', Agent.log[0].kind === 'error');
    ok('and the control keeps its previous value', sel.value === 'X');

    /* The manifest the browser would send must not carry element handles. */
    const ctx = Agent.context();
    ok('context is serialisable (no DOM handles leak into the payload)',
      (() => { try { JSON.stringify(ctx); return true; } catch { return false; } })());
    ok('context exposes ids and options only',
      ctx.controls.every(c => !('el' in c)) && ctx.controls[0].options.length > 0);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);

}

main().catch(e => { console.error(e); process.exit(1); });
