/* shot_narrow.mjs — 窄窗口布局截图 + 全站 console error 清扫 (CDP 9333) */
import fs from "node:fs";
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = "http://127.0.0.1:8765";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
const errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(["home", (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || "").slice(0, 200)]);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(["console", (m.params.args?.map(a => a.value ?? a.description).join(" ") || "").slice(0, 200)]);
});
function send(method, params = {}) {
  const mid = ++id;
  return new Promise((res, rej) => pending.set(mid, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))), ws.send(JSON.stringify({ id: mid, method, params })));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send("Runtime.enable"); await send("Page.enable");
await send("Page.bringToFront");

/* --- 1. 窄窗口 800x900 书架 + 课程页 --- */
await send("Emulation.setDeviceMetricsOverride", { width: 800, height: 900, deviceScaleFactor: 1, mobile: false });
for (const [name, url] of [
  ["narrow_home", `${BASE}/#/`],
  ["narrow_course", `${BASE}/#/course/${encodeURIComponent("数据结构")}`],
]) {
  await send("Page.navigate", { url });
  await sleep(2600);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`tests/shots/after/${name}.png`, Buffer.from(data, "base64"));
  console.log("saved", name);
}
await send("Emulation.clearDeviceMetricsOverride");

/* --- 2. console error 清扫：遍历所有路由 --- */
const routes = [
  `${BASE}/#/`,
  `${BASE}/#/recent`,
  `${BASE}/#/courses`,
  `${BASE}/#/progress`,
  `${BASE}/#/starred`,
  `${BASE}/#/search?q=Cauchy`,
  `${BASE}/#/search`,
  `${BASE}/#/course/${encodeURIComponent("数据结构")}`,
  `${BASE}/#/course/${encodeURIComponent("形式语言与自动机")}`,
  `${BASE}/#/read?path=${encodeURIComponent("数据结构/03-实验/实验01/报告/report.pdf")}&page=2`,
  `${BASE}/#/read?path=${encodeURIComponent("数据结构/03-实验/实验01/报告/report.md")}`,
  `${BASE}/#/read?path=${encodeURIComponent("数据结构/03-实验/实验01/代码/solution_1.cpp")}`,
  `${BASE}/#/read?path=${encodeURIComponent("法语1/04-资料/法语1-小测01-复习卡.docx")}`,
  `${BASE}/#/read?path=${encodeURIComponent("数据结构/03-实验/实验01/报告/jietu.png")}`,
  `${BASE}/#/read?path=${encodeURIComponent("数据结构/03-实验/实验01/实验01-原始压缩包.zip")}`,
  `${BASE}/#/compare?dir=${encodeURIComponent("形式语言与自动机/02-作业/作业01")}`,
];
for (const url of routes) {
  await send("Page.navigate", { url });
  await sleep(3200);
  console.log("visited", url.replace(BASE, "").slice(0, 60));
}
console.log("\n=== CONSOLE ERRORS ===");
console.log(errors.length ? errors.map(e => `[${e[0]}] ${e[1]}`).join("\n") : "CLEAN — no JS exceptions / console.error");
fs.writeFileSync("tests/shots/console_sweep.txt", errors.length ? errors.map(e => `[${e[0]}] ${e[1]}`).join("\n") : "CLEAN");
process.exit(0);
