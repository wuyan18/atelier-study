/* cdp_shell.mjs — 主题切换/侧栏折叠/收藏 的真实点击 + 持久化验证 (CDP 9333) */
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = "http://127.0.0.1:8765";
let ws = null, msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve) => { const id = ++msgId; pending.set(id, { resolve }); ws.send(JSON.stringify({ id, method, params })); });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __exc: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result.value;
}
const ok = (n, c, d = "") => console.log(`${c ? "PASS" : "FAIL"} ${n} ${d}`);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
ws = new WebSocket(list.find(t => t.type === "page").webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); } };
await send("Runtime.enable"); await send("Page.enable"); await send("Page.bringToFront");
await send("Page.navigate", { url: "about:blank" }); await sleep(250);
await send("Page.navigate", { url: `${BASE}/#/` }); await sleep(2800);

/* 1. 主题切换 → html[data-theme] + settings.theme 持久化 */
await ev(`document.querySelector('#theme-seg button[data-theme-set="dark"]').click()`);
await sleep(700);
let st = await ev(`(async () => ({ theme: document.documentElement.dataset.theme, seg: document.querySelector('#theme-seg .active')?.dataset.themeSet, saved: (await (await fetch('/api/state')).json()).settings?.theme }))()`);
ok("主题切深色", st.theme === "dark" && st.seg === "dark" && st.saved === "dark", JSON.stringify(st));
await ev(`document.querySelector('#theme-seg button[data-theme-set="auto"]').click()`);
await sleep(500);

/* 2. 侧栏折叠 → body.side-collapsed + settings.sideCollapsed */
await ev(`document.getElementById('side-toggle').click()`);
await sleep(700);
st = await ev(`(async () => ({ collapsed: document.body.classList.contains('side-collapsed'), saved: (await (await fetch('/api/state')).json()).settings?.sideCollapsed }))()`);
ok("侧栏折叠持久化", st.collapsed === true && st.saved === true, JSON.stringify(st));
await ev(`document.getElementById('side-toggle').click()`);
await sleep(500);

/* 3. 收藏：进入课程页点星 → settings.favorites → #/starred 页 */
await ev(`location.hash = '#/course/' + encodeURIComponent("数据结构")`);
await sleep(2500);
await ev(`document.querySelector('.file-row .fav-btn').click()`);
await sleep(800);
st = await ev(`({ fav: window.G && Object.keys(G.state.settings.favorites || {}), badgeHidden: document.getElementById('nav-fav-count')?.classList.contains('hidden') })`);
ok("收藏写入 state", Array.isArray(st.fav) && st.fav.length === 1 && st.badgeHidden === false, JSON.stringify(st));
await ev(`location.hash = '#/starred'`);
await sleep(2000);
st = await ev(`({ rows: document.querySelectorAll('.fav-list .file-row').length, title: document.title })`);
ok("收藏页显示", st.rows === 1 && /收藏/.test(st.title), JSON.stringify(st));

/* 4. 清理：取消收藏（恢复原状） */
await ev(`location.hash = '#/starred'`);
await sleep(1500);
await ev(`document.querySelector('.fav-list .file-row .fav-btn')?.click()`);
await sleep(800);
st = await ev(`({ favCount: window.G ? Object.keys(G.state.settings.favorites || {}).length : -1 })`);
ok("取消收藏", st.favCount === 0, JSON.stringify(st));
process.exit(0);
