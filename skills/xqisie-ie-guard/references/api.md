# xqisie API reference

Verified against `lib/xqisie.js`, `lib/xqisie-esm.mjs` and the files under `page/` in this
package. There is no third export, no options object, and no event.

## Runtime exports

| Export | Signature | Returns | Notes |
| --- | --- | --- | --- |
| `check` | `check(userAgent?: string)` | `'Chrome' \| 'IE' \| 'Firefox' \| 'Opera' \| 'Safari' \| ''` | Empty or non-string argument falls back to the ambient `navigator.userAgent`. |
| `goLink` | `goLink(url?: string)` | `boolean` | Redirects to `url` (default `'../page/'`) only for `'IE'`. Never throws. |

```js
const xqisie = require('xqisie');        // { check, goLink }
import xqisie, { check, goLink } from 'xqisie';   // default and named are the same functions
```

The default export object holds exactly the two keys `check` and `goLink`.

## Package subpaths

| Specifier | File | Purpose |
| --- | --- | --- |
| `xqisie` (`import`) | `lib/xqisie-esm.mjs` | ES module |
| `xqisie` (`require`) | `lib/xqisie.js` | UMD / CommonJS |
| `xqisie/lib/xqisie.min.js` | minified UMD | `browser`, `unpkg`, `jsdelivr` target; exposes `window.xqisie` |
| `xqisie/lib/xqisie-esm.js` | ES module | legacy path kept for older docs |
| `xqisie/lib/xqisie-esm.min.js` | minified ES module | legacy path |
| `xqisie/lib/xqisie-esm.mjs` | byte-identical mirror of the `.js` | explicit module type for Node |
| `xqisie/page/*` | tip pages | copy into a site as a directory |
| `xqisie/llms.txt` | this package's agent summary | readable via `require.resolve('xqisie/llms.txt')` |

No TypeScript declarations ship. Every build is ES5; the readable and minified copies differ only
in whitespace and syntax compression.

## Tip page files

```text
page/
|-- index.html        "browser too old" page, six download links, zh-CN
|-- go.html           redirect shim host page
|-- js/index.js       the shim itself (ES5)
|-- css/index.css
`-- img/              360.jpg edge.jpg firefox.jpg google.jpg qq.jpg sogou.jpg favicon.svg
```

`go.html` must be reached with an encoded target, for example
`./go.html?url=https%3A%2F%2Fbrowser.qq.com%2F`.

## Shim behaviour (`page/js/index.js`)

| Input | Result |
| --- | --- |
| `?url=` with an `http:`/`https:` target | waits 886 ms, then `location.replace(target)` |
| `?url=` with `javascript:`, `data:`, `ftp:`, `//host/…` or an empty value | `alert('暂无链接！')` then `history.back()` |
| some other query parameter, no `url` | same refusal as above |
| no query string at all | `location.replace('../')` — back to the parent of the tip page |

Protocol validation uses the `URL` constructor when the engine has it and otherwise an
`/^https?:\/\//i` test, so IE 11 gets the same whitelist without either `URL` or
`URLSearchParams`. The 886 ms delay exists so the loading animation is visible; keep it if you
restyle the page.

## User agent matrix

| User agent | `check()` |
| --- | --- |
| `Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko` | `'IE'` |
| `Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 5.1)` | `'IE'` |
| `Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36` | `'Chrome'` |
| `Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36 Edg/120.0` | `'Chrome'` |
| `Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36 OPR/106.0` | `'Opera'` |
| `Mozilla/5.0 (Windows NT 10.0; rv:121.0) Gecko/20100101 Firefox/121.0` | `'Firefox'` |
| `Mozilla/5.0 (Macintosh) Version/17.0 Safari/605.1.15` | `'Safari'` |
| `Mozilla/5.0 (iPhone) CriOS/120.0 Mobile/15E148 Safari/604.1` | `'Safari'` |
| `Mozilla/5.0 (iPhone) FxiOS/121.0 Mobile/15E148 Safari/605.1.15` | `'Safari'` |
| `curl/8.4.0`, `Googlebot/2.1` | `''` |

## Edge cases worth asserting

- `goLink()` under Node, in a Worker, or inside a `vm` sandbox without `location` returns `false`
  and does not throw.
- `goLink()` in a non-IE browser returns `false` and leaves `location.href` untouched.
- `check(ua)` is pure with respect to the environment: the same string always yields the same
  answer, even where `navigator` is missing.
- Reordering the internal checks flips real results — `OPR/` UAs also contain `Chrome` and
  `Safari`, so the order is behaviour, not style.
