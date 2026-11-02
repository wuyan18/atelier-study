/* cdp_p2.mjs — P2 全文搜索验收（CDP，连 9223 GUI Chrome）
   覆盖：搜索结果分组+snippet 高亮/点击跳页/同名区分/扫描件提示/无结果文案/
   顶栏搜索框直达/索引状态展示 */
const PORT = 9223, BASE = "http://127.0.0.1:8765";
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
await send("Page.bringToFront");
await send("Page.reload", { ignoreCache: true });
await sleep(3000);

/* 1. 搜索页直达：q=Cauchy */
await nav(`${BASE}/#/search?q=${encodeURIComponent("Cauchy")}`, 3500);
{
  const info = await ev(`(() => {
    const cards = [...document.querySelectorAll(".search-hit-card")];
    const marks = document.querySelectorAll(".hit-snippet mark").length;
    const summary = document.querySelector(".search-summary")?.innerText || "";
    const scannedNote = [...document.querySelectorAll(".search-scanned")].map(e => e.innerText).join(" | ");
    const groups = document.querySelectorAll(".search-course").length;
    return { cards: cards.length, marks, summary: summary.slice(0, 60), scannedNote, groups,
             inputVal: document.getElementById("search-input")?.value };
  })()`);
  record("Search results", info.cards >= 2, `cards=${info.cards} groups=${info.groups} marks=${info.marks}`);
  record("Snippet highlight", info.marks >= 2, `mark=${info.marks}`);
  record("Summary text", /命中/.test(info.summary), JSON.stringify(info.summary));
  record("Topbar input sync", info.inputVal === "Cauchy", `input=${info.inputVal}`);
  record("Scanned note", /复变/.test(info.scannedNote || ""), JSON.stringify((info.scannedNote || "").slice(0, 80)));

  /* 同名文件按完整路径区分：两份同名讲义不同路径都要出现，且各带完整 rel
     （课程整理后副本可能从 04-资料 挪到 99-归档，因此只断言「同课程、路径不同」） */
  const rels = await ev(`[...document.querySelectorAll(".search-hit-card")].map(c => c.dataset.rel)`);
  const sameCourse = rels.filter(r => r.startsWith("概统/"));
  const hasBoth = sameCourse.length >= 2 && new Set(sameCourse).size === sameCourse.length;
  record("Same-name distinct paths", hasBoth, JSON.stringify(rels));
}

/* 2. 点击命中行 → 跳转阅读器并定位到命中页（Cauchy 在 p46） */
{
  await ev(`document.querySelector(".search-hit-card .hit-line").click()`);
  await sleep(4200); // PDF 懒渲染
  const info = await ev(`(() => {
    const pi = document.querySelector(".reader-root .r-page");
    return {
      hash: location.hash,
      hasReader: !!document.querySelector(".reader-root"),
      pageInput: pi ? pi.value : null,
      canvases: document.querySelectorAll(".pdf-page canvas").length,
    };
  })()`);
  record("Click hit jumps", /page=46/.test(info.hash), `hash=${info.hash}`);
  record("Reader at page 46", info.hasReader && String(info.pageInput) === "46", `pageInput=${info.pageInput} canvases=${info.canvases}`);
}

/* 3. 无结果文案 */
await nav(`${BASE}/#/search?q=${encodeURIComponent("zzzqq无此词")}`, 3000);
{
  const info = await ev(`(() => {
    const empty = document.querySelector(".search-empty");
    const note = document.querySelector(".search-scanned")?.innerText || "";
    return { has: !!empty, text: empty ? empty.innerText.slice(0, 80) : "", note: note.slice(0, 60) };
  })()`);
  record("No-result message", info.has && /没有找到/.test(info.text), JSON.stringify(info.text));
  record("No-result scanned note", /复变/.test(info.note), JSON.stringify(info.note));
}

/* 4. 顶栏搜索框回车 → 直达搜索页 */
{
  await nav(`${BASE}/#/`, 2200);
  await ev(`(() => {
    const inp = document.getElementById("search-input");
    inp.value = "实验";
    document.getElementById("search-form").dispatchEvent(new Event("submit", { cancelable: true }));
  })()`);
  await sleep(3200);
  const info = await ev(`(() => ({
    hash: location.hash,
    cards: document.querySelectorAll(".search-hit-card").length,
    summary: document.querySelector(".search-summary")?.innerText?.slice(0, 40) || "",
  }))()`);
  record("Topbar search works", /q=/.test(info.hash) && info.cards >= 5, `hash=${info.hash} cards=${info.cards}`);
}

/* 5. 空关键词 → 索引状态页 */
await nav(`${BASE}/#/search`, 2500);
{
  const info = await ev(`document.querySelector(".search-empty")?.innerText?.slice(0, 120) || ""`);
  record("Index status page", /索引|PDF/.test(info), JSON.stringify(info));
}

/* 6. 重建索引按钮存在 */
{
  const has = await ev(`!!document.getElementById("rebuild-index")`);
  record("Rebuild button", has, `has=${has}`);
}

/* 页面 JS 异常 */
record("No JS exceptions", errors.length === 0, errors.join(" || ").slice(0, 200));

const failed = results.filter(r => !r.pass).length;
console.log(`\n=== ${results.length - failed}/${results.length} PASS ===`);
process.exit(failed ? 1 : 0);
