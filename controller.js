#!/usr/bin/env node
"use strict";
// DS3 Guide Numpad Controller
// ---------------------------------------------------------------------------
// A small local helper that lets you drive the Dark Souls III 100% walkthrough
// (https://ds3-community-guide.vercel.app) from your numpad while the game has
// focus, and contribute a screenshot from the same keypad.
//
//   Play:     8 step up   2 step down   5 tick step   4/6 prev/next chapter
//             9 capture a Steam screenshot and submit it to the highlighted step
//             0 toggle screenshot-edit mode
//   Edit:     4/6 pick one of the step's screenshots   9 replace it   7 remove it   0 exit
//
// What it does NOT do: it does not read, log, store, or transmit your keystrokes.
// It watches a fixed set of numpad keys, and on a press it sends the WORD for that
// action (e.g. "nav-down") to your own machine at 127.0.0.1. For a capture it copies
// the screenshot YOU took with Steam (F12) into a local folder and serves those bytes
// to your own browser tab, which uploads it under your account. Nothing else leaves
// your computer.
//
//   GET  /api/events     -> Server-Sent Events stream the guide subscribes to
//   POST /api/key        -> { action, file? } ; relayed to every connected guide tab
//   GET  /shot/<file>    -> the JPEG you just captured, for your own tab to upload
//   POST /api/discard    -> { file } ; delete a captured file after it is uploaded
//
// Run:  node controller.js [port]            (default 10030)
//       NO_LISTENER=1 node controller.js     (relay only; do not watch the numpad)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = parseInt(process.argv[2], 10) || 10030;
const QUEUE_DIR = path.join(__dirname, ".queue");   // captured Steam screenshots land here
fs.mkdirSync(QUEUE_DIR, { recursive: true });

// Only these page origins may talk to the controller. The published guide, plus the
// local preview harness used while developing it. The server is also bound to
// 127.0.0.1 below, so the network cannot reach it; this list is the second lock.
const ALLOWED = [
  "https://ds3-community-guide.vercel.app",
  "http://localhost:10040",
  "http://127.0.0.1:10040",
  "http://localhost:10050",
  "http://127.0.0.1:10050",
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

// Only ever touch a plain image filename inside the queue (no path traversal).
function safeQueuePath(name) {
  const base = path.basename(String(name || ""));
  if (!/^[A-Za-z0-9._-]+\.(jpe?g|png)$/i.test(base)) return null;
  return path.join(QUEUE_DIR, base);
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
    if (b && b.action) { broadcast(b); console.log("  key ->", b.action + (b.file ? ` (${b.file})` : "")); }
    res.writeHead(200, { ...cors(origin), "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, clients: clients.size }));
  }

  // Serve a captured screenshot to your own tab so it can resize + upload it.
  if (url.pathname.startsWith("/shot/") && req.method === "GET") {
    const p = safeQueuePath(decodeURIComponent(url.pathname.slice("/shot/".length)));
    if (!p || !fs.existsSync(p)) { res.writeHead(404, cors(origin)); return res.end("no such shot"); }
    const ct = /\.png$/i.test(p) ? "image/png" : "image/jpeg";
    res.writeHead(200, { ...cors(origin), "Content-Type": ct, "Cache-Control": "no-store" });
    return fs.createReadStream(p).pipe(res);
  }

  // Drop a captured file once the tab has uploaded it.
  if (url.pathname === "/api/discard" && req.method === "POST") {
    const b = await readBody(req);
    const p = safeQueuePath(b.file);
    if (p) { try { fs.unlinkSync(p); } catch {} }
    res.writeHead(200, { ...cors(origin), "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  res.writeHead(404, cors(origin)); res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  DS3 Guide Numpad Controller -> http://127.0.0.1:${PORT}`);
  console.log(`  Allowed pages: ${ALLOWED.join(" , ")}`);
  console.log(`  Captures go to: ${QUEUE_DIR}`);
  console.log(`  Enable the controller on the guide's Controller page, then use the numpad.`);
  console.log(`  Ctrl+C to stop.\n`);
  startListener();
});

function startListener() {
  if (process.env.NO_LISTENER) return console.log("  (numpad listener disabled via NO_LISTENER)");
  if (process.platform !== "win32") return console.log("  (numpad listener is Windows-only; POST {action} to /api/key to simulate)");
  const ps = path.join(__dirname, "numpad.ps1");
  const child = spawn("powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps, "-ServerUrl", `http://127.0.0.1:${PORT}`, "-QueueDir", QUEUE_DIR],
    { stdio: ["ignore", "inherit", "inherit"] });
  child.on("error", e => console.log("  listener failed:", e.message));
  const kill = () => { try { child.kill(); } catch {} };
  process.on("exit", kill);
  process.on("SIGINT", () => { kill(); process.exit(0); });
}
