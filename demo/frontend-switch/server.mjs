import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const version = process.argv[2]?.toLowerCase();
const port = Number(process.env.PORT || (version === 'b' ? 8082 : 8081));
if (!['a', 'b'].includes(version) || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Usage: PORT=8081 node demo/frontend-switch/server.mjs a|b (defaults: A=8081, B=8082)');
  process.exit(1);
}
const directory = new URL(`./${version}/`, import.meta.url);
http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/' ? 'index.html' : path === '/app.js' ? 'app.js' : null;
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const content = await readFile(fileURLToPath(new URL(file, directory)));
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(content);
  } catch { res.writeHead(500); res.end('Unable to load demo'); }
}).listen(port, '127.0.0.1', () => console.log(`Demo ${version.toUpperCase()}: http://127.0.0.1:${port}`));
