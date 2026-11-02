/* cdp_hard.mjs �?硬重载（忽略缓存）后�?P1 全套 */
import { spawn } from "node:child_process";

const PORT = Number(process.env.CDP_PORT || 9223), BASE = "http://127.0.0.1:8765";
let ws = null, msgId = 0;
const pending = new Map();
const errors = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find(t => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      errors.push("EXC: " + (d.exception?.description || d.text));
    }
  };
  await send("Runtime.enable");
  await send("Page.enable");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result.value;
}
async function nav(url, wait = 2600) {
  await send("Page.bringToFront");
  await send("Page.navigate", { url });
  await sleep(wait);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${detail}`);
}

await connect();
// 硬重载拿�?JS
await send("Page.bringToFront");
await send("Page.reload", { ignoreCache: true });
await sleep(3000);

/* 1. Markdown（report.md，行�?$..$ 公式�?*/
await nav(`${BASE}/#/read?path=${encodeURIComponent("数据结构/03-实验/实验01/报告/report.md")}`);
{
  const info = await ev(`(() => {
    const md = document.querySelector(".md-view");
    if (!md) return { err: "no .md-view", main: document.getElementById("main")?.className };
    return {
      h2: md.querySelectorAll("h2").length,
      pre: md.querySelectorAll("pre").length,
      katex: md.querySelectorAll(".katex").length,
      errK: md.querySelectorAll(".katex-error, .katex-merror").length,
      tables: md.querySelectorAll("table").length,
    };
  })()`);
  record("MD render", !info.err && info.h2 > 0, JSON.stringify(info));
  // report.md �?14 �?$..$，其�?5 对是真实 LaTeX 公式（\times/\in 区间）→ 全部渲染�?  // 其余 9 对是表格中变量引用（{x} 等）非数学公式，不渲染属正确行为
  record("MD katex", info.katex >= 5 && info.errK === 0, `katex=${info.katex} errK=${info.errK}`);
  const kText = await ev(`document.querySelector(".md-view .katex")?.innerText?.slice(0, 30) || ""`);
  record("MD katex text", kText.length > 0, JSON.stringify(kText));
}

/* 资料根目录会随课程整理变动，按文件名后缀在树里定位，避免测试写死旧路径 */
const RELS = (() => {
  const out = { files: [], dirs: [] };
  const walk = n => {
    for (const c of n.children || []) {
      if (c.type === "dir") { out.dirs.push(c.rel); walk(c); }
      else out.files.push(c.rel);
    }
  };
  return { out, walk };
})();
{
  const tree = await (await fetch(`${BASE}/api/tree`)).json();
  for (const c of tree.courses || []) RELS.walk(c);
}
const findRel = suffix => RELS.out.files.find(r => r.endsWith(suffix)) || suffix;

/* 2. 大纲.md（Unicode 数学，随整理移动过位置） */
await nav(`${BASE}/#/read?path=${encodeURIComponent(findRel("复变函数-课堂笔记大纲.md"))}`);
{
  const info = await ev(`(() => {
    const md = document.querySelector(".md-view");
    if (!md) return { err: "no .md-view" };
    return { len: md.innerText.length, h: md.querySelectorAll("h1,h2,h3").length };
  })()`);
  record("MD outline readable", !info.err && info.len > 1000, JSON.stringify(info));
}

/* 3. DOCX 复习�?*/
await nav(`${BASE}/#/read?path=${encodeURIComponent("法语1/04-资料/法语1-小测01-复习卡.docx")}`, 3500);
{
  const info = await ev(`(() => {
    const d = document.querySelector(".docx-view");
    if (!d) return { err: "no .docx-view", main: document.getElementById("main")?.innerHTML?.slice(0, 200) };
    return { len: d.innerText.length, imgs: d.querySelectorAll("img").length };
  })()`);
  record("DOCX render", !info.err && info.len > 50, JSON.stringify(info).slice(0, 220));
}

/* 4. 代码 solution_1.cpp（prism 高亮�?*/
await nav(`${BASE}/#/read?path=${encodeURIComponent("数据结构/03-实验/实验01/代码/solution_1.cpp")}`);
{
  const info = await ev(`(() => {
    const pre = document.querySelector("pre.code-view");
    if (!pre) return { err: "no code-view" };
    return { tok: pre.querySelectorAll("span.token").length, lang: pre.querySelector("code")?.className || "" };
  })()`);
  record("Code + prism", !info.err && info.tok > 10, JSON.stringify(info));
}

/* 5. 图片 jietu.png（同目录只有一张，画廊=1�?*/
await nav(`${BASE}/#/read?path=${encodeURIComponent("数据结构/03-实验/实验01/报告/jietu.png")}`, 1500);
{
  const info = await ev(`(() => {
    const img = document.querySelector(".img-stage img");
    if (!img) return { err: "no img", main: document.getElementById("main")?.innerHTML?.slice(0, 200) };
    return { loaded: img.naturalWidth > 0, w: img.naturalWidth, gallery: document.querySelectorAll(".gallery img").length };
  })()`);
  record("Image render", info.loaded === true, JSON.stringify(info));
}

/* 6. ZIP */
await nav(`${BASE}/#/read?path=${encodeURIComponent(findRel("实验01-原始压缩包.zip"))}`);
{
  const info = await ev(`(() => {
    const z = document.querySelector(".zip-view");
    if (!z) return { err: "no zip-view" };
    return { rows: z.querySelectorAll("tbody tr").length };
  })()`);
  record("ZIP listing", !info.err && info.rows >= 12, JSON.stringify(info));
}

/* 7. 对照：规范配对（形式语言作业01�?*/
await nav(`${BASE}/#/compare?dir=${encodeURIComponent("形式语言与自动机/02-作业/作业01")}`, 3500);
{
  const info = await ev(`(() => ({
    q: document.querySelector("#pane-q .pane-label")?.innerText || "",
    a: document.querySelector("#pane-a .pane-label")?.innerText || "",
    canvases: document.querySelectorAll(".compare-pane canvas").length,
    unclass: document.querySelectorAll(".unclass-file").length,
    sync: document.querySelector("#c-sync-box")?.checked,
  }))()`);
  record("Compare pair", /题目/.test(info.q) && /作答/.test(info.a), JSON.stringify(info).slice(0, 260));
  record("Compare canvases", info.canvases >= 1, `canvases=${info.canvases}`);
}

/* 8. 对照：单侧配对（计算机系统概论/作业01 现在只有「作答」一侧 → 左侧显示空状态） */
await nav(`${BASE}/#/compare?dir=${encodeURIComponent("计算机系统概论/02-作业/作业01")}`, 3000);
{
  const info = await ev(`(() => ({
    eq: document.querySelector("#pane-q .pane-empty")?.innerText?.trim() || "",
    a: document.querySelector("#pane-a .pane-label")?.innerText || "",
    canvasA: document.querySelectorAll("#pane-a canvas").length,
    unclass: [...document.querySelectorAll(".unclass-file .uf-name")].map(e => e.innerText),
  }))()`);
  record("Missing sides", info.eq.includes("暂无") && /作答/.test(info.a), JSON.stringify(info).slice(0, 260));
  record("单侧配对仍渲染作答", info.canvasA >= 1, `canvasA=${info.canvasA}`);
}

/* 9. 完成勾�?*/
{
  await send("Page.bringToFront");
  await ev(`(() => { const b = document.querySelector("#c-done-box"); b?.click(); return !!b; })()`);
  await sleep(900);
  const st = await (await fetch(`${BASE}/api/state`)).json();
  record("Completed saved", st.completed?.["计算机系统概论/02-作业/作业01"] === true, JSON.stringify(st.completed || {}));
  await ev(`(() => { document.querySelector("#c-done-box")?.click(); return 1; })()`);
  await sleep(900);
}

/* 10. 同步滚动 */
await nav(`${BASE}/#/compare?dir=${encodeURIComponent("形式语言与自动机/02-作业/作业01")}`, 3500);
{
  await send("Page.bringToFront");
  await ev(`(() => {
    const s = document.querySelectorAll(".pane-holder .pdf-scroll");
    if (s[0]) s[0].scrollTop = 500;
    return s.length;
  })()`);
  await sleep(700);
  const after = await ev(`(() => {
    const s = document.querySelectorAll(".pane-holder .pdf-scroll");
    return [Math.round(s[0]?.scrollTop || 0), Math.round(s[1]?.scrollTop || 0)];
  })()`);
  record("Sync scroll", after[1] > 20, `after=${JSON.stringify(after)}`);
}

/* 11. 树：对照按钮（形式语言有规范命名）+ 疑似重复（计算机系统概论�?*/
await nav(`${BASE}/#/course/${encodeURIComponent("形式语言与自动机")}`);
{
  const info = await ev(`(() => ({
    cmp: document.querySelectorAll(".compare-btn").length,
  }))()`);
  record("Tree compare btns", info.cmp >= 2, `btns=${info.cmp}`);
}
await nav(`${BASE}/#/course/${encodeURIComponent("计算机系统概论")}`);
{
  const info = await ev(`(() => ({
    dup: [...document.querySelectorAll(".dup-badge")].length,
    dupRels: [...document.querySelectorAll(".file-row")].filter(r => r.querySelector(".dup-badge")).map(r => r.dataset.rel),
  }))()`);
  record("Dup badge", info.dup >= 2, JSON.stringify(info.dupRels));
}

/* 12. 书架统计 */
await nav(`${BASE}/#/`);
{
  const stats = await ev(`[...document.querySelectorAll(".card-assign")].map(e => e.innerText)`);
  record("Home assign stats", stats.length >= 2, JSON.stringify(stats));
}

console.log("\n==== SUMMARY ====");
const fails = results.filter(r => !r.pass);
console.log(`${results.length - fails.length}/${results.length} PASS`);
if (errors.length) { console.log("JS errors:", errors.slice(0, 5)); }
if (fails.length) fails.forEach(f => console.log(" -", f.name, f.detail));
process.exit(fails.length ? 1 : 0);
