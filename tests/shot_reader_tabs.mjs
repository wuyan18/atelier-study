/* 阅读器标签页截图：浅色 / 深色 / 窄窗口 */
import { writeFileSync } from "node:fs";
import path from "node:path";

const PROJ = path.resolve(import.meta.dirname, "..");
const OUT = path.join(PROJ, "tests", "shots", "after");
const PORT = process.env.CDP_PORT || "9333";
const BASE = "http://127.0.0.1:8765";
const PDF = "数据结构/03-实验/实验01/报告/report.pdf";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r, { once: true }));
let id = 0; const waiters = new Map();
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
});
const send = (method, params = {}) => new Promise(res => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const resize = (w, h) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
const shot = async name => {
  const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const data = s?.result?.data;
  if (!data) { console.log("shot failed", name, JSON.stringify(s).slice(0, 200)); return; }
  writeFileSync(path.join(OUT, name), Buffer.from(data, "base64"));
  console.log("saved", name);
};

await send("Page.enable");
await send("Runtime.enable");
await resize(1400, 900);

// 干净标签态 + 打开大 PDF
await send("Page.navigate", { url: `${BASE}/#/` });
await sleep(1200);
await ev(`sessionStorage.removeItem("atelier.reader.tabs"), true`);
await send("Page.reload", {});
await sleep(2000);
await send("Page.navigate", { url: `${BASE}/#/read?path=${encodeURIComponent(PDF)}` });
await sleep(3500);

// 第二个标签：通过选择器加入作业05
await ev(`document.querySelector(".rtab-add").click(), true`);
await sleep(700);
await ev(`(() => { const i = document.querySelector(".picker-search input");
  i.value = "作业05"; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
await sleep(400);
await shot("reader_picker.png");
await ev(`(() => { const rows = [...document.querySelectorAll(".picker-row")];
  (rows.find(r => r.textContent.includes("作业05-作答.pdf")) || rows[0]).click(); return true; })()`);
await sleep(3200);
await ev(`document.querySelectorAll("#reader-tabs .rtab")[0].click(), true`);
await sleep(2600);
await shot("reader_tabs.png");

// 深色（阅读器没有侧栏，直接切 html[data-theme] 再截图）
await ev(`document.documentElement.dataset.theme = "dark"; localStorage.setItem("atelier-theme", "dark"); true`);
await sleep(900);
await shot("reader_tabs_dark.png");

// 窄窗口（820）
await resize(820, 1000);
await sleep(1200);
await shot("reader_tabs_narrow.png");

// 还原
await resize(1400, 900);
await ev(`document.documentElement.dataset.theme = "auto"; localStorage.setItem("atelier-theme", "auto"); true`);
await send("Page.navigate", { url: `${BASE}/#/read?path=${encodeURIComponent(PDF)}&page=1` });
await sleep(1500);
await send("Page.navigate", { url: `${BASE}/#/` });
await sleep(900);
ws.close();
process.exit(0);
