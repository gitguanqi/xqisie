// Behavior contract for the committed bundles. Parsing is not behavior, so every
// assertion here executes a real artifact -- the readable build and the minified
// build are each run through the same matrix and must agree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => resolve(root, ...parts);

// Fixtures live in test/ua-fixtures.json so the browser pages assert against the
// same list instead of keeping a second hand-maintained copy.
const FIXTURES = JSON.parse(readFileSync(at('test/ua-fixtures.json'), 'utf8'));
const UA = Object.fromEntries(Object.entries(FIXTURES).map(([key, fixture]) => [key, fixture.ua]));
const EXPECTED = Object.fromEntries(Object.entries(FIXTURES).map(([key, fixture]) => [key, fixture.expected]));

// Runs a UMD artifact inside a fresh vm context. `mode` selects which module
// branch the UMD wrapper takes; `globals` seeds the sandbox.
function runUmd(file, mode, globals = {}) {
  const source = readFileSync(at(file), 'utf8');
  const captured = { defineArg: undefined, cmdExports: undefined };
  const sandbox = { ...globals };

  if (mode === 'cjs') {
    sandbox.module = { exports: {} };
    sandbox.exports = sandbox.module.exports;
  } else if (mode === 'amd') {
    const define = (...args) => {
      captured.defineArg = args[0];
    };
    define.amd = true;
    sandbox.define = define;
  } else if (mode === 'cmd') {
    const define = (factory) => {
      const mod = { exports: {} };
      factory(undefined, mod.exports, mod);
      captured.cmdExports = mod.exports;
    };
    define.cmd = true;
    sandbox.define = define;
  }

  const context = vm.createContext(sandbox);
  new vm.Script(source, { filename: at(file) }).runInContext(context);

  let exported;
  if (mode === 'cjs') exported = sandbox.module.exports;
  else if (mode === 'amd') {
    exported = typeof captured.defineArg === 'function' ? captured.defineArg() : captured.defineArg;
  } else if (mode === 'cmd') exported = captured.cmdExports;
  else exported = context.xqisie;

  return { exported, sandbox, captured, context };
}

function exportSurface(api) {
  assert.equal(typeof api, 'object');
  assert.deepEqual(Object.keys(api).sort(), ['check', 'goLink']);
  assert.equal(typeof api.check, 'function');
  assert.equal(typeof api.goLink, 'function');
}

const BUILDS = ['lib/xqisie.js', 'lib/xqisie.min.js'];

for (const file of BUILDS) {
  test(`${file}: exports check and goLink through CommonJS`, () => {
    const { exported } = runUmd(file, 'cjs', { navigator: { userAgent: UA.chrome } });
    exportSurface(exported);
  });

  test(`${file}: maps every known user agent`, () => {
    const { exported } = runUmd(file, 'cjs', { navigator: { userAgent: UA.chrome } });
    for (const [key, ua] of Object.entries(UA)) {
      assert.equal(exported.check(ua), EXPECTED[key], `UA fixture "${key}"`);
    }
  });

  // The headline regression: the old IE branch read navigator.appVersion, so any
  // non-Chrome UA threw in an environment that has no appVersion -- which is
  // exactly what the documented Node example does.
  test(`${file}: works in a context with no navigator at all`, () => {
    const { exported, context } = runUmd(file, 'cjs', {});
    assert.equal(
      new vm.Script('typeof navigator').runInContext(context),
      'undefined',
      'the sandbox must genuinely have no navigator for this test to mean anything',
    );

    for (const [key, ua] of Object.entries(UA)) {
      assert.doesNotThrow(() => exported.check(ua), `UA fixture "${key}" must not throw`);
      assert.equal(exported.check(ua), EXPECTED[key], `UA fixture "${key}"`);
    }

    // No argument and no navigator: report "unknown" rather than throwing.
    assert.equal(exported.check(), '');
  });

  test(`${file}: never falls back to the ambient user agent when one is passed`, () => {
    // The sandbox says Chrome; asking about Firefox must answer Firefox.
    const { exported } = runUmd(file, 'cjs', { navigator: { userAgent: UA.chrome } });
    assert.equal(exported.check(UA.firefox), 'Firefox');
    assert.equal(exported.check(UA.ie10), 'IE');
    // An empty or non-string argument falls back to the environment instead.
    assert.equal(exported.check(''), 'Chrome');
    assert.equal(exported.check(null), 'Chrome');
    assert.equal(exported.check(undefined), 'Chrome');
  });

  test(`${file}: tolerates a navigator without a userAgent`, () => {
    const { exported } = runUmd(file, 'cjs', { navigator: {} });
    assert.doesNotThrow(() => exported.check());
    assert.equal(exported.check(), '');
  });

  test(`${file}: takes the AMD branch and hands define a factory`, () => {
    const { exported, captured } = runUmd(file, 'amd', { navigator: { userAgent: UA.chrome } });
    assert.equal(typeof captured.defineArg, 'function', 'define() must receive a factory, not a value');
    exportSurface(exported);
    assert.equal(exported.check(UA.firefox), 'Firefox');
  });

  test(`${file}: takes the CMD branch`, () => {
    const { exported } = runUmd(file, 'cmd', { navigator: { userAgent: UA.chrome } });
    exportSurface(exported);
    assert.equal(exported.check(UA.safari), 'Safari');
  });

  test(`${file}: takes the browser-global branch as window.xqisie`, () => {
    const { exported, context } = runUmd(file, 'global', { navigator: { userAgent: UA.chrome } });
    assert.ok(context.xqisie, 'the global build must expose xqisie');
    assert.equal(exported, context.xqisie);
    exportSurface(exported);
  });

  test(`${file}: goLink redirects for IE and reports it`, () => {
    const { exported } = runUmd(file, 'cjs', {
      navigator: { userAgent: UA.ie11 },
      location: { href: 'about:blank' },
    });
    assert.equal(exported.goLink('/page/'), true);
  });

  test(`${file}: goLink falls back to the default tip page`, () => {
    const location = { href: 'about:blank' };
    const { exported } = runUmd(file, 'cjs', { navigator: { userAgent: UA.ie11 }, location });
    assert.equal(exported.goLink(), true);
    assert.equal(location.href, '../page/');
  });

  test(`${file}: goLink uses the caller's target for IE`, () => {
    const location = { href: 'about:blank' };
    const { exported } = runUmd(file, 'cjs', { navigator: { userAgent: UA.ie10 }, location });
    assert.equal(exported.goLink('/old-browser'), true);
    assert.equal(location.href, '/old-browser');
  });

  test(`${file}: goLink leaves modern browsers alone`, () => {
    const location = { href: '/current' };
    const { exported } = runUmd(file, 'cjs', { navigator: { userAgent: UA.chrome }, location });
    assert.equal(exported.goLink('/page/'), false);
    assert.equal(location.href, '/current', 'a non-IE browser must not be navigated');
  });

  test(`${file}: goLink does not throw when there is no location`, () => {
    const { exported } = runUmd(file, 'cjs', { navigator: { userAgent: UA.ie11 } });
    assert.doesNotThrow(() => exported.goLink('/page/'));
    assert.equal(exported.goLink('/page/'), false);
  });
}

test('the readable and minified UMD builds agree on every fixture', () => {
  const readable = runUmd('lib/xqisie.js', 'cjs', { navigator: { userAgent: UA.chrome } }).exported;
  const minified = runUmd('lib/xqisie.min.js', 'cjs', { navigator: { userAgent: UA.chrome } }).exported;
  for (const ua of Object.values(UA)) {
    assert.equal(minified.check(ua), readable.check(ua), ua);
  }
});

test('check() is idempotent and does not leak globals', () => {
  const { exported, sandbox } = runUmd('lib/xqisie.min.js', 'cjs', {
    navigator: { userAgent: UA.firefox },
  });
  const before = Object.keys(sandbox).sort();
  exported.check();
  exported.check(UA.ie11);
  exported.check();
  assert.deepEqual(Object.keys(sandbox).sort(), before);
});
