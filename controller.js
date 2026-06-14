#!/usr/bin/env node
"use strict";
// DS3 Guide Numpad Controller
// ---------------------------------------------------------------------------
// A tiny local helper that lets you drive the Dark Souls III 100% walkthrough
// (https://ds3-community-guide.vercel.app) from your numpad while the game has
// focus. It relays two abstract actions to the guide page open in your browser:
//
//     numpad 8  ->  "nav-up"     (step to the previous walkthrough step)
//     numpad 2  ->  "nav-down"   (step to the next walkthrough step)
//
// What it is NOT: it does not read, log, store, or transmit your keystrokes.
// It watches for exactly two numpad keys, and when one is pressed it sends the
// WORD for that action (e.g. "nav-down") to your own machine at 127.0.0.1.
// Nothing leaves your computer except that one local message; your browser tab,
// which you opened yourself, picks it up and scrolls the guide.
//
// Two endpoints, that is the whole server:
//     GET  /api/events  -> a Server-Sent Events stream the guide subscribes to
//     POST /api/key     -> { action } ; relayed to every connected guide tab
//
// Run:  node controller.js [port]            (default 10030)
//       NO_LISTENER=1 node controller.js     (relay only; do not watch the numpad)
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const PORT = parseInt(process.argv[2], 10) || 10030;

// Only these page origins may receive events. The published guide, plus the
// local preview harness used while developing it. The server is also bound to
// 127.0.0.1 below, so the network cannot reach it at all; this list is the
// second lock, deciding WHICH website's tab is allowed to listen.
const ALLOWED = [
  "https://ds3-community-guide.vercel.app",
  "http://localhost:10040",
  "http://127.0.0.1:10040",
];
function cors(origin) {
  const ok = ALLOWED.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED[0],
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",   // answer Chrome's private-network preflight
    "Vary": "Origin",
  };
}

const clients = new Set();
function broadcast(obj) {
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of clients) { try { res.write(line); } catch {} }
}
function readBody(req) {
  return new Promise(resolve => {
    let d = "";
    req.on("data", c => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === "OPTIONS") { res.writeHead(204, cors(origin)); return res.end(); }

  if (url.pathname === "/api/events" && req.method === "GET") {
    res.writeHead(200, { ...cors(origin), "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    res.write("retry: 2000\n\n");
    res.write(`data: ${JSON.stringify({ action: "hello" })}\n\n`);
    clients.add(res);
    console.log(`  guide connected (${clients.size} open)`);
    const ka = setInterval(() => { try { res.write(": ka\n\n"); } catch {} }, 25000);
    req.on("close", () => { clearInterval(ka); clients.delete(res); console.log(`  guide left (${clients.size} open)`); });
    return;
  }

  if (url.pathname === "/api/key" && req.method === "POST") {
    const b = await readBody(req);
    if (b && b.action) { broadcast(b); console.log("  key ->", b.action); }
    res.writeHead(200, { ...cors(origin), "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, clients: clients.size }));
  }

  res.writeHead(404, cors(origin)); res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  DS3 Guide Numpad Controller -> http://127.0.0.1:${PORT}`);
  console.log(`  Allowed pages: ${ALLOWED.join(" , ")}`);
  console.log(`  Open the guide, enable the controller, then press numpad 8 / 2 to step up / down.`);
  console.log(`  Ctrl+C to stop.\n`);
  startListener();
});

function startListener() {
  if (process.env.NO_LISTENER) return console.log("  (numpad listener disabled via NO_LISTENER)");
  if (process.platform !== "win32") return console.log("  (numpad listener is Windows-only; POST {action:'nav-up'|'nav-down'} to /api/key to simulate)");
  const ps = path.join(__dirname, "numpad.ps1");
  const child = spawn("powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps, "-ServerUrl", `http://127.0.0.1:${PORT}`],
    { stdio: ["ignore", "inherit", "inherit"] });
  child.on("error", e => console.log("  listener failed:", e.message));
  const kill = () => { try { child.kill(); } catch {} };
  process.on("exit", kill);
  process.on("SIGINT", () => { kill(); process.exit(0); });
}
