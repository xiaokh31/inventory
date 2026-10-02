const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('../server/config.cjs').loadEnv();
const { handler } = require('../server/http.cjs');
const { closeStore } = require('../server/database.cjs');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return void handler(req, res);
  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    res.writeHead(404); res.end('Not found'); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  fs.createReadStream(path.join(root, 'index.html')).pipe(res);
}).listen(port, host, () => console.log(`Warehouse: http://${host}:${port}`));
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(async () => { await closeStore(); process.exit(0); });
  setTimeout(() => process.exit(1), 9000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
