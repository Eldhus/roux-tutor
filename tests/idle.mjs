// An idle page draws nothing. With the GPU off a page that keeps changing pixels is redrawn on the
// CPU every frame: an endless 8px pulse cost a whole core. This opens every page the nav links to in
// headless Brave, GPU off, lets it settle, then records a screencast, which sends a frame only when
// the pixels change, and fails a page that sends any.
//
//   node tests/idle.mjs [http://127.0.0.1:8080]     the app running (./roux dev main.roc)
//
// Node 22 or later (its WebSocket and fetch); BROWSER names a Chromium other than brave.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = new URL(process.argv[2] ?? "http://127.0.0.1:8080");
const settle_ms = 10_000; // longest a finite animation may run after load
const watch_ms = 2_000; // how long a settled page must stay still

const profile = mkdtempSync(join(tmpdir(), "idle-"));
const browser = spawn(process.env.BROWSER ?? "brave", [
  "--headless=new", "--disable-gpu", "--disable-gpu-compositing", "--no-first-run",
  "--window-size=1280,900", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

let failed = 0;
try {
  const socket = await connect();
  const cdp = protocol(socket);
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const page = (method, params) => cdp.send(method, params, sessionId);
  await page("Page.enable");

  await open(page, cdp, sessionId, base.href);
  const links = await evaluate(page, `[...document.querySelectorAll("nav a")].map((a) => a.href)`);
  const paths = [...new Set(links.filter((href) => new URL(href).origin === base.origin))];
  if (paths.length === 0) throw new Error(`no nav links on ${base.href}`);

  for (const url of paths) {
    await open(page, cdp, sessionId, url);
    const running = await settled(page);
    const frames = running.length === 0 ? await still(page, cdp, sessionId) : 0;
    const path = new URL(url).pathname;
    if (running.length > 0) {
      failed += 1;
      console.log(`FAIL ${path}: still animating after ${settle_ms / 1000}s: ${running.join(", ")}`);
    } else if (frames > 0) {
      failed += 1;
      console.log(`FAIL ${path}: ${frames} frames drawn in ${watch_ms / 1000}s while idle`);
    } else {
      console.log(`ok   ${path}`);
    }
  }
  socket.close();
} finally {
  browser.kill();
  await new Promise((done) => browser.once("exit", done));
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);

// The browser's DevTools socket, once it has written its port.
async function connect() {
  for (let tries = 0; tries < 100; tries += 1) {
    let port;
    try {
      port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
    } catch {
      await sleep(100);
      continue;
    }
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((done, fail) => {
      socket.onopen = done;
      socket.onerror = () => fail(new Error("DevTools socket"));
    });
    return socket;
  }
  throw new Error("the browser never opened its DevTools port");
}

// Requests answered by id; events handed to whoever waits for them.
function protocol(socket) {
  let next = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id !== undefined) {
      const { done, fail } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? fail(new Error(message.error.message)) : done(message.result);
    } else {
      for (const listener of listeners) listener(message);
    }
  };
  return {
    send(method, params = {}, sessionId) {
      next += 1;
      socket.send(JSON.stringify({ id: next, method, params, sessionId }));
      return new Promise((done, fail) => pending.set(next, { done, fail }));
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

async function open(page, cdp, sessionId, url) {
  const loaded = new Promise((done) => {
    const off = cdp.on((m) => {
      if (m.sessionId === sessionId && m.method === "Page.loadEventFired") off(), done();
    });
  });
  await page("Page.navigate", { url });
  await loaded;
}

async function evaluate(page, expression) {
  const { result, exceptionDetails } = await page("Runtime.evaluate", { expression, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
}

// Waits for every animation to finish; what still runs after settle_ms, by name.
async function settled(page) {
  const running = `document.getAnimations().filter((a) => a.playState === "running")
    .map((a) => (a.animationName ?? a.id ?? "animation") + " on " + (a.effect?.target?.className || a.effect?.target?.tagName))`;
  const deadline = Date.now() + settle_ms;
  for (;;) {
    const names = await evaluate(page, running);
    if (names.length === 0 || Date.now() > deadline) return names;
    await sleep(200);
  }
}

// Frames drawn while watching. The screencast sends one frame when it starts; any after that is a
// change on screen.
async function still(page, cdp, sessionId) {
  let frames = 0;
  const off = cdp.on((m) => {
    if (m.sessionId !== sessionId || m.method !== "Page.screencastFrame") return;
    frames += 1;
    page("Page.screencastFrameAck", { sessionId: m.params.sessionId });
  });
  await page("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  await sleep(watch_ms);
  await page("Page.stopScreencast");
  off();
  return Math.max(0, frames - 1);
}
