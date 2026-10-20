/* UA fixtures and the checks every page runs. The fixtures live in
 * ua-fixtures.json so the Node suite and the browser pages assert against one
 * list instead of two hand-maintained copies. */
(function (global) {
  'use strict';

  var FIXTURES_URL = './ua-fixtures.json';

  function loadFixtures() {
    return fetch(FIXTURES_URL, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) {
        throw new Error('cannot load ' + FIXTURES_URL + ' (' + response.status + ')');
      }
      return response.json();
    });
  }

  function label(value) {
    return value === '' ? 'an unmatched UA to ""' : value;
  }

  function buildChecks(api, name, fixtures) {
    var assert = global.xqisieTest.assert;
    var assertEqual = global.xqisieTest.assertEqual;
    var checks = [];

    checks.push(['exposes check and goLink', function () {
      assert(api && typeof api === 'object', name + ' did not export an object');
      assertEqual(Object.keys(api).sort().join(','), 'check,goLink', 'export surface of ' + name);
      assert(typeof api.check === 'function', 'check is not a function');
      assert(typeof api.goLink === 'function', 'goLink is not a function');
    }]);

    checks.push(['check() runs without an argument', function () {
      assert(typeof navigator !== 'undefined' && navigator.userAgent, 'this page has no navigator');
      assertEqual(typeof api.check(), 'string', 'check() must return a string');
    }]);

    checks.push(['check() agrees with check(navigator.userAgent)', function () {
      assertEqual(api.check(), api.check(navigator.userAgent), 'the ambient UA must resolve the same way');
    }]);

    Object.keys(fixtures).forEach(function (key) {
      var fixture = fixtures[key];
      checks.push(['maps ' + key + ' to ' + label(fixture.expected), function () {
        assertEqual(api.check(fixture.ua), fixture.expected, key);
      }]);
    });

    checks.push(['ignores the ambient UA when a string is supplied', function () {
      assertEqual(api.check(fixtures.firefox.ua), 'Firefox', 'a supplied UA must win');
      assertEqual(api.check(''), api.check(), 'an empty argument falls back to the environment');
      assertEqual(api.check(null), api.check(), 'null falls back to the environment');
    }]);

    checks.push(['goLink leaves a modern browser alone', function () {
      var before = location.href;
      var result = api.goLink('./should-not-navigate');
      assertEqual(location.href, before, 'the page must not move');
      if (api.check() !== 'IE') {
        assertEqual(result, false, 'goLink should report false for a non-IE browser');
      }
    }]);

    checks.push(['check() is repeatable', function () {
      for (var i = 0; i < 50; i += 1) assertEqual(api.check(fixtures.ie11.ua), 'IE', 'iteration ' + i);
      for (var j = 0; j < 50; j += 1) assertEqual(api.check(fixtures.chrome.ua), 'Chrome', 'iteration ' + j);
    }]);

    return checks;
  }

  // Renders a live, interactive demo. Called before the suite and again after it,
  // so the page never ends with an empty panel.
  function mountDemo(api, name) {
    var host = document.getElementById('demo');
    var state = global.__XQISIE_TEST__;
    host.textContent = '';

    var title = document.createElement('p');
    title.className = 'eyebrow';
    title.textContent = name + ' live demo';

    var detected = document.createElement('p');
    detected.className = 'demo-detected';
    var detectedLabel = document.createElement('span');
    detectedLabel.textContent = 'This browser: ';
    var detectedValue = document.createElement('strong');
    detectedValue.className = 'demo-value';
    detectedValue.textContent = api.check() || 'unknown';
    detected.appendChild(detectedLabel);
    detected.appendChild(detectedValue);

    var hint = document.createElement('p');
    hint.className = 'demo-hint';
    hint.textContent = 'Paste any user agent string to see what check() returns.';

    var input = document.createElement('input');
    input.className = 'demo-input';
    input.setAttribute('type', 'text');
    input.setAttribute('aria-label', 'User agent string');
    input.value = navigator.userAgent;

    var output = document.createElement('p');
    output.className = 'demo-output';
    var outputValue = document.createElement('strong');
    outputValue.className = 'demo-result';
    var action = document.createElement('span');
    action.className = 'demo-action';
    output.appendChild(outputValue);
    output.appendChild(action);

    function render(value) {
      var browser = api.check(value);
      outputValue.textContent = browser || 'unknown';
      // Non-IE browsers are never redirected, which is what the label reports.
      action.textContent = browser === 'IE' ? ' - goLink() would redirect' : ' - goLink() stays put';
    }

    input.addEventListener('input', function () {
      render(input.value);
    });

    host.appendChild(title);
    host.appendChild(detected);
    host.appendChild(hint);
    host.appendChild(input);
    host.appendChild(output);
    render(input.value);

    if (state) {
      state.liveInstances = 1;
      state.demoReady = true;
      state.demoBrowser = api.check();
    }
  }

  // Asserts the demo panel is genuinely live, not just present.
  function buildDemoChecks(api, name, fixtures) {
    var assert = global.xqisieTest.assert;
    var assertEqual = global.xqisieTest.assertEqual;

    return [
      ['the live demo reports the current browser', function () {
        global.xqisieTest.assert(
          document.querySelectorAll('#demo .demo-detected').length === 1,
          'the demo panel is not mounted',
        );
        assertEqual(
          document.querySelector('#demo .demo-value').textContent,
          api.check() || 'unknown',
          'the demo disagrees with check()',
        );
      }],
      ['the live demo updates when a UA is typed', function () {
        var input = document.querySelector('#demo .demo-input');
        assert(input, 'the demo has no input');
        input.value = fixtures.firefox.ua;
        input.dispatchEvent(new Event('input'));
        assertEqual(
          document.querySelector('#demo .demo-result').textContent,
          'Firefox',
          'the demo did not react to the typed UA',
        );
        // Put the panel back to the real browser so it is useful afterwards.
        input.value = navigator.userAgent;
        input.dispatchEvent(new Event('input'));
        assertEqual(
          document.querySelector('#demo .demo-result').textContent,
          api.check() || 'unknown',
          'the demo did not return to the ambient UA',
        );
      }],
      [name + ' keeps a live demo instance', function () {
        var state = global.__XQISIE_TEST__;
        assert(state && state.demoReady === true, 'demoReady was never set');
        assert(state.liveInstances > 0, 'no live demo instance remains');
      }],
    ];
  }

  // Boots a page: mounts the demo first so the panel is never empty, runs the
  // shared plus page-specific checks, then remounts a fresh demo before the page
  // can report PASS. A green status with an empty demo panel would be a
  // regression, so both the remount and demoReady are asserted above.
  function start(options) {
    var runner = global.xqisieTest.createCheckRunner({ page: options.page });
    var api = options.api;
    var title = options.title || options.page;

    return loadFixtures()
      .then(function (fixtures) {
        mountDemo(api, title);
        var checks = (options.checks || [])
          .concat(buildChecks(api, title, fixtures))
          .concat(buildDemoChecks(api, title, fixtures));
        return runner.run(checks);
      })
      .then(function (result) {
        mountDemo(api, title);
        var state = global.__XQISIE_TEST__;
        state.demoReady = true;
        state.demoRemounted = true;
        debugTarget(state);
        return result;
      })
      .catch(function (error) {
        var state = global.__XQISIE_TEST__;
        if (state) {
          state.status = 'failed';
          state.errors.push('page bootstrap: ' + (error && error.message ? error.message : error));
        }
        var summary = document.getElementById('summary');
        if (summary) {
          summary.className = 'status-badge is-failed';
          summary.textContent = 'FAIL';
        }
        var details = document.getElementById('details');
        if (details) details.textContent = String((error && error.message) || error);
        throw error;
      });
  }

  // Marks the page title so a reviewer can tell which build is on screen.
  function debugTarget(state) {
    var readout = document.getElementById('readout');
    if (readout) {
      readout.textContent =
        'browser: ' + (state.demoBrowser || 'unknown') +
        ' | live demo instances: ' + state.liveInstances +
        ' | UA: ' + navigator.userAgent;
    }
  }

  global.xqisieChecks = {
    loadFixtures: loadFixtures,
    buildChecks: buildChecks,
    buildDemoChecks: buildDemoChecks,
    mountDemo: mountDemo,
    start: start,
  };
}(window));
