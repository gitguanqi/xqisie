---
name: xqisie-ie-guard
description: Gate a site on browser support with xqisie - detect the browser from a user agent and redirect Internet Explorer visitors to the bundled upgrade page. Load when adding an IE cutoff, copying the page/ tip pages into a site, or debugging why a user agent is reported as Chrome or Safari.
---

# Wiring an Internet Explorer cutoff with xqisie

xqisie answers one question — "which browser is this?" — and acts on one answer: send IE
visitors to a tip page. There is no configuration object and no plugin system, so the entire job
is choosing where to call it, what it is allowed to say, and where the tip page lives.

## What the package actually provides

| Piece | What it is |
| --- | --- |
| `check(userAgent?)` | Returns `'Chrome'`, `'IE'`, `'Firefox'`, `'Opera'`, `'Safari'` or `''`. |
| `goLink(url?)` | Redirects **only** when `check()` says `'IE'`; returns `boolean`. |
| `page/` | A ready-made zh-CN "browser too old" page, its `?url=` redirect shim, CSS and icons. |

Exact signatures, subpaths and the tip-page file list are in
[references/api.md](references/api.md). Load that file only when you need the precise tables.

## Integration order

1. **Decide where the decision happens.**
   - *Client side* — call `goLink()` from a small classic `<script>` in `<head>`, before any
     application bundle. A bundle written in modern syntax throws on IE before it reaches the
     guard, so the guard must not be inside it.
   - *Server side / edge* — call `check(req.headers['user-agent'])` and answer with a `4xx` or
     with the tip page HTML. This avoids a flash of the real page, which the client-side path
     cannot.
   - *Both* — legitimate: the server blocks obvious IE requests, the client guard covers cached
     HTML and direct file access. Keep one of them authoritative for the target URL.

2. **Place the tip pages.** Copy the whole `page/` directory into a stable public path
   (`/browser-tip/` and the like). Every internal link is relative (`./css/index.css`,
   `./img/360.jpg`, `./go.html?url=…`), so the directory has to keep its internal shape. To
   translate the copy, edit `page/index.html` text only and leave the hrefs percent-encoded.

3. **Point `goLink()` at it explicitly.** The default target is `'../page/'`, which is only
   correct when the guarded document sits one level beside a `page/` directory. In a real site
   pass the absolute path: `xqisie.goLink('/browser-tip/')`.

4. **Do not add the guard to the tip pages.** `go.html` is the redirect shim, not a place to
   re-run detection; a guard that fires there sends IE around the loop it just escaped.

5. **Verify both answers** — an IE UA that must redirect, and a Chrome UA that must not. See
   *Verification* below.

## Rules that cannot be negotiated

- **Exactly five values plus `''`.** Edge is `'Chrome'`; iOS Chrome (`CriOS/`) and iOS Firefox
  (`FxiOS/`) are `'Safari'`. If you need to tell Edge or iOS Chrome apart, read the raw UA string
  next to `check()` — do not try to extend the return value, and do not "fix" it by reordering
  the checks. Opera genuinely must be tested before Chrome, and Safari genuinely is last.
- **`check(ua)` never reads `navigator`.** That is what makes it safe in SSR, edge functions and
  tests. The ambient value is used only when the argument is absent or empty.
- **`goLink()` returning `false` means "did nothing", not "failed".** It returns `false` for every
  non-IE browser and for any environment without `location`. Never treat it as an error signal
  and never wrap it in `try/catch` expecting a throw.
- **Everything must stay ES5.** Any snippet you add around the guard runs on the same old engines;
  no arrow functions, `const`/`let`, template literals or `URL`/`URLSearchParams` in code that is
  part of the cutoff path.

## Common failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| Nothing happens in IE, the site just looks broken | The guard sat inside an ES6+ bundle that threw first | Load a standalone classic script that calls `goLink()` before the bundles |
| Redirect lands on a 404 | `url` was resolved against the wrong document | Pass an absolute path such as `/browser-tip/` |
| The tip page bounces back to the site | The guard was also added to the tip page, or `go.html` was opened without `?url=` | Remove the guard from the tip pages; link only `go.html?url=<encoded>` |
| Bouncing between site and tip page | Server and client guards disagree about the target | Make one path authoritative and let the other early-return |
| `check()` returns `''` | The UA header was missing, so `''` was passed through | Fall back to a neutral default; `''` is "unknown", not an error |
| A test asserts `'Edge'` and gets `'Chrome'` | Expected by contract | Assert `'Chrome'`; inspect the UA for `Edg/` when Edge matters |
| `goLink()` returns `false` under Node | No `location` in that runtime | Expected; test the boolean and assert `false`, do not expect navigation |
| Tip page text is Chinese on an English site | The bundled copy is zh-CN | Edit the visible text in `page/index.html`; keep hrefs encoded |

## Verification

An IE redirect can only be proven with an IE user agent, and `goLink()` reads the ambient
`navigator` — so test the decision through `check()`, and the action through the boolean:

```sh
node -e "
const x = require('xqisie');
const ie = 'Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko';
console.log(x.check(ie));                                   // IE
console.log(x.check('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36')); // Chrome
console.log(x.goLink('/browser-tip/'));                     // false, there is no location here
"
```

For the site itself, serve it over HTTP and confirm three things: an IE UA receives the tip page
(or the redirect), a Chrome UA receives the real page, and the tip page's own assets — stylesheet,
icons, `go.html?url=…` links — resolve from the copied path.

## Reference

- [references/api.md](references/api.md) — exact API, package subpaths, tip-page file list, UA
  matrix, and edge cases worth asserting.
