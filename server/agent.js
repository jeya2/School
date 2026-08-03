/* ============================================================
   agent.js — the voice agent's brain, server-side only
   ------------------------------------------------------------
   The browser sends: what the user said + what the current screen
   can do. Gemini decides which of those affordances to invoke and
   returns function calls. The browser executes them locally.

   Provider: Google Gemini (@google/genai), on the free tier.
   Chosen for cost — this is a school in Erode, and a per-utterance
   frontier-model bill is not something a Tamil Nadu school can carry.
   Everything provider-specific lives in this one file; the prompt,
   the tool contract and the screen-manifest format are portable.

   Two properties this design is built around:

   1. THE API KEY NEVER REACHES THE BROWSER. A static page cannot
      hold an API key — view-source is all it takes. Everything
      that touches the key runs here.

   2. NO STUDENT DATA IS SENT. The model receives the page's
      *control inventory* — field names, filter options, buttons —
      never the records behind them. Asked for "class X students
      absent today", it replies "set class=X, status=absent" and
      the browser filters its own local data. Under the DPDP Act
      every student here is a child; keeping their records out of
      third-party API calls is the whole point of this split.
      It matters more on a free tier, whose terms permit the
      provider to train on what you send.
   ============================================================ */

const { GoogleGenAI } = require('@google/genai');

/* Flash-Lite is the cheapest model with the largest free-tier daily allowance,
   and this task — pick one option from an explicit menu — does not need a bigger
   one. Measured against the full-dictation case ("Karthik Raja, father Murugesan,
   born twelfth March two thousand ten, M B C, Tamil medium, standard ten A,
   phone nine eight four three…"), this scored 8/8 fields at ~800ms.
   Override with GEMINI_MODEL. */
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

/* ---------- the actions the browser knows how to perform ---------- */
const TOOLS = [
  {
    name: 'navigate',
    description:
      'Move to a different screen in the application. Use when the user asks to open, show, or go to a ' +
      'named page. Only use route ids listed in the current screen context.',
    input_schema: {
      type: 'object',
      properties: {
        route: { type: 'string', description: 'The route id to open, exactly as listed in available_routes.' }
      },
      required: ['route']
    }
  },
  {
    name: 'click',
    description:
      'Activate a button, link or action on the current screen. Use for things like opening the portal, ' +
      'saving a form, marking all present, or exporting. Only use action ids listed in the current screen context.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'The action id to activate, exactly as listed in available_actions.' },
        argument: {
          type: 'string',
          description:
            'Only for actions whose listing says they take an argument. Supply it in exactly the format that ' +
            'listing asks for. Omit entirely for every other action.'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'set_controls',
    description:
      'Set one or more inputs, filters or form fields on the current screen. Use this for both filling in a ' +
      'form and for narrowing a list — e.g. a question like "which class X students are absent today" is ' +
      'answered by setting the class filter to X and the status filter to absent. Set every control the ' +
      'request implies in a single call.',
    input_schema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          description: 'The controls to set.',
          items: {
            type: 'object',
            properties: {
              control: { type: 'string', description: 'The control id, exactly as listed in available_controls.' },
              value: {
                type: 'string',
                description:
                  'The value to set. For a control with options, use one of its option values verbatim. ' +
                  'For a date, use YYYY-MM-DD. For a checkbox, use "true" or "false".'
              }
            },
            required: ['control', 'value']
          }
        }
      },
      required: ['updates']
    }
  },
  {
    name: 'respond',
    description:
      'Speak a reply to the user without changing the screen. Use when the user asks something you can answer ' +
      'from the screen context, when you need them to clarify, or to explain why you could not do what they asked. ' +
      'Keep it to one or two short sentences — it is read aloud.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'What to say. One or two short spoken sentences.' }
      },
      required: ['message']
    }
  }
];

/* Gemini takes plain JSON Schema under `parametersJsonSchema`, so the tool
   contract above stays provider-neutral and only the wrapper changes. */
const geminiTools = [{
  functionDeclarations: TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.input_schema
  }))
}];

/* ---------- the operating instructions ---------- */
function systemPrompt() {
  return [
    'You operate a school management web application by voice for New Gen Higher Secondary School, a Tamil Nadu',
    'state-board school in Erode. The user speaks; you decide which on-screen controls to use.',
    '',
    'You are given the current screen and everything it can do. Work only from that inventory:',
    'never invent a route, action or control id, and never guess an option value that is not listed.',
    '',
    'Always answer by calling one or more functions. Never reply with plain text alone — if you have nothing',
    'to operate, call respond.',
    '',
    'How to interpret requests:',
    '- "Open the portal", "show me attendance alerts", "go to fees" are navigation or a button click.',
    '- A question that narrows a list ("which class X students are absent today", "show me the MBC girls',
    '  in eleven") is answered by setting filters, not by talking. Set every filter the question implies,',
    '  in one set_controls call, then let the screen show the result.',
    '- Dictated data ("father name is such-and-such", "date of birth twelfth March two thousand ten") is a',
    '  set_controls call on the matching form fields. Convert spoken forms to stored forms yourself:',
    '  dates to YYYY-MM-DD, spoken digit strings to digits, "standard ten" to the class value "X",',
    '  "o positive" to the blood group "O+". Names are Tamil — title-case them and do not anglicise them.',
    '- Several instructions in one utterance become several function calls. Do all of them.',
    '',
    'Rules:',
    '- Prefer acting over asking. If a request maps cleanly onto the screen, just do it.',
    '- If it does not map onto anything available, use respond to say so plainly and name what is possible',
    '  here. Do not silently do nothing.',
    '- If a request is ambiguous in a way that changes the outcome, use respond to ask one short question.',
    '- You never see student records — only the shape of the screen. If asked for a figure you cannot see,',
    '  set the filters that would reveal it rather than guessing a number.',
    '- The user is a school clerk or teacher mid-task. Anything you say is read aloud, so keep it short.'
  ].join('\n');
}

/* Render the screen the model is looking at. Controls and their option
   values only — no rows, no records, no names. */
function screenContext(ctx = {}) {
  const lines = [];
  lines.push(`current_screen: ${ctx.screen || 'unknown'}`);
  if (ctx.description) lines.push(`screen_description: ${ctx.description}`);
  if (ctx.role) lines.push(`signed_in_as: ${ctx.role}`);

  if (ctx.routes?.length) {
    lines.push('', 'available_routes:');
    ctx.routes.forEach(r => lines.push(`  - id: ${r.id} | ${r.label}`));
  }
  if (ctx.actions?.length) {
    lines.push('', 'available_actions:');
    ctx.actions.forEach(a => {
      let line = `  - id: ${a.id} | ${a.label}`;
      if (a.arg) line += ` | takes an argument: ${a.arg}`;
      if (a.hint) line += ` — ${a.hint}`;
      lines.push(line);
    });
  }
  if (ctx.controls?.length) {
    lines.push('', 'available_controls:');
    ctx.controls.forEach(c => {
      let line = `  - id: ${c.id} | ${c.label} | type: ${c.type}`;
      if (c.options?.length) line += ` | options: ${c.options.join(', ')}`;
      if (c.value) line += ` | currently: ${c.value}`;
      if (c.hint) line += ` — ${c.hint}`;
      lines.push(line);
    });
  }
  return lines.join('\n');
}

/** Prior turns, in the shape Gemini's `contents` expects. */
function toContents(history, utterance, context) {
  const out = [];
  history.slice(-6).forEach(h => out.push({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(h.content ?? '') }]
  }));
  out.push({
    role: 'user',
    parts: [{
      text: `<screen>\n${screenContext(context)}\n</screen>\n\nThe user said: "${utterance}"`
    }]
  });
  return out;
}

/* The request, minus the parts a given model may refuse. */
function baseConfig() {
  return {
    systemInstruction: systemPrompt(),
    tools: geminiTools,
    /* The model must choose a function rather than chatting back — this is a
       control surface, not a conversation. `respond` is one of the functions,
       so it can still speak when speaking is the right answer. */
    toolConfig: { functionCallingConfig: { mode: 'ANY' } },
    maxOutputTokens: 2048,
    temperature: 0
  };
}

/* Turning thinking off saves free-tier tokens on what is only a menu-selection
   task — but newer Gemini models reject `thinkingBudget: 0` outright, the same
   way Claude Opus 5 stopped allowing it. Rather than hard-code which models
   accept it (a list that goes stale the moment Google ships another), ask for
   it and drop it if the request comes back as invalid. Model IDs churn fast
   enough here that self-healing beats a lookup table. */
const OPTIONAL = { thinkingConfig: { thinkingBudget: 0 } };
const isInvalidArgument = e =>
  e?.status === 400 || /INVALID_ARGUMENT|invalid argument/i.test(String(e?.message || ''));

/* ---------- one turn ---------- */
async function decide({ utterance, context, history = [], client }) {
  const genai = client || new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const contents = toContents(history, utterance, context);

  let response;
  try {
    response = await genai.models.generateContent({
      model: MODEL, contents, config: { ...baseConfig(), ...OPTIONAL }
    });
  } catch (err) {
    if (!isInvalidArgument(err)) throw err;
    response = await genai.models.generateContent({
      model: MODEL, contents, config: baseConfig()
    });
  }

  const calls = (response.functionCalls || [])
    .filter(c => c.name)
    .map(c => ({ tool: c.name, input: c.args || {} }));

  /* Only read `.text` when there are no function calls — the SDK logs a warning
     otherwise, and with mode:'ANY' a function call is the normal outcome. */
  const said = calls.length ? '' : String(response.text || '').trim();
  const u = response.usageMetadata || {};

  return {
    calls,
    text: said,
    stop_reason: response.candidates?.[0]?.finishReason || null,
    usage: {
      input: u.promptTokenCount ?? 0,
      output: u.candidatesTokenCount ?? 0,
      total: u.totalTokenCount ?? 0
    }
  };
}

module.exports = { decide, TOOLS, MODEL, systemPrompt, screenContext, toContents };
