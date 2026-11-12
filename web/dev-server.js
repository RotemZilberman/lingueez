import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import handler from './api/index.js';

const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/favicon.ico': ['favicon.ico', 'image/x-icon'],
  '/favicon-32.png': ['favicon-32.png', 'image/png'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png']
};

http.createServer(async (req, res) => {
  if (req.url.startsWith('/api')) return handler(req, res);
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const item = files[pathname];
  if (!item) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': item[1], 'Cache-Control': 'no-store' });
  res.end(await readFile(resolve(import.meta.dirname, item[0])));
}).listen(process.env.PORT || 3000, () => console.log(`Lingueez web on http://localhost:${process.env.PORT || 3000}`));
