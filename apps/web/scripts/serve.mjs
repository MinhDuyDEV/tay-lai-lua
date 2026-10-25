// A tiny static server: serve a static export, with `/thi` resolving to `thi/index.html` (Next's
// `trailingSlash` export) and `.wasm` typed as application/wasm. No dependency.
//
//   node scripts/serve.mjs [--dir out] [--port 4173]      (task web:preview)
// The end-to-end test imports `serve` instead of starting a second server of its own.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** Resolve a URL path inside the root, or null if it escapes it. */
function inside(root, urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0]));
  const full = join(root, clean);
  const relay = resolve(full);
  if (relay !== root && !relay.startsWith(root + sep)) return null;
  return relay;
}

function find(root, urlPath) {
  const direct = inside(root, urlPath);
  if (!direct) return null;
  if (existsSync(direct)) {
    const stat = statSync(direct);
    if (stat.isFile()) return direct;
    if (stat.isDirectory()) {
      const index = join(direct, 'index.html');
      if (existsSync(index)) return index;
    }
  }
  // `/thi` -> `/thi/index.html`, and `/thi/` -> `/thi/index.html`.
  const asDir = inside(root, `${urlPath.replace(/\/$/, '')}/index.html`);
  if (asDir && existsSync(asDir) && statSync(asDir).isFile()) return asDir;
  return null;
}

/** Start serving `dir` on 127.0.0.1 only; resolves with the server once it listens (port 0 picks a free one). */
export function serve(dir, port) {
  const root = resolve(dir);
  if (!existsSync(root)) throw new Error(`${root} does not exist — run \`task web:build\` first`);
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    const file = find(root, url);
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`404 ${url}\n`);
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => done(server));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const argOf = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const port = Number(argOf('port', '4173'));
  const server = await serve(argOf('dir', 'out'), port);
  console.log(`http://localhost:${server.address().port}/thi`);
}
