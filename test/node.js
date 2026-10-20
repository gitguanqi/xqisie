// Runnable copy of the Node example in README.md, kept in step with it.
//   node test/node.js
//   curl -A "Mozilla/5.0 (Windows NT 10.0; Trident/7.0; rv:11.0)" http://localhost:3000/
const http = require('http');
const xqisie = require('../lib/xqisie.js');

const server = http.createServer((req, res) => {
    if (req.url === '/') {
        const ua = req.headers['user-agent'];
        const browser = xqisie.check(ua);
        res.end('browser is: ' + (browser || 'unknown'));
        return;
    }
    res.statusCode = 404;
    res.end('Not Found');
});

server.listen(3000, 'localhost', () => {
    console.log('xqisie server is running on http://localhost:3000 !');
});

module.exports = server;
