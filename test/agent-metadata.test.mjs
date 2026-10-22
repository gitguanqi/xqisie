// Agent-discovery metadata: `llms.txt` and the portable skill under `skills/`.
//
// These files are read by tools instead of people, so drift between them and the shipped API
// fails silently -- there is no reader who notices a stale return value. Every assertion here
// ties one of them back to the runtime exports or to the tarball whitelist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, relative, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => resolve(root, ...parts);
const read = (file) => readFileSync(at(file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const require = createRequire(import.meta.url);

const LLMS = 'llms.txt';
const SKILL_DIR = 'skills/xqisie-ie-guard';
const SKILL = `${SKILL_DIR}/SKILL.md`;

// Every published return value. The five-value contract is the single most load-bearing thing
// the docs have to get right, so it is asserted against the docs from both sides.
const BROWSERS = ['Chrome', 'IE', 'Firefox', 'Opera', 'Safari'];

const toPosix = (file) => relative(root, file).split(sep).join('/');

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

// Minimal YAML frontmatter reader: the shape is two flat string fields, so a dependency-free
// parser is enough and keeps the package's zero-runtime-dependency guarantee intact.
function frontmatter(text, file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  assert.ok(match, `${file} must open with a YAML frontmatter block`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([a-z][a-z-]*):[ \t]*(.+)$/.exec(line);
    if (pair) fields[pair[1]] = pair[2].trim();
  }
  return { fields, body: text.slice(match[0].length) };
}

test('llms and agents metadata point at files that exist', () => {
  assert.equal(pkg.llms, './llms.txt');
  assert.equal(pkg.agents, `./${SKILL}`);

  for (const field of ['llms', 'agents']) {
    const target = pkg[field];
    assert.match(target, /^\.\//, `${field} must be a ./ relative path`);
    assert.ok(existsSync(at(target.replace(/^\.\//, ''))), `${field} -> ${target} must exist`);
  }
});

test('the tarball whitelist covers every agent file', () => {
  assert.ok(pkg.files.includes('llms.txt'), 'llms.txt must ship');
  assert.ok(pkg.files.includes('skills'), 'the skill directory must ship');

  // A file that resolves in the repository but is excluded from `files` is invisible to the
  // agent that installed the package -- exactly the failure this test exists to catch.
  const shipped = walk(at(SKILL_DIR)).map(toPosix);
  assert.ok(shipped.length >= 2, 'the skill must ship its entrypoint and at least one reference');
  for (const file of shipped) {
    const covered = pkg.files.some((entry) => file === entry || file.startsWith(`${entry}/`));
    assert.ok(covered, `${file} is not covered by the files whitelist`);
  }
});

test('llms.txt documents every runtime export', () => {
  const text = read(LLMS);
  const api = require(at('lib/xqisie.js'));

  for (const name of Object.keys(api)) {
    assert.ok(text.includes(`\`${name}(`), `llms.txt must document ${name}()`);
    assert.ok(text.includes(name), `llms.txt must name ${name}`);
  }
  assert.deepEqual(Object.keys(api).sort(), ['check', 'goLink']);
});

test('llms.txt states the full return contract', () => {
  const text = read(LLMS);
  for (const browser of BROWSERS) {
    assert.ok(text.includes(`'${browser}'`), `llms.txt must mention '${browser}'`);
  }
  // The two documented quirks are behaviour, not trivia: callers branch on them.
  assert.match(text, /Edg|Edge/, 'llms.txt must document that Edge reports Chrome');
  assert.match(text, /CriOS|iOS/, 'llms.txt must document that iOS browsers report Safari');
  assert.match(text, /`''`/, "llms.txt must document the '' fallback");
});

test('llms.txt documents the option defaults that callers pass', () => {
  const text = read(LLMS);
  assert.match(text, /userAgent/, 'must document the userAgent argument');
  assert.match(text, /navigator\.userAgent/, 'must state where the default UA comes from');
  assert.match(text, /'\.\.\/page\/'/, "must state goLink's default target");
  assert.match(text, /boolean/, 'must state the goLink return type');
});

test('llms.txt names only paths the package actually ships', () => {
  const text = read(LLMS);

  // Repository-only paths are the classic llms.txt mistake: they read as documentation and
  // resolve to nothing inside node_modules.
  for (const path of ['src/', 'scripts/', 'test/', 'node_modules/']) {
    assert.ok(!text.includes(path), `llms.txt must not reference the repository-only path ${path}`);
  }

  for (const match of text.matchAll(/lib\/[A-Za-z0-9._-]+\.(?:js|mjs)/g)) {
    assert.ok(existsSync(at(match[0])), `llms.txt references ${match[0]}, which does not exist`);
  }
  for (const name of ['index.html', 'go.html', 'page/']) {
    assert.ok(text.includes(name), `llms.txt must describe the tip page: ${name}`);
  }
});

test('the skill declares a portable name and a load condition', () => {
  const file = read(SKILL);
  const { fields, body } = frontmatter(file, SKILL);

  assert.equal(fields.name, 'xqisie-ie-guard');
  assert.equal(basename(SKILL_DIR), fields.name, 'the directory and the skill name must match');
  assert.match(fields.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'name must be lowercase and hyphenated');

  // A description has to say what the skill does *and* when to load it, or a router cannot
  // decide to load it at all.
  assert.ok(fields.description.length >= 80, 'description must state capability and trigger');
  assert.match(fields.description, /\b(?:Load|Use) when\b/, 'description must state when to load');

  assert.ok(body.trim().length > 600, 'the skill body must carry real integration guidance');
});

test('every file the skill links to ships beside it', () => {
  const text = read(SKILL);
  const links = [...text.matchAll(/\]\((?!https?:)([^)\s]+)\)/g)].map((match) => match[1]);
  assert.ok(links.length > 0, 'the skill must link its detailed reference');

  for (const link of links) {
    const target = resolve(at(SKILL_DIR), link);
    assert.ok(target.startsWith(at(SKILL_DIR) + sep), `${link} must stay inside the skill directory`);
    assert.ok(existsSync(target), `${link} must resolve next to SKILL.md`);
  }

  // The reverse direction too: an orphaned reference ships bytes nobody can find.
  for (const file of walk(at(SKILL_DIR))) {
    const rel = toPosix(file);
    if (rel === SKILL) continue;
    const link = rel.replace(`${SKILL_DIR}/`, '');
    assert.ok(links.includes(link), `${rel} is not linked from SKILL.md`);
  }
});

test('the agent docs carry no placeholders', () => {
  const files = [LLMS, SKILL, ...walk(at(SKILL_DIR)).map(toPosix)];
  for (const file of files) {
    const text = read(file);
    assert.ok(!/\b(?:TODO|FIXME|TBD)\b/.test(text), `${file} must not contain a placeholder marker`);
    assert.ok(!/<your[- ]/i.test(text), `${file} must not contain a fill-in-the-blank slot`);
    assert.ok(!/\[insert/i.test(text), `${file} must not contain an unfilled template slot`);
    assert.ok(statSync(at(file)).size > 200, `${file} must not be a stub`);
  }
});

test('the metadata leaves the runtime entry points untouched', () => {
  // Documentation must never be the reason a CDN path or a require() changes.
  assert.equal(pkg.main, 'lib/xqisie.js');
  assert.equal(pkg.module, 'lib/xqisie-esm.mjs');
  assert.equal(pkg.browser, 'lib/xqisie.min.js');
  assert.equal(pkg.exports['.'].require, './lib/xqisie.js');
  assert.equal(pkg.exports['.'].import, './lib/xqisie-esm.mjs');
  assert.equal(pkg.exports['./llms.txt'], './llms.txt');
  assert.equal(pkg.type, undefined);

  // And the documented behaviour still holds, so the docs are not describing a former package.
  const api = require(at('lib/xqisie.js'));
  assert.equal(api.check('Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko'), 'IE');
  assert.equal(api.check('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36 Edg/120.0'), 'Chrome');
  assert.equal(api.goLink('/browser-tip/'), false);
});
