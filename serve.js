/* ============================================================
   Minimal zero-dependency static server.

       node serve.js            → http://localhost:5490
       node serve.js 8080       → http://localhost:8080

   Why not just open index.html from disk? Chrome will not grant
   microphone access on a file:// origin, so the voice engine cannot
   start. http://localhost is a secure context and works normally.
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 5490;
const ROOT = __dirname;

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

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  // keep requests inside the project directory
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>404</h1><p>${rel} not found.</p><p><a href="/">Back to the school site</a></p>`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
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
  console.log(`\n  New Gen Higher Secondary School — portal running\n`);
  console.log(`    http://localhost:${PORT}\n`);
  console.log(`  Use Chrome or Edge so the voice engine has the Web Speech API.`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
