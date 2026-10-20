/* Redirect shim for the browser tip page.
 *
 * This page is shown to visitors of old browsers, so the whole file stays ES5
 * and every modern API is probed before use -- URLSearchParams and the URL
 * constructor are both missing from IE 11, which is precisely the audience. */
(function (window) {
  'use strict';

  var DELAY = 886;

  function readParam (search, name) {
    var UrlSearchParams = window.URLSearchParams;
    if (typeof UrlSearchParams === 'function') {
      var fromApi = new UrlSearchParams(search).get(name);
      return fromApi === null ? null : fromApi;
    }

    // Fallback for engines without URLSearchParams. Splitting the whole query on
    // '=' used to truncate any target that carried its own query string, so this
    // splits on the first '=' of each pair instead.
    var query = String(search || '').replace(/^\?/, '');
    if (!query) {
      return null;
    }

    var pairs = query.split('&');
    for (var i = 0; i < pairs.length; i += 1) {
      var eq = pairs[i].indexOf('=');
      var key = eq === -1 ? pairs[i] : pairs[i].slice(0, eq);
      key = window.decodeURIComponent(key.replace(/\+/g, ' '));
      if (key === name) {
        var raw = eq === -1 ? '' : pairs[i].slice(eq + 1);
        return window.decodeURIComponent(raw.replace(/\+/g, ' '));
      }
    }
    return null;
  }

  function isHttpUrl (value) {
    if (!value) {
      return false;
    }

    var Url = window.URL;
    if (typeof Url === 'function') {
      try {
        var parsed = new Url(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch (error) {
        return false;
      }
    }

    // An explicit protocol whitelist. The previous `value.indexOf('http') > -1`
    // accepted anything that merely contained those four letters.
    return /^https?:\/\//i.test(value);
  }

  function refuse () {
    window.alert('暂无链接！');
    window.history.back();
  }

  var target = readParam(window.location.search, 'url');

  if (!target) {
    if (window.location.search) {
      refuse();
    } else {
      window.location.replace('../');
    }
    return;
  }

  if (!isHttpUrl(target)) {
    refuse();
    return;
  }

  window.setTimeout(function () {
    window.location.replace(target);
  }, DELAY);
}(window));
