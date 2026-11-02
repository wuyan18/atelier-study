/* cdp_p1_final.mjs — P1 补充验收：画廊/部分配对/.fig 未知格式/重启持久化 */
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

const targets = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = targets.find(t => t.type === "page");
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); }
};
await send("Runtime.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
await sleep(2500);

const BASE = "http://127.0.0.1:8765";

/* A. 图片画廊（概统/作业02/作图：4 png + 1 fig） */
await nav(`${BASE}/#/read?path=${encodeURIComponent("概统/02-作业/作业02/作图/Figure_1.png")}`, 1500);
{
  const info = await ev(`(() => {
    const img = document.querySelector(".img-stage img");
    const gal = document.querySelectorAll(".img-thumb");
    return { loaded: !!img && img.naturalWidth > 0, gallery: gal.length,
      cur: [...gal].findIndex(g => g.classList.contains("active")) };
  })()`);
  record("Gallery 4 thumbnails", info.loaded && info.gallery === 4, JSON.stringify(info));
  // 点击第 3 张缩略图换主图
  await send("Page.bringToFront");
  const swapped = await ev(`(() => {
    const gal = document.querySelectorAll(".img-thumb");
    if (gal.length >= 3) { gal[2].click(); return true; }
    return false;
  })()`);
  await sleep(800);
  const after = await ev(`(() => {
    const img = document.querySelector(".img-stage img");
    const name = decodeURIComponent(img?.src || "").split("path=")[1] || "";
    return { name, cur: [...document.querySelectorAll(".img-thumb")].findIndex(g => g.classList.contains("active")) };
  })()`);
  record("Gallery click switch", swapped && after.name.includes("Figure_3") && after.cur === 2, JSON.stringify(after));
}

/* B. 部分配对（概统/作业05：题目有 + 作业5.pdf 未分类 → 右侧暂无作答） */
await nav(`${BASE}/#/compare?dir=${encodeURIComponent("概统/02-作业/作业05")}`, 3000);
{
  const info = await ev(`(() => ({
    q: document.querySelector("#pane-q .pane-label")?.innerText || "",
    ea: document.querySelector("#pane-a .pane-empty")?.innerText?.trim() || "",
    canvasQ: document.querySelectorAll("#pane-q canvas").length,
    unclass: [...document.querySelectorAll(".unclass-file .uf-name")].map(e => e.innerText),
  }))()`);
  record("Partial pair (题目 only)", /题目/.test(info.q) && info.ea.includes("暂无作答") && info.canvasQ >= 1, JSON.stringify(info).slice(0, 250));
  record("作业5.pdf unclassified", info.unclass.some(n => n.includes("作业5.pdf")), JSON.stringify(info.unclass));
}

/* C. .fig 未知格式说明 */
await nav(`${BASE}/#/read?path=${encodeURIComponent("概统/02-作业/作业02/作图/untitled.fig")}`, 1200);
{
  const txt = await ev(`document.querySelector(".unknown-view")?.innerText?.slice(0, 120) || ""`);
  record("FIG unknown hint", txt.includes("MATLAB") && txt.includes("untitled.fig"), JSON.stringify(txt.slice(0, 80)));
}

/* D. 持久化准备：勾选完成（幂等：确保最终为 checked）+ 读 PDF 翻页记进度 */
await nav(`${BASE}/#/compare?dir=${encodeURIComponent("形式语言与自动机/02-作业/作业01")}`, 3500);
{
  await send("Page.bringToFront");
  await ev(`(() => {
    const b = document.querySelector("#c-done-box");
    if (b && !b.checked) b.click(); // 确保勾上（重复运行幂等）
    return b?.checked;
  })()`);
  await sleep(900);
  const st = await (await fetch(`${BASE}/api/state`)).json();
  record("Completed persisted pre-restart", st.completed?.["形式语言与自动机/02-作业/作业01"] === true, JSON.stringify(st.completed));
}
// 读 report.pdf 翻到第 2 页
await nav(`${BASE}/#/read?path=${encodeURIComponent("数据结构/03-实验/实验01/报告/report.pdf")}`, 3500);
{
  await send("Page.bringToFront");
  await ev(`(() => { document.querySelector(".r-next")?.click(); return 1; })()`);
  await sleep(3500);
  const st = await (await fetch(`${BASE}/api/state`)).json();
  record("Pre-restart state", st.completed?.["形式语言与自动机/02-作业/作业01"] === true
    && st.progress?.["数据结构/03-实验/实验01/报告/report.pdf"]?.page === 2,
    JSON.stringify({ done: st.completed, prog: st.progress?.["数据结构/03-实验/实验01/报告/report.pdf"] }));
}

console.log("\n==== PART1 SUMMARY ====");
const fails = results.filter(r => !r.pass);
console.log(`${results.length - fails.length}/${results.length} PASS`);
if (fails.length) fails.forEach(f => console.log(" -", f.name, f.detail));
process.exit(fails.length ? 1 : 0);
