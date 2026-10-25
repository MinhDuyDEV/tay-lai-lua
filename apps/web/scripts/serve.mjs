// A tiny static server for `task web:preview`. No dependency: serve apps/web/out, with `/thi`
// resolving to `thi/index.html` (Next's `trailingSlash` export) and `.wasm` served as
// application/wasm so `WebAssembly.instantiateStreaming`-style fetches are typed correctly.
//
//   node scripts/serve.mjs [--dir apps/web/out] [--port 4173]

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const root = resolve(argOf('dir', 'out'));
const port = Number(argOf('port', '4173'));

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

if (!existsSync(root)) {
  console.error(`serve: ${root} does not exist — run \`task web:build\` first`);
  process.exit(1);
}

/** Resolve a URL path inside the root, or null if it escapes it. */
function inside(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0]));
  const full = join(root, clean);
  const relay = resolve(full);
  if (relay !== root && !relay.startsWith(root + sep)) return null;
  return relay;
}

function find(urlPath) {
  const direct = inside(urlPath);
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
  const asDir = inside(`${urlPath.replace(/\/$/, '')}/index.html`);
  if (asDir && existsSync(asDir) && statSync(asDir).isFile()) return asDir;
  return null;
}

createServer((req, res) => {
  const url = req.url ?? '/';
  let file = find(url);
  if (!file && url === '/') file = find('/thi/index.html');
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`404 ${url}\n`);
    return;
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`serving ${root}`);
  console.log(`  http://localhost:${port}/thi`);
});
