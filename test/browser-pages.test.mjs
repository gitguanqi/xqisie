// Structural contract for the standalone pages. These checks are static: they
// catch stale paths and missing assets, which is the failure mode a browser run
// cannot report because the page simply never boots.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => resolve(root, ...parts);
const read = (file) => readFileSync(at(file), 'utf8');

const CHECK_PAGES = [
  { file: 'test/browser.html', kind: 'umd', bundle: '../lib/xqisie.js', title: 'UMD readable' },
  { file: 'test/browser-min.html', kind: 'umd', bundle: '../lib/xqisie.min.js', title: 'UMD minified' },
  { file: 'test/esm.html', kind: 'esm', bundle: '../lib/xqisie-esm.js', title: 'ESM readable' },
  { file: 'test/esm-min.html', kind: 'esm', bundle: '../lib/xqisie-esm.min.mjs', title: 'ESM minified' },
];

test('every check page shares the same visible shell', () => {
  for (const page of CHECK_PAGES) {
    const html = read(page.file);

    assert.match(
      html,
      /<link rel="icon" href="\.\/icon\.svg" type="image\/svg\+xml">/,
      `${page.file} must use the shared favicon`,
    );
    assert.match(html, /<img[^>]+src="\.\/icon\.svg"/, `${page.file} must show the shared icon`);
    assert.match(html, /href="\.\/demo\.css"/, `${page.file} must load the shared stylesheet`);
    assert.match(html, /aria-live="polite"/, `${page.file} needs a polite live region`);
    assert.match(html, /id="summary"/, `${page.file} needs a summary badge`);
    assert.match(html, /id="checks"/, `${page.file} needs a check list`);
    assert.match(html, /id="details"/, `${page.file} needs a details panel`);
    assert.match(html, /id="demo"/, `${page.file} needs a live demo panel`);
    assert.match(html, /src="\.\/checks\.js"/, `${page.file} must load the check runner`);
    assert.match(html, /src="\.\/ua-checks\.js"/, `${page.file} must load the shared checks`);

    // A page that only logs to the console is not a test page.
    assert.ok(!/console\.(log|error)/.test(html), `${page.file} must report on the page, not the console`);
    assert.ok(!/setTimeout/.test(html), `${page.file} must not navigate on a timer`);
  }
});

test('the UMD pages load the committed UMD builds and nothing else', () => {
  const browser = read('test/browser.html');
  assert.match(browser, /<script src="\.\.\/lib\/xqisie\.js"><\/script>/);
  assert.ok(!/type="module"[\s\S]*import/.test(browser), 'the UMD page must not import the ESM build');
  assert.ok(!/xqisie-esm/.test(browser), 'the UMD page must not reference an ESM bundle');

  const min = read('test/browser-min.html');
  assert.match(min, /<script src="\.\.\/lib\/xqisie\.min\.js"><\/script>/);
  assert.ok(!/xqisie-esm/.test(min), 'the minified UMD page must not reference an ESM bundle');
});

test('the ESM pages import the committed ESM builds through a real module script', () => {
  const esm = read('test/esm.html');
  assert.match(esm, /<script type="module">/);
  assert.match(esm, /from '\.\.\/lib\/xqisie-esm\.js'/);
  assert.ok(!/<script src="\.\.\/lib\/xqisie/.test(esm), 'the ESM page must not load a UMD bundle');

  const min = read('test/esm-min.html');
  assert.match(min, /<script type="module">/);
  assert.match(min, /from '\.\.\/lib\/xqisie-esm\.min\.mjs'/);
  assert.ok(!/<script src="\.\.\/lib\/xqisie/.test(min), 'the ESM page must not load a UMD bundle');
});

test('the ESM pages assert named and default export identity', () => {
  for (const file of ['test/esm.html', 'test/esm-min.html']) {
    const html = read(file);
    assert.match(html, /import api, \{ check, goLink \}/, `${file} must import both forms`);
    assert.match(html, /api\.check,\s*check/, `${file} must compare default.check to the named check`);
    assert.match(html, /typeof window\.xqisie,\s*'undefined'/, `${file} must prove no global leaked`);
  }
});

test('the index links every scenario, including the tip pages', () => {
  const index = read('test/index.html');
  for (const page of ['./browser.html', './browser-min.html', './esm.html', './esm-min.html', '../page/index.html']) {
    assert.ok(index.includes(`href="${page}"`), `index must link ${page}`);
  }
  assert.match(index, /<link rel="icon" href="\.\/icon\.svg"/);
  assert.match(index, /href="\.\/demo\.css"/);
});

test('the check runner reports and mirrors its state', () => {
  const runner = read('test/checks.js');
  assert.match(runner, /window\.__XQISIE_TEST__|__XQISIE_TEST__/);
  assert.match(runner, /'PENDING'/, 'rows must start as PENDING');
  assert.match(runner, /'PASS'/);
  assert.match(runner, /'FAIL'/);
  assert.match(runner, /is-pass/);
  assert.match(runner, /is-fail/);
  assert.match(runner, /data-test-status|setAttribute\('data-test-status'/);
  assert.match(runner, /unhandledrejection/, 'uncaught failures must reach the page');
});

test('the shared checks remount a live demo after the suite', () => {
  const checks = read('test/ua-checks.js');
  assert.match(checks, /function start/);
  // Mounting again after runner.run is what keeps PASS from meaning "blank panel".
  assert.match(checks, /runner\.run\(checks\)[\s\S]*mountDemo/);
  assert.match(checks, /demoReady = true/);
});

test('the UA fixtures cover the five names and an unmatched UA', () => {
  const fixtures = JSON.parse(read('test/ua-fixtures.json'));
  const expected = new Set(Object.values(fixtures).map((fixture) => fixture.expected));

  for (const name of ['Chrome', 'IE', 'Firefox', 'Opera', 'Safari']) {
    assert.ok(expected.has(name), `fixtures must cover ${name}`);
  }
  assert.ok(expected.has(''), 'fixtures must cover an unmatched user agent');
  assert.ok(Object.keys(fixtures).length >= 8, 'fixtures must be broad enough to be meaningful');

  for (const [key, fixture] of Object.entries(fixtures)) {
    assert.equal(typeof fixture.ua, 'string', `${key} needs a ua string`);
    assert.ok(fixture.ua.length > 8, `${key} ua looks too short to be real`);
  }
});

test('the page titles match the build they load', () => {
  for (const page of CHECK_PAGES) {
    const html = read(page.file);
    assert.ok(html.includes(page.title), `${page.file} should mention "${page.title}"`);
  }
});
