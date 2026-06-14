"use strict";
// Smoke test: the controller answers the PNA preflight and relays a key over SSE.
const http = require("http");
const ORIGIN = "https://ds3-community-guide.vercel.app";
const HOST = "127.0.0.1", PORT = 10030;

function preflight() {
  return new Promise((resolve) => {
    const r = http.request({ host: HOST, port: PORT, path: "/api/events", method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Private-Network": "true", "Access-Control-Request-Method": "GET" } },
      res => { res.resume(); resolve({ status: res.statusCode, h: res.headers }); });
    r.on("error", e => resolve({ err: String(e.message) }));
    r.end();
  });
}

function relay() {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: PORT, path: "/api/events", headers: { Origin: ORIGIN } }, res => {
      let posted = false;
      res.setEncoding("utf8");
      res.on("data", chunk => {
        if (!posted && chunk.includes('"hello"')) {
          posted = true;
          const body = JSON.stringify({ action: "nav-up" });
          const p = http.request({ host: HOST, port: PORT, path: "/api/key", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Origin: ORIGIN } });
          p.end(body);
        } else if (chunk.includes('"nav-up"')) {
          req.destroy(); resolve(true);
        }
      });
    });
    req.on("error", () => resolve(false));
    setTimeout(() => { req.destroy(); resolve(false); }, 3000);
  });
}

(async () => {
  const pf = await preflight();
  console.log("OPTIONS status:", pf.status);
  console.log("  Allow-Origin:", pf.h && pf.h["access-control-allow-origin"]);
  console.log("  Allow-Private-Network:", pf.h && pf.h["access-control-allow-private-network"]);
  const ok = await relay();
  console.log("SSE relay round-trip:", ok ? "PASS" : "FAIL");
  process.exit(ok && pf.status === 204 && pf.h["access-control-allow-private-network"] === "true" ? 0 : 1);
})();
