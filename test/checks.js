/* Shared check runner for the standalone pages.
 *
 * Failures must be visible on the page, not only in the console, so every check
 * renders its own PASS/FAIL row and the machine-readable state is mirrored onto
 * window.__XQISIE_TEST__ for the headless runner. */
(function (global) {
  'use strict';

  function messageOf(error) {
    if (!error) return String(error);
    return error.message || String(error);
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message || 'assertion failed');
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(
        (message ? message + ': ' : '') +
          'expected ' + JSON.stringify(expected) +
          ', got ' + JSON.stringify(actual),
      );
    }
  }

  function createCheckRunner(options) {
    var list = document.getElementById('checks');
    var summary = document.getElementById('summary');
    var details = document.getElementById('details');

    var state = {
      page: (options && options.page) || 'unknown',
      status: 'running',
      checks: [],
      errors: [],
      demoReady: false,
      liveInstances: 0,
    };
    global.__XQISIE_TEST__ = state;

    function setBadge(kind, text) {
      summary.className = 'status-badge is-' + kind;
      summary.setAttribute('data-status', kind === 'running' ? 'running' : kind);
      summary.textContent = text;
    }

    function fail(where, error) {
      state.errors.push(where + ': ' + messageOf(error));
      if (details) details.textContent = state.errors.join('\n');
    }

    function record(name) {
      var item = document.createElement('li');
      item.className = 'check-item';
      item.setAttribute('data-test-status', 'pending');

      var label = document.createElement('span');
      label.className = 'check-label';
      label.textContent = name;

      var badge = document.createElement('strong');
      badge.className = 'check-badge';
      badge.textContent = 'PENDING';

      item.appendChild(label);
      item.appendChild(badge);
      list.appendChild(item);

      var entry = { name: name, ok: false, detail: '' };
      state.checks.push(entry);

      return { item: item, badge: badge, entry: entry };
    }

    function turn(entryRow, error) {
      entryRow.item.setAttribute('data-test-status', 'fail');
      entryRow.item.className = 'check-item is-fail';
      entryRow.badge.textContent = 'FAIL';
      entryRow.entry.detail = messageOf(error);

      var reason = document.createElement('code');
      reason.className = 'check-reason';
      reason.textContent = entryRow.entry.detail;
      entryRow.item.appendChild(reason);
    }

    // A thrown error anywhere on the page is a failure of the page, not a note.
    global.addEventListener('error', function (event) {
      fail('uncaught error', event.error || event.message);
      setBadge('failed', 'FAIL');
      state.status = 'failed';
    });
    global.addEventListener('unhandledrejection', function (event) {
      fail('unhandled rejection', event.reason);
      setBadge('failed', 'FAIL');
      state.status = 'failed';
    });

    async function run(checks) {
      setBadge('running', 'RUNNING');
      state.status = 'running';

      var passed = 0;
      var failed = 0;

      for (var i = 0; i < checks.length; i += 1) {
        var name = checks[i][0];
        var check = checks[i][1];
        var row = record(name);
        try {
          // eslint-disable-next-line no-await-in-loop
          await check();
          row.item.setAttribute('data-test-status', 'pass');
          row.item.className = 'check-item is-pass';
          row.badge.textContent = 'PASS';
          row.entry.ok = true;
          passed += 1;
        } catch (error) {
          failed += 1;
          turn(row, error);
          fail(name, error);
        }
      }

      state.status = failed === 0 ? 'passed' : 'failed';
      setBadge(failed === 0 ? 'passed' : 'failed', failed === 0 ? 'PASS' : 'FAIL');
      if (details && state.errors.length === 0) {
        details.textContent = passed + ' passed, 0 failed.';
      } else if (details) {
        details.textContent = passed + ' passed, ' + failed + ' failed.\n' + state.errors.join('\n');
      }

      return { passed: passed, failed: failed };
    }

    return { run: run, state: state };
  }

  global.xqisieTest = {
    createCheckRunner: createCheckRunner,
    assert: assert,
    assertEqual: assertEqual,
  };
}(window));
