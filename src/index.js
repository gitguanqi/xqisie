/* xqisie core.
 *
 * Deliberately a plain ES5 script: scripts/build.mjs wraps this body in the
 * UMD shell and in the ESM shell, so it must never contain import/export
 * statements or top-level await. Everything is ES5 because this library is
 * meant to run inside the very browsers it detects.
 */

var IE_TIP_PAGE = '../page/';

/* Reads the ambient user agent only when the caller supplied nothing. When a
 * UA string is passed, `navigator` is never touched -- that is what made
 * check() throw under Node, where navigator exists but has no appVersion. */
function resolveUserAgent (userAgent) {
  if (typeof userAgent === 'string' && userAgent) {
    return userAgent;
  }
  if (typeof navigator !== 'undefined' && navigator && typeof navigator.userAgent === 'string') {
    return navigator.userAgent;
  }
  return '';
}

/* Returns 'Chrome' | 'IE' | 'Firefox' | 'Opera' | 'Safari', or '' when the UA
 * matches none of them.
 *
 * Order matters:
 *   - Opera first, because its UA carries both Chrome/ and Safari/;
 *   - IE from Trident/MSIE in the UA alone, which covers IE 6 through 11;
 *   - Safari last, because almost every WebKit UA contains Safari/;
 *   - Edg/ intentionally falls through to 'Chrome' to keep the five-value
 *     contract. Do not add an 'Edge' value without a major version bump.
 */
function check (userAgent) {
  var ua = resolveUserAgent(userAgent);

  if (ua.indexOf('OPR/') !== -1 || ua.indexOf('Opera') !== -1) {
    return 'Opera';
  }
  if (ua.indexOf('Trident') !== -1 || ua.indexOf('MSIE') !== -1) {
    return 'IE';
  }
  if (ua.indexOf('Chrome') !== -1) {
    return 'Chrome';
  }
  if (ua.indexOf('Firefox') !== -1) {
    return 'Firefox';
  }
  if (ua.indexOf('Safari') !== -1) {
    return 'Safari';
  }
  return '';
}

/* Returns true when it pointed location at the target, false otherwise
 * (not IE, no location available, or the assignment was rejected). Never
 * throws, so it is safe under Node, in a Worker, and in a test sandbox. */
function goLink (url) {
  if (check() !== 'IE') {
    return false;
  }
  if (typeof location === 'undefined' || !location) {
    return false;
  }

  var target = (typeof url === 'string' && url) ? url : IE_TIP_PAGE;

  try {
    location.href = target;
    return true;
  } catch (error) {
    return false;
  }
}

var xqisie = {
  check: check,
  goLink: goLink,
};
