/* Card Grader same-origin web/API gateway.
 * Run beside the Python API: CARD_GRADER_PYTHON=http://127.0.0.1:8000 npm start
 * Set PORT to the port your web host assigns. Put HTTPS in front of this process.
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const PYTHON = new URL(process.env.CARD_GRADER_PYTHON || "http://127.0.0.1:8000");
const API_PATHS = new Set(["/upload", "/crop", "/grade", "/assess", "/report-card"]);
const STATIC = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/config.js", ["config.js", "text/javascript; charset=utf-8"]],
]);

function reply(res, code, message) {
  res.writeHead(code, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(message);
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;

  if (API_PATHS.has(pathname)) {
    const upstream = http.request({
      hostname: PYTHON.hostname,
      port: Number(PYTHON.port || 80),
      method: req.method,
      path: pathname + new URL(req.url, "http://localhost").search,
      headers: { ...req.headers, host: PYTHON.host, connection: "close" },
      timeout: 120000,
    }, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      pipeline(upstreamRes, res, (err) => {
        if (err && !res.headersSent) reply(res, 502, "Python API proxy failed.");
      });
    });
    upstream.on("timeout", () => upstream.destroy(new Error("Python API timeout")));
    upstream.on("error", () => {
      if (!res.headersSent) reply(res, 502, "Python API is unreachable. Confirm it is listening on 127.0.0.1:8000.");
      else res.destroy();
    });
    req.on("aborted", () => upstream.destroy());
    pipeline(req, upstream, (err) => {
      if (err && !upstream.destroyed) upstream.destroy(err);
    });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return reply(res, 405, "Method not allowed.");
  }
  const item = STATIC.get(pathname);
  if (!item) return reply(res, 404, "Not found.");
  const [file, type] = item;
  const fullPath = path.join(ROOT, file);
  fs.stat(fullPath, (err, stat) => {
    if (err || !stat.isFile()) return reply(res, 404, "Missing site file: " + file);
    res.writeHead(200, {
      "content-type": type,
      "content-length": stat.size,
      "cache-control": file === "index.html" ? "no-cache" : "public, max-age=300",
      "x-content-type-options": "nosniff",
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(fullPath).pipe(res);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Card Grader gateway listening on port " + PORT);
  console.log("Python API target: " + PYTHON.origin);
});
