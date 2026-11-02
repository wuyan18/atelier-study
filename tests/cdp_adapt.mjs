/* cdp_adapt.mjs — "未来资料"适配性验收：新格式 / 新扩展名 / 刷新按钮 / 缓存
 * 前置：python server.py --no-browser --port 8766 --data-root tests\fixture_adapt --state-dir tests\fixture_state
 *       CDP Chrome 运行在 CDP_PORT（默认 9333）
 */
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.BASE_URL || "http://127.0.0.1:8766";
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
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push("CONSOLE: " + (m.params.args || []).map(a => a.value || a.description || "").join(" ").slice(0, 200));
    }
  };
  await send("Runtime.enable");
  await send("Page.enable");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __exc: r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || "") };
  return r.result.value;
}
async function nav(url, wait = 1800) {
  await send("Page.bringToFront");
  await send("Page.navigate", { url });
  await sleep(wait);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${detail}`);
}
const q = (rel) => `${BASE}/#/read?path=${encodeURIComponent(rel)}`;

await connect();
await send("Page.bringToFront");
// 先离开当前页面再进目标页：hash 相同不会重载文档，模块也可能沿用旧的
await send("Page.navigate", { url: "about:blank" });
await sleep(400);
await send("Page.navigate", { url: `${BASE}/#/` });
await sleep(2600);
errors.length = 0;   // 忽略上一个页面（可能是别的服务/别的文档）遗留的报错

/* 1. 书架：新课程自动出现 */
await nav(`${BASE}/#/`);
{
  const info = await ev(`(() => {
    const cards = [...document.querySelectorAll(".course-card")];
    return {
      cards: cards.length,
      names: cards.map(c => c.querySelector(".card-title")?.textContent),
      sub: document.querySelector(".hero-sub")?.textContent || "",
      refresh: !!document.getElementById("btn-refresh"),
    };
  })()`);
  record("新课程自动上架", info.cards === 1 && /适配性测试/.test(info.names?.[0] || ""), JSON.stringify(info));
  record("顶栏有「重新扫描」按钮", info.refresh === true, `refresh=${info.refresh}`);
}

/* 2. 重新扫描按钮：点击后 toast 反馈、数据仍在 */
{
  const before = await ev(`document.querySelectorAll(".course-card").length`);
  await ev(`document.getElementById("btn-refresh").click()`);
  await sleep(1500);
  const after = await ev(`(() => ({
    cards: document.querySelectorAll(".course-card").length,
    toast: document.getElementById("toast")?.textContent || "",
    shown: !document.getElementById("toast")?.classList.contains("hidden"),
  }))()`);
  record("点「重新扫描」有 toast 反馈", /已重新扫描/.test(after.toast) && after.shown, JSON.stringify(after));
  record("重新扫描后书架仍完整", after.cards === before && before === 1, `before=${before} after=${after.cards}`);
}

/* 3. 课程页统计 */
await nav(`${BASE}/#/course/${encodeURIComponent("适配性测试")}`);
{
  const info = await ev(`(() => ({
    title: document.querySelector(".page-title")?.textContent,
    chips: [...document.querySelectorAll(".page-head-chips .hchip")].map(e => e.textContent.trim()),
    rows: document.querySelectorAll(".file-row").length,
  }))()`);
  record("课程页头部统计", info.title === "适配性测试" && info.chips.length >= 2, JSON.stringify(info));
}

/* 4. 新代码语言：go / sh / rs / java / py / makefile / dockerfile / yaml / ipynb / sql */
const codeCases = [
  ["适配性测试/03-代码/hello.go", "go"],
  ["适配性测试/03-代码/run.sh", "bash"],
  ["适配性测试/03-代码/main.rs", "rust"],
  ["适配性测试/03-代码/Main.java", "java"],
  ["适配性测试/03-代码/infer.py", "python"],
  ["适配性测试/03-代码/Makefile", "makefile"],
  ["适配性测试/03-代码/Dockerfile", "docker"],
  ["适配性测试/03-代码/config.yaml", "yaml"],
  ["适配性测试/03-代码/nb.ipynb", "json"],
  ["适配性测试/03-代码/查询.sql", "sql"],
];
for (const [rel, lang] of codeCases) {
  await nav(q(rel));
  const info = await ev(`(() => {
    const pre = document.querySelector(".code-view");
    const code = pre?.querySelector("code");
    return {
      view: !!pre,
      cls: code?.className || "",
      loaded: !!window.Prism?.languages?.[${JSON.stringify(lang)}],
      tokens: code ? code.querySelectorAll("span.token").length : 0,
    };
  })()`);
  record(`代码预览 .${rel.split(".").pop()} → ${lang}`,
    info.view && /language-/.test(info.cls) && info.loaded, JSON.stringify(info));
}

/* 5. 不支持的格式：给出明确说明，而不是白屏 */
for (const [rel, expect] of [
  ["适配性测试/04-杂项/pack.rar", "只支持 .zip"],
  ["适配性测试/04-杂项/scan.tif", ".tif"],
]) {
  await nav(q(rel));
  const info = await ev(`(() => {
    const box = document.querySelector(".unknown-view");
    return { view: !!box, text: box?.textContent?.replace(/\\s+/g, " ").slice(0, 120) || "" };
  })()`);
  record(`不支持格式有说明 ${rel.split("/").pop()}`, info.view && info.text.includes(expect), info.text);
}

/* 6. 图片 / ZIP / Markdown 表格 */
await nav(q("适配性测试/04-杂项/图.png"));
{
  const info = await ev(`(() => {
    const img = document.querySelector(".img-stage img");
    return { ok: !!img, w: img?.naturalWidth || 0, gallery: document.querySelectorAll(".img-thumb").length };
  })()`);
  record("图片预览（1x1 png）", info.ok && info.w === 1, JSON.stringify(info));
}
await nav(q("适配性测试/04-杂项/bundle.zip"));
{
  const info = await ev(`(() => ({
    zip: !!document.querySelector(".zip-view"),
    text: document.querySelector("#main")?.textContent?.replace(/\\s+/g, " ").slice(0, 80) || "",
  }))()`);
  record("ZIP 视图容器（坏包不崩）", info.zip === true, info.text);
}
await nav(q("适配性测试/01-课件/讲义.md"));
{
  const info = await ev(`(() => ({
    md: !!document.querySelector(".md-view"),
    tables: document.querySelectorAll(".md-view table").length,
    h1: document.querySelectorAll(".md-view h1").length,
  }))()`);
  record("Markdown 渲染（含表格）", info.md && info.tables === 1 && info.h1 === 1, JSON.stringify(info));
}

/* 7. 作业对照（md 也能配对） */
await nav(`${BASE}/#/compare?dir=${encodeURIComponent("适配性测试/02-作业/作业01")}`);
{
  const info = await ev(`(() => ({
    labels: [...document.querySelectorAll(".pane-label")].map(e => e.textContent.trim()),
    empty: document.querySelectorAll(".pane-empty").length,
    md: document.querySelectorAll(".md-view").length,
  }))()`);
  record("md 题目/作答可对照", info.labels.length === 2 && info.empty === 0, JSON.stringify(info));
}

/* 8. UI 无异常 */
record("无 JS 异常/console.error", errors.length === 0, errors.slice(0, 3).join(" | ") || "clean");

const pass = results.filter(r => r.pass).length;
console.log(`\n== ${pass}/${results.length} PASS ==`);
if (pass !== results.length) {
  console.log("失败项：");
  results.filter(r => !r.pass).forEach(r => console.log("  -", r.name, r.detail));
}
process.exit(pass === results.length ? 0 : 1);
