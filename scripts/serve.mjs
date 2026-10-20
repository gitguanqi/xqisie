#!/usr/bin/env node
// Dependency-free static server for the committed test pages and the tip pages.
// Replaces the previous `live-server` script, which required a global install.
//
// Usage:
//   node scripts/serve.mjs          serve on http://127.0.0.1:4001/test/
//   PORT=8080 node scripts/serve.mjs

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Every page a reviewer is expected to open. Kept exported so the browser
// runner and the server test share one list instead of drifting apart.
export const PAGES = [
  '/test/',
  '/test/browser.html',
  '/test/browser-min.html',
  '/test/esm.html',
  '/test/esm-min.html',
  '/page/index.html',
  '/page/go.html',
];

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  // `.mjs` must not fall back to application/octet-stream, or a browser refuses
  // to execute the module.
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// Resolves a URL path to a file inside the repository, or to an HTTP status.
// Anything that escapes the repo or reaches into node_modules is refused rather
// than silently served.
export function resolveRequestFile(urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(String(urlPath).split('?')[0].split('#')[0]);
  } catch {
    return { status: 400 };
  }

  if (pathname.includes('\0')) return { status: 400 };

  // Reject `..` segments before normalising: path.normalize would collapse them
  // against the root and quietly turn a traversal attempt into an in-repo path
  // (for example `/test/../../package-lock.json` becomes a real repo file).
  if (pathname.split(/[\\/]+/).includes('..')) return { status: 403 };

  const full = resolve(join(root, normalize(pathname)));

  if (full !== root && !full.startsWith(root + sep)) return { status: 403 };
  if (full.split(sep).includes('node_modules')) return { status: 403 };

  return { file: full, pathname };
}

async function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(body);
}

export function createTestServer() {
  return createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      await send(res, 405, 'Method Not Allowed', { allow: 'GET, HEAD' });
      return;
    }

    const urlPath = req.url || '/';

    // A bare `/` lands on the test index, which links every scenario.
    if (urlPath === '/' || urlPath === '') {
      await send(res, 302, '', { location: '/test/' });
      return;
    }

    const resolved = resolveRequestFile(urlPath);
    if (resolved.status) {
      await send(res, resolved.status, resolved.status === 400 ? 'Bad Request' : 'Forbidden');
      return;
    }

    let file = resolved.file;
    try {
      const info = await stat(file);
      if (info.isDirectory()) {
        file = join(file, 'index.html');
        await stat(file);
      }
    } catch {
      await send(res, 404, 'Not Found');
      return;
    }

    let body;
    try {
      body = await readFile(file);
    } catch {
      await send(res, 404, 'Not Found');
      return;
    }

    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

// Only listen when executed directly, so tests can import the factory.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 4001);
  const server = createTestServer();

  server.listen(port, host, () => {
    const base = `http://${host}:${port}`;
    console.log(`xqisie: test pages running at ${base}/test/`);
    console.log('');
    console.log('Open:');
    for (const page of PAGES) console.log(`  ${base}${page}`);
  });
}
