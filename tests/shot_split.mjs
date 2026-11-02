/* shot_split.mjs — 分屏阅读功能截图（浅色/深色/窄窗口 + MD 混排） */
const PORT = process.env.CDP_PORT || "9333";
const BASE = "http://127.0.0.1:8765";
const PDF_A = "数据结构/03-实验/实验01/报告/report.pdf";
const PDF_B = "形式语言与自动机/02-作业/作业05/作业05-作答.pdf";
const MD_A = "数据结构/03-实验/实验01/报告/report.md";

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
async function ev(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r && r.exceptionDetails) throw new Error("eval EXCEPTION: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r?.result?.value;
}
async function shot(file) {
  const s = await send("Page.captureScreenshot", { format: "png" });
  const b = Buffer.from(s?.result?.data || s?.data, "base64");
  const fs = await import("node:fs");
  fs.writeFileSync(file, b);
  console.log("SAVE", file, b.length, "B");
}

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
const fs = await import("node:fs");
fs.mkdirSync("docs/screenshots", { recursive: true });
fs.mkdirSync("tests/shots/after", { recursive: true });

async function go(url, settle = 4200) {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await send("Page.navigate", { url });
  await sleep(settle);
  await send("Page.reload", { ignoreCache: true });
  await sleep(settle);
}

/* ---------- 1. PDF+PDF 分屏 浅色 1400×900 ---------- */
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.bringToFront");
await ev(`sessionStorage.removeItem("atelier.reader.tabs")`);
await go(`${BASE}/#/read?path=${encodeURIComponent(PDF_A)}&split=${encodeURIComponent(PDF_B)}`);
await shot("tests/shots/after/reader_split.png");
await shot("docs/screenshots/reader-split.png");

/* ---------- 2. 深色 ---------- */
await ev(`document.documentElement.dataset.theme = "dark"; localStorage.setItem("atelier-theme","dark")`);
await sleep(400);
await shot("tests/shots/after/reader_split_dark.png");
await shot("docs/screenshots/reader-split-dark.png");

/* ---------- 3. 窄窗口 820×1000（上下排列） ---------- */
await send("Emulation.setDeviceMetricsOverride", { width: 820, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(600);
await shot("tests/shots/after/reader_split_narrow.png");
await shot("docs/screenshots/reader-split-narrow.png");
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });

/* ---------- 4. MD + PDF 混排 ---------- */
await go(`${BASE}/#/read?path=${encodeURIComponent(MD_A)}&split=${encodeURIComponent(PDF_B)}`, 3600);
await shot("tests/shots/after/reader_split_md.png");

/* ---------- 5. 还原 ---------- */
await ev(`document.documentElement.dataset.theme = "auto"; localStorage.setItem("atelier-theme","auto")`);
await ev(`sessionStorage.removeItem("atelier.reader.tabs")`);
console.log("DONE");
process.exit(0);
