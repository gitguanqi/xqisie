#!/usr/bin/env node
// Runs every standalone page in a real headless browser and asserts the state
// the page publishes. A stubbed DOM cannot prove module loading, fetch, or
// layout, so this is the gate that actually closes the loop.
//
// Zero npm dependencies: it uses Node's built-in WebSocket and the DevTools
// protocol directly.
//
// Usage:
//   node scripts/test-browser.mjs

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestServer } from './serve.mjs';

const PAGES = [
  { path: '/test/', expect: null },
  { path: '/test/browser.html', expect: 'passed' },
  { path: '/test/browser-min.html', expect: 'passed' },
  { path: '/test/esm.html', expect: 'passed' },
  { path: '/test/esm-min.html', expect: 'passed' },
  { path: '/page/index.html', expect: null, mustExist: '.browser ul li' },
  // No `url` parameter, so the shim refuses and calls history.back(). That makes
  // the document under test change, so this page is only checked for "it loaded
  // and ran its shim"; the redirect logic itself is unit-covered by
  // tip-page.test.mjs, which can freeze the timer.
  { path: '/page/go.html?from=test', expect: null, dialog: '暂无链接！', skipLayout: true },
];

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findBrowser() {
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function waitForDevTools(child) {
  return new Promise((done, fail) => {
    let buffered = '';
    const timer = setTimeout(() => fail(new Error('browser did not report a DevTools endpoint in 30s')), 30000);

    const onData = (chunk) => {
      buffered += chunk.toString();
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(buffered);
      if (match) {
        clearTimeout(timer);
        child.stderr.off('data', onData);
        done(match[1]);
      }
    };

    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`browser exited before DevTools was ready (code ${code})`));
    });
  });
}

// Minimal DevTools protocol client over the built-in WebSocket.
class Session {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      const handler = this.handlers.get(message.method);
      if (handler) handler(message.params);
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((done, fail) => {
      socket.addEventListener('open', done, { once: true });
      socket.addEventListener('error', () => fail(new Error('DevTools websocket failed')), { once: true });
    });
    return new Session(socket);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    this.handlers.set(method, handler);
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(session, expression, awaitPromise = false) {
  const result = await session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'evaluation failed');
  }
  return result.result.value;
}

async function waitForTestState(session, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate(session, 'window.__XQISIE_TEST__ ? JSON.stringify(window.__XQISIE_TEST__) : null');
    if (state) {
      const parsed = JSON.parse(state);
      if (parsed.status && parsed.status !== 'running') return parsed;
    }
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error('the page did not finish its suite within 20s');
}

async function run() {
  const browser = findBrowser();
  if (!browser) {
    console.error('No Chrome or Edge found. Set CHROME_PATH to run the browser gate.');
    return 1;
  }

  const server = createTestServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const profile = await mkdtemp(join(tmpdir(), 'xqisie-chrome-'));
  const child = spawn(browser, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let failed = 0;
  let session;

  try {
    const wsUrl = await waitForDevTools(child);
    // The DevTools endpoint is advertised as ws://, so the HTTP base has to be
    // rebuilt from the host rather than by trimming the URL.
    const httpBase = 'http://' + new URL(wsUrl).host;
    const targets = await (await fetch(`${httpBase}/json/list`)).json();
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('no page target available');

    session = await Session.connect(page.webSocketDebuggerUrl);
    await session.send('Runtime.enable');
    await session.send('Log.enable');
    await session.send('Page.enable');

    const errors = [];
    const dialogs = [];
    session.on('Runtime.exceptionThrown', (params) => {
      errors.push('uncaught: ' + (params.exceptionDetails?.exception?.description || params.exceptionDetails?.text));
    });
    session.on('Runtime.consoleAPICalled', (params) => {
      if (params.type === 'error' || params.type === 'assert') {
        errors.push('console.' + params.type + ': ' + params.args.map((a) => a.value ?? a.description).join(' '));
      }
    });
    session.on('Log.entryAdded', (params) => {
      if (params.entry.level === 'error') errors.push('log: ' + params.entry.text);
    });

    // The tip page explains a missing link with alert(); accept it so the run
    // does not hang, and treat it as an observation rather than an error.
    session.on('Page.javascriptDialogOpening', (params) => {
      dialogs.push(params.message || '');
      session.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    });

    for (const target of PAGES) {
      errors.length = 0;
      dialogs.length = 0;
      const url = origin + target.path;
      await session.send('Page.navigate', { url });
      await new Promise((done) => setTimeout(done, 400));

      const checks = [];

      if (target.expect) {
        const state = await waitForTestState(session);
        checks.push([`${target.path} reports ${target.expect}`, state.status === target.expect, state.status]);
        checks.push([
          `${target.path} keeps a live demo after the suite`,
          state.demoReady === true && state.liveInstances > 0,
          `demoReady=${state.demoReady} liveInstances=${state.liveInstances}`,
        ]);
        const failedChecks = (state.checks || []).filter((check) => !check.ok);
        // A page that runs zero checks would otherwise report "passed" for free.
        checks.push([
          `${target.path} runs a meaningful number of checks`,
          (state.checks || []).length >= 12,
          `${(state.checks || []).length} check(s)`,
        ]);
        checks.push([
          `${target.path} has no failing check rows`,
          failedChecks.length === 0,
          failedChecks.map((check) => check.name + ': ' + check.detail).join(' | '),
        ]);
      } else {
        const title = await evaluate(session, 'document.title');
        checks.push([`${target.path} loads`, Boolean(title), title]);
        if (target.mustExist) {
          const found = await evaluate(
            session,
            `document.querySelectorAll(${JSON.stringify(target.mustExist)}).length`,
          );
          checks.push([`${target.path} renders ${target.mustExist}`, found > 0, `${found} match(es)`]);
        }
        if (target.dialog) {
          checks.push([
            `${target.path} explains the missing link`,
            dialogs.includes(target.dialog),
            JSON.stringify(dialogs),
          ]);
        }
      }

      // 390px is where a fixed-width panel or a long UA string would overflow.
      if (!target.skipLayout) {
        await session.send('Emulation.setDeviceMetricsOverride', {
          width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
        });
        await new Promise((done) => setTimeout(done, 250));
        const overflow = await evaluate(
          session,
          'document.documentElement.scrollWidth - window.innerWidth',
        );
        checks.push([`${target.path} has no horizontal overflow at 390px`, overflow <= 1, `${overflow}px`]);
        await session.send('Emulation.clearDeviceMetricsOverride');
      }

      checks.push([`${target.path} raises no uncaught errors`, errors.length === 0, errors.join(' | ')]);

      for (const [name, ok, detail] of checks) {
        if (!ok) failed += 1;
        console.log(`${ok ? 'PASS  ' : 'FAIL  '}${name}${ok ? '' : ' :: ' + detail}`);
      }
    }
  } finally {
    if (session) session.close();
    child.kill();
    await new Promise((done) => server.close(done));
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  console.log('');
  if (failed === 0) {
    console.log('BROWSER CHECKS PASSED');
    return 0;
  }
  console.log(`${failed} BROWSER CHECK(S) FAILED`);
  return 1;
}

run().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(2);
  },
);
