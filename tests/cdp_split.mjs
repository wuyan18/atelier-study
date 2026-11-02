/* CDP 自动化：分屏阅读（主文件 + 对照文件并排）
   覆盖：分屏按钮、选择器打开第二份文件、左右独立翻页/缩放、
        URL split 参数持久化、直接带参进入、退出分屏、
        文档阅读器分屏（MD + PDF）、异常零容忍
   运行：node tests/cdp_split.mjs   （需 8765 服务 + 调试 Chrome，默认 9333） */
import { mkdirSync } from "node:fs";
import path from "node:path";

const PORT = process.env.CDP_PORT || 9333;
const BASE = "http://127.0.0.1:8765";
const PROJ = path.resolve(import.meta.dirname, "..");
const SHOTS = path.join(PROJ, "tests", "shots", "after");
mkdirSync(SHOTS, { recursive: true });

let ws = null, msgId = 0;
const pending = new Map();
const errors = [];
let pass = 0, fail = 0;

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, { resolve });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalRaw(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r && r.exceptionDetails) {
    const d = r.exceptionDetails.exception && (r.exceptionDetails.exception.description || r.exceptionDetails.exception.text);
    throw new Error("JS 异常：" + String(d).split("\n")[0]);
  }
  return r && r.result ? r.result.value : undefined;
}
const run = (body) => evalRaw(`(async () => { ${body} })()`);

async function waitFor(expr, timeout = 12000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    let v = false;
    try { v = await evalRaw(`!!(${expr})`); } catch { v = false; }
    if (v) return Date.now() - t0;
    await sleep(120);
  }
  throw new Error("等待超时：" + label);
}

function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${extra ? "  [" + extra + "]" : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? "  [" + extra + "]" : ""}`); }
}
function okEq(name, actual, expected) {
  ok(name, actual === expected, `实际 ${JSON.stringify(actual)} 期望 ${JSON.stringify(expected)}`);
}

async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, "base64"));
}

const PDF_A = "数据结构/03-实验/实验01/报告/report.pdf";
const PDF_B = "概统/02-作业/作业05/作业05-作答.pdf";
const MD_A = "数据结构/03-实验/实验01/报告/report.md";

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("没有可用的页面目标");
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push("exception: " + (d.exception && (d.exception.description || d.exception.value) || d.text));
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" "));
  }
};
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.bringToFront");
await send("Page.navigate", { url: "about:blank" });
await sleep(200);

const url = (rel, extra = "") => `${BASE}/#/read?path=${encodeURIComponent(rel)}${extra}`;

async function openReader(rel, extra = "", wait = ".pdf-page canvas") {
  await send("Page.navigate", { url: url(rel, extra) });
  await waitFor(`document.querySelector("${wait}")`, 15000, rel);
}

/* 在资料选择器里输入关键词并点选包含指定文件名的行 */
async function pickInPicker(kw, fileName) {
  await waitFor(`document.querySelector(".picker")`, 5000, "picker 打开");
  await run(`
    const inp = document.querySelector(".picker-search input");
    inp.value = ${JSON.stringify(kw)};
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  `);
  await sleep(250);
  await run(`
    const row = [...document.querySelectorAll(".picker-row")].find(r => r.textContent.includes(${JSON.stringify(fileName)}));
    if (!row) throw new Error("选择器里找不到 " + ${JSON.stringify(fileName)});
    row.click();
  `);
}

/* ---------- 0. 干净起点 ---------- */
await send("Page.navigate", { url: `${BASE}/#/` });
await sleep(900);
await evalRaw(`sessionStorage.removeItem("atelier.reader.tabs"), true`);
await send("Page.reload", { ignoreCache: false });
await sleep(1400);

/* ---------- 1. PDF 分屏：按钮 → 选择器 → 并排 ---------- */
await openReader(PDF_A);
ok("工具栏有分屏按钮", await evalRaw(`!!document.querySelector(".r-split")`));
await run(`document.querySelector(".r-split").click()`);
await pickInPicker("作业05", "作业05-作答.pdf");
await waitFor(`document.querySelector("#split-pane .pdf-page canvas")`, 15000, "分屏右侧画布");
ok("进入分屏后 reader-body.has-split", await evalRaw(`document.querySelector(".reader-body").classList.contains("has-split")`));
okEq("分屏标签显示对照 + 文件名",
  await evalRaw(`document.querySelector(".split-pane-label .pane-tag")?.textContent + "|" + (document.querySelector(".split-pane-label .pane-file")?.textContent.includes("作业05-作答.pdf"))`),
  "对照|true");
const leftCanvas = await evalRaw(`document.querySelectorAll("#pdf-scroll .pdf-page canvas").length`);
const rightCanvas = await evalRaw(`document.querySelectorAll("#split-pane .pdf-page canvas").length`);
ok("左右各有画布", leftCanvas >= 1 && rightCanvas >= 1, `左 ${leftCanvas} / 右 ${rightCanvas}`);
ok("URL 携带 split 参数", await evalRaw(`location.hash.includes("split=")`), await evalRaw(`location.hash`));
ok("分屏文件进入标签条", await evalRaw(`document.querySelectorAll("#reader-tabs .rtab").length`) === 2,
  `tabs=${await evalRaw(`document.querySelectorAll("#reader-tabs .rtab").length`)}`);
ok("分屏按钮呈激活态", await evalRaw(`document.querySelector(".r-split").classList.contains("active")`));

/* ---------- 2. 右侧独立翻页 / 缩放 ---------- */
await run(`document.querySelector("#split-pane .r-next").click()`);
await sleep(400);
okEq("右侧翻到第 2 页", await evalRaw(`document.querySelector("#split-pane .r-page").value`), "2");
okEq("左侧仍停在第 1 页", await evalRaw(`document.querySelector("#r-page").value`), "1");
const zBefore = await evalRaw(`document.querySelector("#split-pane .r-zoom-label").textContent`);
await run(`document.querySelector("#split-pane .r-zoom-in").click()`);
await sleep(500);
const zAfter = await evalRaw(`document.querySelector("#split-pane .r-zoom-label").textContent`);
ok("右侧可独立缩放", parseInt(zAfter) > parseInt(zBefore), `${zBefore} → ${zAfter}`);
await run(`document.querySelector("#split-pane .r-prev").click()`);   // 恢复第 1 页
await sleep(300);

/* ---------- 3. 翻页后 URL 保留 split（replaceState） ---------- */
await run(`document.querySelector("#r-next").click()`);
await sleep(500);
ok("左侧翻页后 URL 仍带 split",
  await evalRaw(`location.hash.includes("split=") && location.hash.includes("page=2")`),
  await evalRaw(`location.hash`));
await run(`document.querySelector("#r-prev").click()`);
await sleep(300);

await shot("reader_split.png");

/* ---------- 4. 退出分屏 ---------- */
await run(`document.querySelector(".sp-close").click()`);
await waitFor(`!document.querySelector("#split-pane")`, 8000, "退出分屏");
await waitFor(`document.querySelectorAll("#pdf-scroll .pdf-page canvas").length >= 1`, 10000, "退出后主画布");
ok("退出后回到单栏", await evalRaw(`!document.querySelector(".split-pane")`));
ok("退出后 URL 不带 split", await evalRaw(`!location.hash.includes("split=")`), await evalRaw(`location.hash`));
ok("退出后分屏文件仍留在标签条", await evalRaw(`document.querySelectorAll("#reader-tabs .rtab").length`) === 2);
ok("分屏按钮恢复常态", await evalRaw(`!document.querySelector(".r-split").classList.contains("active")`));

/* ---------- 5. 直接带参进入：splitpage 恢复页码 ---------- */
await send("Page.navigate", { url: `${BASE}/#/read?path=${encodeURIComponent(PDF_A)}&page=1&split=${encodeURIComponent(PDF_B)}&splitpage=2` });
await waitFor(`document.querySelector("#split-pane .pdf-page canvas")`, 15000, "带参分屏");
okEq("带参进入：右侧恢复到第 2 页", await evalRaw(`document.querySelector("#split-pane .r-page").value`), "2");

/* 深色分屏截图 */
await run(`document.documentElement.dataset.theme = "dark"; localStorage.setItem("atelier-theme", "dark"); true`);
await sleep(400);
await shot("reader_split_dark.png");
await run(`document.documentElement.dataset.theme = ""; localStorage.removeItem("atelier-theme"); true`);

/* 窄窗口：分屏改上下排列 */
await send("Emulation.setDeviceMetricsOverride", { width: 820, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(600);
const narrowDir = await evalRaw(`getComputedStyle(document.querySelector(".reader-body.has-split")).flexDirection`);
okEq("窄窗口分屏改为上下排列", narrowDir, "column");
await shot("reader_split_narrow.png");
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(400);

/* ---------- 6. 文档阅读器分屏：MD + PDF ---------- */
await run(`document.querySelector(".sp-close").click()`);
await waitFor(`!document.querySelector("#split-pane")`, 8000, "退出 PDF 分屏");
await openReader(MD_A, "", ".md-view");
ok("文档工具栏有分屏按钮", await evalRaw(`!!document.querySelector("#d-split")`));
await run(`document.querySelector("#d-split").click()`);
await pickInPicker("作业05", "作业05-作答.pdf");
await waitFor(`document.querySelector("#split-pane .pdf-page canvas")`, 15000, "MD 分屏右侧画布");
ok("MD 分屏结构 doc-body.has-split", await evalRaw(`document.querySelector(".doc-body").classList.contains("has-split")`));
ok("左侧 Markdown 正常渲染", await evalRaw(`document.querySelector(".doc-main .md-view") !== null && document.querySelector(".doc-main .md-view").innerText.length > 100`));
ok("右侧 PDF 正常渲染", await evalRaw(`document.querySelectorAll("#split-pane .pdf-page canvas").length >= 1`));
await shot("reader_split_md.png");
await run(`document.querySelector("#d-split").click()`);   // 工具栏按钮再次点击 = 退出
await waitFor(`!document.querySelector("#split-pane")`, 8000, "MD 退出分屏");
await waitFor(`document.querySelector(".md-view")`, 10000, "MD 退出后正文");
ok("MD 退出分屏后正文仍在", await evalRaw(`document.querySelector(".md-view") !== null && !document.querySelector(".doc-body").classList.contains("has-split")`));

/* ---------- 7. 清理与总结 ---------- */
await run(`sessionStorage.removeItem("atelier.reader.tabs"), true`);

console.log("");
if (errors.length) {
  console.log("页面异常：");
  for (const e of errors) console.log("  " + e.split("\n")[0]);
}
ok("零 JS 异常 / 零 console.error", errors.length === 0, `${errors.length} 条`);
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
