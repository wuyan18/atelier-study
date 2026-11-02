/* cdp_progress.mjs — B1 复测：从服务器端验证进度持久化 */
const CDP = "http://127.0.0.1:9223";
const RP = "数据结构/03-实验/实验01/报告/report.pdf";
const list = await (await fetch(`${CDP}/json`)).json();
const page = list.find(t => t.type === "page" && t.url.includes("127.0.0.1:8765"));
if (!page) { console.log("NO TARGET"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise(r => {
  const i = ++id; pending.set(i, { resolve: r });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async (e, aw) => (await send("Runtime.evaluate", { expression: e, awaitPromise: !!aw, returnByValue: true })).result.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));

await send("Page.enable");
await send("Page.bringToFront");
await ev(`location.hash = '#/read?path=' + ${JSON.stringify(encodeURIComponent(RP))}`);
await sleep(5000);
// 清掉搜索残留，回到页 1 逻辑：直接点 next（load 已恢复 progress，可能停在 2）
const pageBefore = await ev(`document.getElementById('r-page').value`);
await ev(`document.getElementById('r-next').click()`);
await sleep(2500); // 滚动 250ms 防抖 + setProgress 600ms 防抖 + POST
const prog = await ev(`fetch('/api/state').then(r => r.json()).then(s => (s.progress || ${JSON.stringify(RP)}_x && JSON.stringify(s.progress || {})))`, true);
console.log("pageBefore:", pageBefore, "SERVER progress:", prog);
const sv = await ev(`fetch('/api/state').then(r => r.json()).then(s => JSON.stringify(s.progress))`, true);
const o = JSON.parse(sv);
const rec = o[RP];
console.log("RESULT:", rec ? `page=${rec.page} total=${rec.total}` : "NO RECORD");
console.log(rec && rec.total === 18 && rec.page === (parseInt(pageBefore) + 1) ? "PASS B1 进度持久化" : "FAIL B1");
ws.close();
