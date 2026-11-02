/* CDP 自动化：阅读器标签页 / 缩放交互 / 首屏加载性能
   覆盖：标签条渲染、多文件打开切换、关闭标签、资料选择器、
        缩放按钮可点击尺寸、无级缩放（点击 & Ctrl+滚轮）、首屏耗时、
        只渲染当前页（不全量拉取整本）
   运行：node tests/cdp_reader.mjs   （需 8765 服务 + 调试 Chrome，默认 9223） */
import { mkdirSync } from "node:fs";
import path from "node:path";

const PORT = process.env.CDP_PORT || 9223;
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
    const d = r.exceptionDetails.exception && (r.exceptionDetails.exception.description || r.exceptionDetails.text);
    throw new Error("JS 异常：" + String(d).split("\n")[0]);
  }
  return r && r.result ? r.result.value : undefined;
}
const run = (body) => evalRaw(`(async () => { ${body} })()`);

async function waitFor(expr, timeout = 9000, label = expr) {
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
const PDF_BIG = "数据结构/01-课件/dsa26.pdf";

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
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.bringToFront");
await send("Page.navigate", { url: "about:blank" });
await sleep(200);

const url = (rel, extra = "") => `${BASE}/#/read?path=${encodeURIComponent(rel)}${extra}`;

async function openReader(rel, extra = "", wait = ".pdf-page canvas") {
  const t0 = Date.now();
  await send("Page.navigate", { url: url(rel, extra) });
  const dt = await waitFor(`document.querySelector("${wait}")`, 12000, rel);
  return Date.now() - t0 || dt;
}

/* ---------- 1. 首屏性能：大文件 ---------- */
await send("Page.navigate", { url: `${BASE}/#/` });
await sleep(1000);
await evalRaw(`sessionStorage.removeItem("atelier.reader.tabs"), true`);
await send("Page.reload", { ignoreCache: false });   // 让模块重新读取空标签态
await sleep(1500);
const tBig = await openReader(PDF_BIG);
console.log(`大文件首屏耗时 ${tBig} ms（${PDF_BIG}）`);
ok("大 PDF 首屏 < 4000ms", tBig < 4000, `${tBig}ms`);
const canvasCount = await evalRaw(`document.querySelectorAll(".pdf-page canvas").length`);
ok("首屏只渲染少量页面（未全量渲染）", canvasCount <= 6, `canvas=${canvasCount}`);
const wrapperCount = await evalRaw(`document.querySelectorAll(".pdf-page").length`);
ok("页占位符按页数生成", wrapperCount > 100, `占位 ${wrapperCount}`);

/* ---------- 2. 标签条 ---------- */
const tabs0 = await evalRaw(`document.querySelectorAll("#reader-tabs .rtab").length`);
okEq("打开文件后有 1 个标签", tabs0, 1);
const activeName = await evalRaw(`document.querySelector("#reader-tabs .rtab.active .rtab-name")?.textContent || ""`);
ok("当前标签是 dsa26.pdf", activeName === "dsa26.pdf", activeName);

/* ---------- 3. 资料选择器打开第二个文件 ---------- */
await evalRaw(`document.querySelector(".rtab-add").click(), true`);
await waitFor(`document.querySelector(".picker")`, 4000, "选择器弹窗");
await shot("reader_picker.png");
await evalRaw(`
  const i = document.querySelector(".picker-search input");
  i.value = "作业05";
  i.dispatchEvent(new Event("input", { bubbles: true }));
  true`);
await sleep(300);
const rows = await evalRaw(`document.querySelectorAll(".picker-row").length`);
ok("选择器按关键词筛选", rows > 0, `命中 ${rows}`);
await evalRaw(`
  const rows = [...document.querySelectorAll(".picker-row")];
  const hit = rows.find(r => r.textContent.includes("作业05-作答.pdf")) || rows[0];
  hit.click(); true`);
await waitFor(`document.querySelectorAll("#reader-tabs .rtab").length === 2`, 9000, "第二个标签");
const tabs1 = await evalRaw(`[...document.querySelectorAll("#reader-tabs .rtab .rtab-name")].map(e => e.textContent)`);
ok("标签条同时存在两份资料", tabs1.length === 2, tabs1.join(" | "));
ok("第二个标签是 作业05-作答.pdf", tabs1.some(n => n === "作业05-作答.pdf"), tabs1.join(" | "));
await sleep(800);
await shot("reader_tabs.png");

/* ---------- 4. 切回第一个标签：页码保留 ---------- */
// 回到第一个标签（dsa26），翻两页
await evalRaw(`document.querySelectorAll("#reader-tabs .rtab")[0].click(), true`);
await waitFor(`document.querySelector("#reader-tabs .rtab.active .rtab-name")?.textContent === "dsa26.pdf"`, 9000, "切回标签 1");
await waitFor(`document.querySelector(".pdf-page canvas")`, 9000, "标签 1 渲染");
await sleep(500);
await evalRaw(`document.getElementById("r-next").click(), true`);
await sleep(600);
await evalRaw(`document.getElementById("r-next").click(), true`);
await sleep(1800);
const pageBefore = await evalRaw(`document.getElementById("r-page").value`);
ok("翻页后页码变化", Number(pageBefore) >= 2, `page=${pageBefore}`);

// 切到标签 2 再切回来
await evalRaw(`document.querySelectorAll("#reader-tabs .rtab")[1].click(), true`);
await waitFor(`document.querySelector("#reader-tabs .rtab.active .rtab-name")?.textContent === "作业05-作答.pdf"`, 9000, "切到标签 2");
await waitFor(`document.querySelector(".pdf-page canvas")`, 9000, "标签 2 渲染");
await sleep(600);
await evalRaw(`document.querySelectorAll("#reader-tabs .rtab")[0].click(), true`);
await waitFor(`location.hash.includes("dsa26.pdf")`, 9000, "再次切回标签 1");
await waitFor(`document.querySelector(".pdf-page canvas")`, 9000, "标签 1 重新渲染");
await sleep(900);
const pageAfter = await evalRaw(`document.getElementById("r-page").value`);
okEq("切回标签后恢复上次页码", pageAfter, pageBefore);
const activeAfterSwitch = await evalRaw(`document.querySelector("#reader-tabs .rtab.active .rtab-name")?.textContent || ""`);
okEq("切回后激活标签正确", activeAfterSwitch, "dsa26.pdf");

/* ---------- 5. 缩放：按钮尺寸 + 点击缩放 + Ctrl 滚轮 ---------- */
const btnW = await evalRaw(`Math.round(document.getElementById("r-zoom-in").getBoundingClientRect().width)`);
ok("放大按钮点击区域 ≥ 36px", btnW >= 36, `${btnW}px`);
const z0 = await evalRaw(`document.getElementById("r-zoom-label").textContent`);
await evalRaw(`document.getElementById("r-zoom-in").click(), true`);
await sleep(500);
const z1 = await evalRaw(`document.getElementById("r-zoom-label").textContent`);
ok("点击放大后比例变化", z0 !== z1, `${z0} → ${z1}`);

// Ctrl + 滚轮
const box = await evalRaw(`(() => { const r = document.getElementById("pdf-scroll").getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
await send("Input.dispatchMouseEvent", {
  type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: -120, modifiers: 2,
});
await sleep(700);
const z2 = await evalRaw(`document.getElementById("r-zoom-label").textContent`);
ok("Ctrl + 滚轮可缩放文档", z1 !== z2, `${z1} → ${z2}`);
const pageZoom = await evalRaw(`Math.round(window.visualViewport.scale * 100) / 100`);
okEq("浏览器整页缩放未被触发", pageZoom, 1);
await shot("reader_zoom.png");

/* ---------- 6. 继续阅读进度仍然写回 ---------- */
await evalRaw(`document.getElementById("r-next").click(), true`);
await sleep(900);
const st = await (await fetch(`${BASE}/api/state`)).json();
const prog = st.progress[PDF_BIG];
ok("翻页写入阅读进度", !!prog && prog.page >= 2, JSON.stringify(prog));

/* ---------- 7. 关闭标签 ---------- */
const tabsBefore = await evalRaw(`document.querySelectorAll("#reader-tabs .rtab").length`);
await evalRaw(`document.querySelector("#reader-tabs .rtab .rtab-x").dispatchEvent(new MouseEvent("click", { bubbles: true })), true`);
await sleep(1500);
const tabs2 = await evalRaw(`document.querySelectorAll("#reader-tabs .rtab").length`);
ok("关闭标签后数量减少", tabs2 === tabsBefore - 1, `${tabsBefore} → ${tabs2}`);

/* ---------- 8. 控制台 ---------- */
ok("无 JS 异常 / console.error", errors.length === 0, errors.slice(0, 3).join(" || "));

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
