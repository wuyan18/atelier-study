/* 通过 CDP 截图若干页面（真实渲染，含 PDF 懒渲染） */
import { writeFileSync } from "node:fs";
import path from "node:path";

const PROJ = path.resolve(import.meta.dirname, "..");

const PORT = process.env.CDP_PORT || 9333;
const BASE = "http://127.0.0.1:8765";
const shots = [
  ["shot_home.png", `${BASE}/#/`],
  ["shot_course.png", `${BASE}/#/course/${encodeURIComponent("数据结构")}`],
  ["shot_compare.png", `${BASE}/#/compare?dir=${encodeURIComponent("形式语言与自动机/02-作业/作业01")}`],
  ["shot_reader.png", `${BASE}/#/read?path=${encodeURIComponent("数据结构/03-实验/实验01/报告/report.pdf")}&page=1`],
  ["shot_search.png", `${BASE}/#/search?q=${encodeURIComponent("Cauchy")}`],
  ["shot_md.png", `${BASE}/#/read?path=${encodeURIComponent("数据结构/03-实验/实验01/报告/report.md")}`],
];

let ws = null, msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, { resolve });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page");
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); }
};
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

for (const [file, url] of shots) {
  await send("Page.bringToFront");
  await send("Page.navigate", { url: "about:blank" });
  await sleep(150);
  await send("Page.navigate", { url });
  await sleep(900);
  await send("Page.reload", { ignoreCache: true });
  await sleep(4200);
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(path.join(PROJ, "tests", file), Buffer.from(r.data, "base64"));
  console.log("saved", file);
}
process.exit(0);
