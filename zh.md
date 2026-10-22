# xqisie

检测浏览器类型，并把使用 Internet Explorer 访问的访客引导到「请升级浏览器」提示页。

[View English documents](./README.md)

## 安装

**浏览器端** — UMD 构建会暴露 `window.xqisie`：

```html
<script src="https://unpkg.com/xqisie@0.1.0/lib/xqisie.min.js"></script>
```

**ES 模块** — 同时提供默认导出与具名导出：

```html
<script type="module">
    import xqisie from 'https://unpkg.com/xqisie@0.1.0/lib/xqisie-esm.min.mjs';
    // 也可以：import { check, goLink } from 'https://unpkg.com/xqisie@0.1.0/lib/xqisie-esm.min.mjs';
</script>
```

**Node / 打包工具**：

```sh
npm install xqisie
```

```js
const xqisie = require('xqisie');
// 或：import xqisie from 'xqisie';
```

## 使用

### check(userAgent?)

返回 `'Chrome'`、`'IE'`、`'Firefox'`、`'Opera'`、`'Safari'` 之一；都不匹配时返回 `''`。

```js
const browser = xqisie.check();
console.log('Browser is:', browser);
```

传入 UA 字符串即可判断指定的请求，而不是当前浏览器。**传参时完全不读取 `navigator`**，
所以可以安全地放在服务端使用：

```js
const http = require('http');
const xqisie = require('xqisie');

http.createServer((req, res) => {
    res.end('browser is: ' + (xqisie.check(req.headers['user-agent']) || 'unknown'));
}).listen(3000, 'localhost');
```

判断顺序是有意设计的：Opera 早于 Chrome（它的 UA 里两者都含），Safari 放在最后（几乎所有
WebKit 系 UA 都含 `Safari`）。

### goLink(url?)

仅在 IE 下把当前页跳转到 `url`（默认 `../page/`）。返回布尔值表示是否发生了跳转，且**永不抛错**
—— Node 或 Worker 里没有 `location`，它会直接返回 `false`。

```js
xqisie.goLink('./page/index.html');
```

### 提示页

`page/` 目录里是一套现成的「浏览器版本过低」页面（`index.html`）、跳转脚本（`js/index.js`）
以及配套样式与图标。把这个目录拷到你的站点，再让 `goLink()` 指向它：

```js
xqisie.goLink('/page/');
```

跳转脚本按名字读取 `?url=`，只接受 `http:` 与 `https:` 目标（`javascript:`、`data:` 会被拒绝），
并且能在 IE 11 上运行 —— IE 11 既没有 `URLSearchParams` 也没有 `URL` 构造器。

## 返回值与已知限制

| UA 中包含 | `check()` 返回 |
| --- | --- |
| `OPR/` 或 `Opera` | `'Opera'` |
| `Trident` 或 `MSIE` | `'IE'` |
| `Chrome` | `'Chrome'` |
| `Firefox` | `'Firefox'` |
| `Safari` | `'Safari'` |
| 都不包含 | `''` |

以下限制是**有意保留**的稳定行为：

- **Edge 返回 `'Chrome'`**。现代 Edge 的 UA 里带 `Chrome/`。新增第六个返回值会破坏所有按现有
  五个值做分支的调用方。
- **iOS 上的浏览器返回 `'Safari'`**。iOS 的 Chrome（`CriOS/`）与 Firefox（`FxiOS/`）UA 里都带
  `Safari/`。
- **IE 只根据 `Trident`/`MSIE` 判断**，覆盖 IE 6 到 IE 11，不再读取非标准的
  `navigator.appVersion`。

## 供 AI 代理读取

包内自带机器可读说明，并在 `package.json` 中声明：

- `llms.txt`（`"llms"` 字段）—— 精简 API 参考：导出、五个返回值、参数默认值，以及那些属于
  行为约定而非细节的限制。安装后可用 `require.resolve('xqisie/llms.txt')` 定位。
- `skills/xqisie-ie-guard/SKILL.md`（`"agents"` 字段）—— 集成指引：拦截逻辑该放在哪里、提示页
  如何落地、常见故障与验证方式。精确表格在 `<skill>/references/api.md`。

## 查看示例

```sh
npm run test:browser
```

然后打开 <http://127.0.0.1:4001/test/>。首页按「消费路径」列出每一页 —— UMD 可读、UMD 压缩、
ESM 可读、ESM 压缩 —— 外加提示页。每个检查页都会针对已提交的产物跑一遍自己的用例，逐条显示
`PENDING`／`PASS`／`FAIL`，跑完还会留一个可交互的演示面板。

## 开发

`src/index.js` 是唯一手写的源码。`lib/` 下的所有文件都由 `scripts/build.mjs` 生成，并且提交进
仓库，以保证 CDN 路径始终可用。

```sh
npm run build          # 由 src/ 重新生成 lib/
npm run check:dist     # lib/ 落后于 src/ 时失败
npm test               # node --test，会先重建 lib/
npm run test:browser   # 启动测试页服务器
npm run test:browser:check   # 在无头 Chrome/Edge 里跑所有页面
npm run verify         # check:dist + test + 无头浏览器
```

`src/index.js` 刻意写成纯 ES5 脚本体：构建时会把这个正文分别包进 UMD 与 ESM 两种外壳，因此它
不能包含 `import`/`export`。ES5 也是硬性要求 —— 这个库必须能在它所检测的那些老浏览器里执行。

## 提问题

[这里提问](https://github.com/gitguanqi/xqisie/issues/new)

## 作者

[@gitguanqi](https://github.com/gitguanqi)
