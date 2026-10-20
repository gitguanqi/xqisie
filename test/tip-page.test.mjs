// The tip page's redirect shim runs on the oldest browsers, so it is exercised
// twice: once with URLSearchParams/URL available and once without them, to prove
// the IE 11 fallback path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => resolve(root, ...parts);
const read = (file) => readFileSync(at(file), 'utf8');

const SHIM = read('page/js/index.js');

// Runs the real file in a fake window. `modern: false` removes URLSearchParams
// and URL to simulate IE 11.
function runShim(options = {}) {
  const replaces = [];
  const alerts = [];
  let backs = 0;
  const timers = [];
  const search = options.search || '';

  const location = {
    search,
    href: 'http://localhost/page/go.html' + search,
    replace(value) {
      replaces.push(value);
    },
  };

  const win = {
    location,
    history: {
      back() {
        backs += 1;
      },
    },
    alert(message) {
      alerts.push(message);
    },
    setTimeout(fn, ms) {
      timers.push({ fn, ms });
      return timers.length;
    },
    decodeURIComponent,
  };

  if (options.modern !== false) {
    win.URLSearchParams = URLSearchParams;
    win.URL = URL;
  }

  const sandbox = { window: win, decodeURIComponent };
  vm.createContext(sandbox);
  new vm.Script(SHIM, { filename: 'page/js/index.js' }).runInContext(sandbox);

  return {
    replaces,
    alerts,
    backs,
    timers,
    // Fires the pending redirect, as the browser would after the animation.
    flush() {
      for (const timer of timers) timer.fn();
    },
  };
}

const MODES = [
  { label: 'with URLSearchParams/URL', modern: true },
  { label: 'without URLSearchParams/URL (IE 11 fallback)', modern: false },
];

for (const mode of MODES) {
  test(`${mode.label}: keeps a query string inside the target`, () => {
    // The old parser split the whole search on '=' and lost everything after the
    // first '=' in the target's own query.
    const run = runShim({ search: '?url=https://a.com/x?b=1', modern: mode.modern });
    assert.equal(run.timers.length, 1, 'a redirect should be scheduled');
    run.flush();
    assert.deepEqual(run.replaces, ['https://a.com/x?b=1']);
  });

  test(`${mode.label}: decodes a percent-encoded target`, () => {
    const run = runShim({
      search: '?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1',
      modern: mode.modern,
    });
    run.flush();
    assert.deepEqual(run.replaces, ['https://example.com/a?b=1']);
  });

  test(`${mode.label}: reads the url parameter by name, not by position`, () => {
    const run = runShim({ search: '?from=mail&url=https%3A%2F%2Fa.com%2F', modern: mode.modern });
    run.flush();
    assert.deepEqual(run.replaces, ['https://a.com/']);
  });

  test(`${mode.label}: keeps the 886ms animation delay`, () => {
    const run = runShim({ search: '?url=https%3A%2F%2Fa.com%2F', modern: mode.modern });
    assert.equal(run.timers[0].ms, 886);
  });

  test(`${mode.label}: refuses non-http protocols`, () => {
    for (const target of [
      'javascript:alert(1)',
      'ftp://a.com/x',
      '//evil.example/',
      'data:text/html,<script>alert(1)</script>',
    ]) {
      const run = runShim({ search: '?url=' + encodeURIComponent(target), modern: mode.modern });
      assert.equal(run.timers.length, 0, `${target} must not schedule a redirect`);
      assert.equal(run.replaces.length, 0, `${target} must not navigate`);
      assert.equal(run.alerts.length, 1, `${target} must be reported`);
      assert.equal(run.backs, 1, `${target} must send the visitor back`);
    }
  });

  test(`${mode.label}: a parameter without a url explains itself`, () => {
    const run = runShim({ search: '?from=mail', modern: mode.modern });
    assert.equal(run.replaces.length, 0);
    assert.equal(run.alerts[0], '暂无链接！');
    assert.equal(run.backs, 1);
  });

  test(`${mode.label}: no query string at all returns to the site root`, () => {
    const run = runShim({ search: '', modern: mode.modern });
    assert.deepEqual(run.replaces, ['../']);
    assert.equal(run.alerts.length, 0);
    assert.equal(run.backs, 0);
  });

  test(`${mode.label}: an empty url value is refused`, () => {
    const run = runShim({ search: '?url=', modern: mode.modern });
    assert.equal(run.timers.length, 0);
    assert.equal(run.backs, 1);
  });
}

test('the shim is ES5 so it can execute on the page it serves', () => {
  // Strip comments first: the prose mentions the old API by name in backticks,
  // which would otherwise look like a template literal.
  const code = SHIM.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/=>/.test(code), 'no arrow functions');
  assert.ok(!/\b(const|let)\s/.test(code), 'no block-scoped declarations');
  assert.ok(!/`/.test(code), 'no template literals');
  assert.ok(!/\?\./.test(code), 'no optional chaining');
});

test('the tip page links are percent-encoded', () => {
  const html = read('page/index.html');
  const hrefs = [...html.matchAll(/href="(\.\/go\.html\?url=[^"]+)"/g)].map((match) => match[1]);
  assert.ok(hrefs.length >= 6, 'expected every download link to use the shim');
  for (const href of hrefs) {
    assert.ok(
      !href.includes('://'),
      `${href} must percent-encode the target so a query string cannot split it`,
    );
    assert.match(href, /url=https?%3A%2F%2F/, `${href} must carry an encoded http(s) target`);
  }
});

test('the stylesheet no longer repeats the 768px media query', () => {
  const css = read('page/css/index.css');
  const blocks = [...css.matchAll(/@media all and \(max-width:\s*768px\)\s*\{\s*html,body\s*\{\s*font-size:\s*16px;?\s*\}\s*\}/g)];
  assert.equal(blocks.length, 1, 'the html/body 768px rule must appear exactly once');
});

test('the tip pages declare the language they are written in', () => {
  for (const file of ['page/index.html', 'page/go.html']) {
    assert.match(read(file), /<html lang="zh-CN">/, `${file} should declare zh-CN`);
  }
});
