/* ============================================================
   serve.js — static server + the voice agent's API proxy

       node serve.js            → http://localhost:5490
       node serve.js 8080       → http://localhost:8080

   Two jobs:

   1. Serve the static app. Note this must be http://localhost —
      Chrome will not grant microphone access on a file:// origin,
      so opening index.html from disk leaves the agent deaf.

   2. Proxy POST /api/agent to the Gemini API. The API key is read
      from the environment here and never leaves this process — a
      static page cannot hold one safely, since view-source is all
      it takes to lift it.
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 5490;
const ROOT = __dirname;

/* ---------- .env ----------
   A shell variable set with `$env:X = ...` disappears when that window
   closes, which makes "set it and restart" a chore. If a .env file sits
   next to this script, read it — without overriding anything already
   set in the real environment. .env is gitignored; never commit a key. */
(function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) return;                                   // blank line or # comment
    const key = m[1];
    let val = m[2].trim().replace(/\s+#.*$/, '');     // strip a trailing comment
    if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);   // strip matching quotes
    if (!(key in process.env)) process.env[key] = val;
  });
})();

/* Never serve these over HTTP, whatever the URL says. */
const PRIVATE = ['server', 'node_modules', 'tests', '.git', '.env'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2'
};

const json = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
};

/* ---------- the agent endpoint ---------- */
/* MODEL comes from the agent module rather than being repeated here — the two
   drifted apart once already and the startup banner quietly reported a model
   that was not the one being called. */
let decide = null, AGENT_MODEL = null, agentLoadError = null;
try { ({ decide, MODEL: AGENT_MODEL } = require('./server/agent')); }
catch (e) { agentLoadError = e.message; }

const cache = require('./server/cache');

async function handleAgent(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  if (!decide) {
    return json(res, 500, {
      error: 'agent_unavailable',
      message: 'Could not load the agent module. Run `npm install` first.',
      detail: agentLoadError
    });
  }
  if (!process.env.GEMINI_API_KEY) {
    return json(res, 503, {
      error: 'no_api_key',
      message:
        'GEMINI_API_KEY is not set on the server. Put it in the .env file and restart. ' +
        'Everything else in the app works by keyboard in the meantime.'
    });
  }

  let raw = '';
  let tooBig = false;
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 512 * 1024) { tooBig = true; req.destroy(); }
  });

  req.on('end', async () => {
    if (tooBig) return;
    let body;
    try { body = JSON.parse(raw); }
    catch { return json(res, 400, { error: 'bad_json' }); }

    const utterance = String(body.utterance || '').slice(0, 2000).trim();
    if (!utterance) return json(res, 400, { error: 'empty_utterance' });

    const context = body.context || {};
    const started = Date.now();

    /* Has the model already decided this exact thing on this exact screen?
       Replaying costs nothing and spends no free-tier quota. */
    const remembered = cache.get(utterance, context);
    if (remembered) {
      console.log(`  agent  "${utterance.slice(0, 60)}" → ${remembered.map(c => c.tool).join(', ')}  [cached]`);
      return json(res, 200, {
        calls: remembered, text: '', stop_reason: 'cached', cached: true,
        usage: { input: 0, output: 0, total: 0 },
        cache: cache.stats()
      });
    }

    try {
      const result = await decide({
        utterance,
        context,
        history: Array.isArray(body.history) ? body.history : []
      });
      const stored = cache.put(utterance, context, result.calls);
      console.log(`  agent  "${utterance.slice(0, 60)}" → ${result.calls.map(c => c.tool).join(', ') || '(nothing)'}  ${Date.now() - started}ms${stored ? ' [remembered]' : ''}`);
      json(res, 200, { ...result, cached: false, cache: cache.stats() });
    } catch (err) {
      /* Turn provider errors into something the assistant can say out loud.
         The free tier's two real failure modes are a bad key and a spent quota,
         and both need to be distinguishable — "it stopped working" after 1,000
         requests is otherwise a genuinely baffling afternoon. */
      const status = err?.status ?? err?.code;
      const raw = String(err?.message || err);
      const quota = status === 429 || /quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(raw);
      const auth  = status === 401 || status === 403 || /API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(raw);

      const kind = quota ? 'rate_limit' : auth ? 'auth' : status >= 500 ? 'upstream' : 'error';
      const message =
        quota ? 'The free-tier limit has been reached. It resets after a minute, ' +
                'and the daily allowance resets at midnight Pacific time.'
        : auth ? 'The API key was rejected. Check GEMINI_API_KEY in the .env file and restart the server.'
        : kind === 'upstream' ? 'The model service is having trouble. Try again in a moment.'
        : raw;

      console.error(`  agent  FAILED (${kind}):`, raw);
      json(res, quota ? 429 : auth ? 401 : 502, { error: kind, message });
    }
  });
}

/* ---------- static files ---------- */
function handleStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  const normalised = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
  const first = normalised.split(/[\/\\]/).filter(Boolean)[0];
  if (PRIVATE.includes(first)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  const file = path.join(ROOT, normalised);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<h1>404</h1><p>${rel} not found.</p><p><a href="/">Back to the school site</a></p>`);
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/api/agent') return handleAgent(req, res);
  handleStatic(req, res);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use by another program.`);
    console.error(`  Start on a different one, e.g.:  node serve.js ${PORT + 1}\n`);
  } else {
    console.error('\n  Server error:', err.message, '\n');
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const keyed = !!process.env.GEMINI_API_KEY;
  const model = AGENT_MODEL || '(agent not loaded)';
  console.log(`\n  New Gen Higher Secondary School — portal running\n`);
  console.log(`    http://localhost:${PORT}\n`);
  console.log(`  Voice agent : ${keyed ? `ready — ${model}` : 'DISABLED — put GEMINI_API_KEY in .env and restart'}`);
  console.log(`  Browser     : use Chrome or Edge, and allow the microphone.`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
