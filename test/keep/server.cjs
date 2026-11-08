// Test server for the "Keep blurs" pages. Plain Node, no dependencies.
//
//   node test/keep/server.cjs [port]      (default 8000)
//
// Serves the whole test/ folder, plus two things python's http.server can't:
//   /spa/<anything>  the single-page app, so its pushState routes survive a
//                    reload and a back/forward
//   /keep/slow.html  a page that arrives in two parts, 1.5 s apart, to watch
//                    blurs go on while the page is still loading

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

function slowPage(res) {
  res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
  // Padding pushes the first part past the parser's buffering so Chrome
  // starts on it straight away instead of waiting for more.
  res.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
    <title>Keep blurs — slow page</title><link rel="stylesheet" href="keep.css" /></head>
    <body><main><h1>Slow page — arrives in two parts</h1>
    <p class="early">Email: early@example.com</p>
    <p class="slow-note">Private: account flagged for review</p>
    <!-- ${"padding ".repeat(400)} -->\n`);
  setTimeout(() => {
    res.end(`<p class="late">Phone: (415) 555-0123</p>
      <p class="done">Loaded.</p></main></body></html>`);
  }, 1500);
}

function start(port = 8000) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let file;
    if (url.pathname === "/keep/slow.html") return slowPage(res);
    if (url.pathname.startsWith("/spa/") || url.pathname === "/spa") {
      file = path.join(ROOT, "keep", "spa.html");
    } else {
      file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
      if (!file.startsWith(ROOT)) {
        res.writeHead(403).end();
        return;
      }
      if (file.endsWith(path.sep)) file = path.join(file, "index.html");
    }
    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file)] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

module.exports = { start };

if (require.main === module) {
  const port = Number(process.argv[2]) || 8000;
  start(port).then(() => {
    console.log(`Serving test/ on http://localhost:${port}/`);
    console.log(`  Multi-page:  http://localhost:${port}/keep/one.html`);
    console.log(`  Single-page: http://localhost:${port}/spa/a`);
    console.log(`  Slow page:   http://localhost:${port}/keep/slow.html`);
  });
}
