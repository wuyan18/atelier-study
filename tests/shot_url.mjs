/* 通用单页截图：node tests/shot_url.mjs --url=... --out=... [--w=1280] [--h=900] [--wait=2500] [--eval="..."] */
import { writeFileSync } from "node:fs";
import path from "node:path";

const PROJ = path.resolve(import.meta.dirname, "..");

const args = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m) args[m[1]] = m[2];
}

const PORT = process.env.CDP_PORT || 9333;
const url = args.url || "http://127.0.0.1:8765/#/exams";
const out = args.out || path.join(PROJ, "tests", "shot.png");
const W = Number(args.w || 1280);
const H = Number(args.h || 900);
const WAIT = Number(args.wait || 2200);
const idle = Number(args.idle || 900);

let ws = null, msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, { resolve });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); }
};
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.bringToFront");
await send("Page.navigate", { url: "about:blank" });
await sleep(150);
await send("Page.navigate", { url });
await sleep(600);
await send("Page.reload", { ignoreCache: true });
await sleep(WAIT);
await sleep(idle);

if (args.theme) {
  await send("Runtime.evaluate", {
    expression: `document.querySelector('[data-theme-set="${args.theme}"]').click()`,
  });
  await sleep(500);
}

if (args.eval) {
  const r = await send("Runtime.evaluate", { expression: args.eval, awaitPromise: true, returnByValue: true });
  if (r && r.exceptionDetails) {
    console.log("eval EXCEPTION:", JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  } else {
    console.log("eval:", JSON.stringify(r && r.result && r.result.value));
  }
  await sleep(Number(args.after || 700));
}

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("saved", out);
process.exit(0);
