/* check_refresh.mjs — 真实资料服务（8765）上验证「重新扫描」按钮与 toast */
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";
let ws = null, msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve) => { const id = ++msgId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find(t => t.type === "page");
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await send("Page.enable"); await send("Runtime.enable");

await send("Page.bringToFront");
await send("Page.navigate", { url: "about:blank" });
await sleep(300);
await send("Page.navigate", { url: `${BASE}/#/` });
await sleep(2600);

const before = await ev(`({ cards: document.querySelectorAll(".course-card").length, scan: performance.getEntriesByType("resource").filter(r=>r.name.includes("/api/tree")).length })`);
await ev(`document.getElementById("btn-refresh").click()`);
await sleep(1800);
const after = await ev(`(() => ({
  cards: document.querySelectorAll(".course-card").length,
  toast: document.getElementById("toast")?.textContent || "",
  shown: !document.getElementById("toast")?.classList.contains("hidden"),
  busy: document.getElementById("btn-refresh")?.classList.contains("busy"),
}))()`);

const ok = before.cards === after.cards && before.cards > 0 && /已重新扫描/.test(after.toast) && after.shown && after.busy === false;
console.log(`${ok ? "PASS" : "FAIL"} 重新扫描 — 卡片 ${before.cards}→${after.cards} toast="${after.toast}" busy=${after.busy}`);
process.exit(ok ? 0 : 1);
