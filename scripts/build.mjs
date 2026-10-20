#!/usr/bin/env node
// Regenerates every committed artifact under lib/ from the single source of
// truth, src/index.js. The shell (UMD / ESM) is written by hand and only the
// interior is minified, so the wrapper stays readable and assertable and the
// readable and minified builds cannot drift apart.
//
// Usage:
//   node scripts/build.mjs           write every artifact
//   node scripts/build.mjs --check   fail if the committed lib/ is stale

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => resolve(root, ...parts);

const pkg = JSON.parse(await readFile(at('package.json'), 'utf8'));

// The banner version is read from the manifest, so it can never drift from it.
// It is prepended after minification, so no minifier can strip or reflow it.
const BANNER = `/*! ${pkg.name} v${pkg.version} | ${pkg.license} | ${pkg.homepage} */\n`;

// `typeof globalThis` first: `this` is undefined when the UMD file is imported
// from an ES module, and `self` is absent under Node.
const UMD_HEAD = `(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') module.exports = factory();
  else if (typeof define === 'function' && define.amd) define(factory);
  else if (typeof define === 'function' && define.cmd) define(function (require, exports, module) { module.exports = factory(); });
  else root.xqisie = factory();
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
'use strict';
`;

const UMD_TAIL = `
return xqisie;
});
`;

const ESM_TAIL = `
export { check, goLink };
export default xqisie;
`;

const ARTIFACTS = [
  // `require()` and a plain <script src> both use this one.
  { file: 'lib/xqisie.js', shell: 'umd', minify: false },
  // unpkg / jsdelivr / the `browser` field.
  { file: 'lib/xqisie.min.js', shell: 'umd', minify: true },
  // Kept because the published CDN paths already point here.
  { file: 'lib/xqisie-esm.js', shell: 'esm', minify: false },
  { file: 'lib/xqisie-esm.min.js', shell: 'esm', minify: true },
  // `.mjs` mirrors keep Node from having to guess the module type of the
  // package: the manifest deliberately has no "type": "module", because that
  // would reparse the UMD main as an ES module.
  { file: 'lib/xqisie-esm.mjs', shell: 'esm', minify: false },
  { file: 'lib/xqisie-esm.min.mjs', shell: 'esm', minify: true },
];

const BODY = await readFile(at('src/index.js'), 'utf8');

function compose(shell) {
  if (shell === 'umd') return `${UMD_HEAD}${BODY}${UMD_TAIL}`;
  return `${BODY}${ESM_TAIL}`;
}

async function render(artifact) {
  const source = compose(artifact.shell);
  if (!artifact.minify) return `${BANNER}${source}`;

  const { code } = await transform(source, {
    // Identifiers stay unmangled on purpose: the hand-written shell refers to
    // `factory`, `root` and `xqisie` by name after minification. A parser-based
    // minifier is still used -- a regex tidier would mangle the string literals
    // that the UA checks depend on.
    minifyIdentifiers: false,
    minifyWhitespace: true,
    minifySyntax: true,
    // This library exists to run inside the browsers it detects, so the output
    // must stay ES5 rather than the newer target the sibling packages use.
    target: ['es5'],
    charset: 'utf8',
    legalComments: 'none',
    loader: 'js',
  });

  return `${BANNER}${code}`;
}

// Every artifact is checked before it is written, so a bad build never leaves a
// half-updated lib/ behind. Whitespace is collapsed in the minified output, so
// these patterns tolerate it.
function assertShape(artifact, text) {
  const fail = (reason) => {
    throw new Error(`${artifact.file}: ${reason}`);
  };

  if (!text.startsWith('/*!')) fail('missing version banner');
  if (!text.includes(`v${pkg.version}`)) fail('banner version does not match package.json');
  if (/navigator\s*\.\s*appVersion/.test(text)) fail('still reads navigator.appVersion');
  if (/define\s*\(\s*factory\s*\(\s*\)\s*\)/.test(text)) fail('AMD branch evaluates the factory eagerly');
  if (/^\s*(import|export)\s/m.test(BODY)) fail('src/index.js must stay a plain script, not a module');

  if (artifact.shell === 'umd') {
    if (!/root\.xqisie\s*=\s*factory\(\)/.test(text)) fail('missing the window.xqisie global export');
    if (!/define\(factory\)/.test(text)) fail('AMD branch must receive a factory');
    if (!/module\.exports\s*=\s*factory\(\)/.test(text)) fail('missing the CommonJS export');
    if (!/typeof globalThis/.test(text)) fail('root resolution is not guarded');
    if (/export\s*\{/.test(text)) fail('UMD artifact leaks ESM syntax');
  } else {
    if (!/export\s*\{\s*check\s*,\s*goLink\s*\}/.test(text)) fail('missing named exports');
    if (!/export default xqisie/.test(text)) fail('missing the default export');
    if (/module\.exports/.test(text)) fail('ESM artifact leaks CommonJS syntax');
  }
}

const checkOnly = process.argv.includes('--check');
let stale = 0;

await mkdir(at('lib'), { recursive: true });

for (const artifact of ARTIFACTS) {
  const text = await render(artifact);
  assertShape(artifact, text);

  if (checkOnly) {
    const current = await readFile(at(artifact.file), 'utf8').catch(() => '');
    // Compare with normalised line endings: a checkout with core.autocrlf=true
    // rewrites these files to CRLF, and that must not look like stale output.
    if (current.replace(/\r\n/g, '\n') !== text) {
      console.error(`stale: ${artifact.file}`);
      stale += 1;
    }
  } else {
    await writeFile(at(artifact.file), text);
    console.log(`wrote ${artifact.file}  ${Buffer.byteLength(text)} B`);
  }
}

if (checkOnly) {
  if (stale > 0) {
    console.error(`${stale} artifact(s) out of date. Run: node scripts/build.mjs`);
    process.exit(1);
  }
  console.log('lib/ matches src/.');
} else {
  console.log(`xqisie: ${ARTIFACTS.length} artifacts built.`);
}
