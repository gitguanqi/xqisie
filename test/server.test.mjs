// The static server is maintained code, not a throwaway helper: a wrong MIME
// type makes the ESM page fail to execute, and a weak path guard serves the
// repository.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createTestServer, resolveRequestFile, PAGES } from '../scripts/serve.mjs';

let server;
let port;

before(async () => {
  server = createTestServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  port = server.address().port;
});

after(async () => {
  await new Promise((done) => server.close(done));
});

// Raw path, not fetch: the URL parser would normalise away the traversal
// sequences this suite needs to exercise.
function get(path, method = 'GET') {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('error', fail);
    req.end();
  });
}

test('/ redirects to the test index', async () => {
  const res = await get('/');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/test/');
});

test('the test index is served as HTML and is never cached', async () => {
  const res = await get('/test/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.match(res.body, /id="summary"/);
});

test('.mjs is served as JavaScript so the module actually executes', async () => {
  for (const path of ['/lib/xqisie-esm.min.mjs', '/lib/xqisie-esm.mjs', '/test/checks.js']) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers['content-type'], /^text\/javascript/, path);
  }
});

test('HEAD returns the headers without a body', async () => {
  const res = await get('/lib/xqisie.js', 'HEAD');
  assert.equal(res.status, 200);
  assert.equal(res.body, '');
  assert.ok(Number(res.headers['content-length']) > 0);
});

test('methods other than GET and HEAD are rejected', async () => {
  const res = await get('/test/', 'POST');
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, 'GET, HEAD');
});

test('missing files are a plain 404', async () => {
  assert.equal((await get('/test/nope.html')).status, 404);
  assert.equal((await get('/lib/nope.js')).status, 404);
});

test('node_modules is never served', async () => {
  const res = await get('/node_modules/esbuild/package.json');
  assert.equal(res.status, 403);
});

test('path traversal is refused', () => {
  for (const attempt of [
    '/../../Windows/win.ini',
    '/test/../../package-lock.json',
    '/..%2f..%2fetc/passwd',
    '/%2e%2e/%2e%2e/secret',
  ]) {
    const result = resolveRequestFile(attempt);
    assert.ok(result.status === 403 || result.status === 404, `${attempt} -> ${result.status}`);
  }
});

test('a malformed percent-encoding is a 400, not a crash', () => {
  assert.equal(resolveRequestFile('/%E0%A4%A').status, 400);
});

test('every advertised page is actually reachable', async () => {
  for (const page of PAGES) {
    const res = await get(page);
    assert.equal(res.status, 200, `${page} must be reachable`);
  }
});

test('the tip pages serve their own assets', async () => {
  for (const path of ['/page/js/index.js', '/page/css/index.css', '/page/img/google.jpg']) {
    assert.equal((await get(path)).status, 200, path);
  }
});
