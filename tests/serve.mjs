/* Minimal static server for local runs (`npm start`) and the e2e suite. No dependencies. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
  '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json', '.json':'application/json' };

export function startServer(port = 0, host = '127.0.0.1'){
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(port, host, () => {
    const { port: p } = server.address();
    resolve({ url: `http://${host}:${p}/`, port: p, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }) });
  }));
}

if (process.argv[1] === import.meta.filename){
  const { url } = await startServer(Number(process.env.PORT) || 8080, 'localhost');
  console.log(`Battery monitor: ${url}`);
}
