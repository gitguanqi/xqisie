// Manifest and artifact contract. These assertions are what stop the package
// from drifting back into "four hand-maintained copies and a broken entry point".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => resolve(root, ...parts);
const pkg = JSON.parse(readFileSync(at('package.json'), 'utf8'));
const require = createRequire(import.meta.url);

const ARTIFACTS = [
  'lib/xqisie.js',
  'lib/xqisie.min.js',
  'lib/xqisie-esm.js',
  'lib/xqisie-esm.min.js',
  'lib/xqisie-esm.mjs',
  'lib/xqisie-esm.min.mjs',
];

test('entry points point at files that exist', () => {
  assert.equal(pkg.main, 'lib/xqisie.js');
  assert.equal(pkg.module, 'lib/xqisie-esm.mjs');
  assert.equal(pkg.browser, 'lib/xqisie.min.js');
  assert.equal(pkg.unpkg, 'lib/xqisie.min.js');
  assert.equal(pkg.jsdelivr, 'lib/xqisie.min.js');

  for (const field of ['main', 'module', 'browser', 'unpkg', 'jsdelivr']) {
    assert.ok(existsSync(at(pkg[field])), `${field} -> ${pkg[field]} must exist`);
  }
});

test('exports map covers both module systems and the raw lib/ files', () => {
  assert.equal(pkg.exports['.'].import, './lib/xqisie-esm.mjs');
  assert.equal(pkg.exports['.'].require, './lib/xqisie.js');
  assert.equal(pkg.exports['.'].default, './lib/xqisie.js');
  assert.equal(pkg.exports['./lib/*'], './lib/*');
  assert.equal(pkg.exports['./page/*'], './page/*');
  assert.equal(pkg.exports['./package.json'], './package.json');

  for (const value of Object.values(pkg.exports['.'])) {
    assert.ok(existsSync(at(value.replace(/^\.\//, ''))), `exports target ${value} must exist`);
  }
});

test('the published tarball keeps lib/ and the tip pages', () => {
  // `page/` is the whole point of the package for anyone who copies it into a
  // site, so a whitelist that omits it silently breaks that use case.
  assert.ok(pkg.files.includes('lib'));
  assert.ok(pkg.files.includes('page'));
  assert.ok(pkg.files.includes('zh.md'));
  assert.ok(!pkg.files.some((entry) => entry.startsWith('!')), 'files must not exclude lib/');
});

test('every committed artifact exists and carries the manifest version', () => {
  for (const file of ARTIFACTS) {
    const text = readFileSync(at(file), 'utf8');
    assert.ok(text.startsWith('/*!'), `${file} must start with a version banner`);
    assert.ok(
      text.includes(`v${pkg.version}`),
      `${file} banner must match package.json version ${pkg.version}`,
    );
    assert.ok(text.length > 0);
  }
});

test('the .mjs mirrors are byte-identical to their .js counterparts', () => {
  // The mirrors exist only to disambiguate the module type; if they ever differ
  // there are two behaviours to keep in sync again.
  assert.equal(readFileSync(at('lib/xqisie-esm.mjs'), 'utf8'), readFileSync(at('lib/xqisie-esm.js'), 'utf8'));
  assert.equal(
    readFileSync(at('lib/xqisie-esm.min.mjs'), 'utf8'),
    readFileSync(at('lib/xqisie-esm.min.js'), 'utf8'),
  );
});

test('no artifact still carries a fixed defect', () => {
  for (const file of ARTIFACTS) {
    const text = readFileSync(at(file), 'utf8');
    assert.ok(!/navigator\s*\.\s*appVersion/.test(text), `${file} must not read navigator.appVersion`);
    assert.ok(!/define\s*\(\s*factory\s*\(\s*\)\s*\)/.test(text), `${file} must not evaluate the AMD factory eagerly`);
  }
});

test('every module format resolves to an equivalent API', async () => {
  const umd = require(at('lib/xqisie.js'));
  const umdMin = require(at('lib/xqisie.min.js'));

  for (const api of [umd, umdMin]) {
    assert.deepEqual(Object.keys(api).sort(), ['check', 'goLink']);
    assert.equal(typeof api.check, 'function');
    assert.equal(typeof api.goLink, 'function');
  }

  const esm = await import(pathToFileURL(at('lib/xqisie-esm.mjs')).href);
  const esmMin = await import(pathToFileURL(at('lib/xqisie-esm.min.mjs')).href);

  for (const mod of [esm, esmMin]) {
    assert.equal(mod.default.check, mod.check, 'default and named export must be the same function');
    assert.equal(mod.default.goLink, mod.goLink);
    assert.deepEqual(Object.keys(mod.default).sort(), ['check', 'goLink']);
  }

  // The legacy .js ESM path is what older docs point at, so it must still import.
  const esmLegacy = await import(pathToFileURL(at('lib/xqisie-esm.js')).href);
  assert.equal(esmLegacy.default.check, esmLegacy.check);
});

test('the banner version cannot drift from the manifest', () => {
  // Guard against a hand-edited bundle: every banner must name the current version.
  const banners = ARTIFACTS.map((file) => readFileSync(at(file), 'utf8').split('\n')[0]);
  const versions = new Set(banners.map((line) => (line.match(/v(\d+\.\d+\.\d+)/) || [])[1]));
  assert.deepEqual([...versions], [pkg.version]);
});

test('package.json has no "type" field that would reparse the UMD main', () => {
  // Setting "type": "module" makes require('xqisie') fail, because main is UMD.
  assert.equal(pkg.type, undefined);
});

test('scripts build before testing and never exit non-zero on purpose', () => {
  assert.match(pkg.scripts.build, /build\.mjs/);
  assert.match(pkg.scripts.pretest, /build\.mjs/);
  assert.match(pkg.scripts['check:dist'], /--check/);
  assert.match(pkg.scripts.verify, /check:dist|--check/);
  assert.equal(pkg.scripts['test:browser'], 'node scripts/serve.mjs');
  assert.ok(
    !/exit\s+1/.test(pkg.scripts.test),
    'the test script must not be a placeholder that always fails',
  );
  for (const file of ['core.test.mjs', 'package.test.mjs', 'browser-pages.test.mjs', 'server.test.mjs', 'tip-page.test.mjs']) {
    assert.ok(pkg.scripts.test.includes(file), `test script must run ${file}`);
  }
});

test('the build toolchain is a devDependency, not a runtime dependency', () => {
  assert.equal(pkg.dependencies, undefined);
  assert.ok(pkg.devDependencies && pkg.devDependencies.esbuild);
});

test('lib/ contains only the artifacts the build produces', () => {
  const onDisk = readdirSync(at('lib')).filter((name) => /\.(js|mjs)$/.test(name)).sort();
  assert.deepEqual(onDisk, ARTIFACTS.map((file) => file.replace('lib/', '')).sort());
  for (const file of ARTIFACTS) {
    assert.ok(statSync(at(file)).size > 0);
  }
});
