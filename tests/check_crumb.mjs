/* 验证阅读器面包屑 + 通用路由检查（CDP 9333） */
const PORT = process.env.CDP_PORT || 9333;
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
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
ws = new WebSocket(list.find(t => t.type === "page").webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); } };
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

async function nav(url, wait = 3500) {
  await send("Page.bringToFront");
  await send("Page.navigate", { url });
  await sleep(wait);
}
const ok = (n, c, d = "") => console.log(`${c ? "PASS" : "FAIL"} ${n} ${d}`);

await nav(`${BASE}/#/read?path=${encodeURIComponent("数据结构/03-实验/实验01/报告/report.md")}`, 3000);
const crumb = await ev(`document.getElementById("crumb").innerText.replace(/\\s+/g," ")`);
ok("crumb has course", /数据结构/.test(crumb), JSON.stringify(crumb));
ok("crumb ends with file", /report\.md/.test(crumb), "");
const title = await ev(`document.title`);
ok("doc title", /report\.md/.test(title), JSON.stringify(title));

await nav(`${BASE}/#/course/${encodeURIComponent("概率论与数理统计")}`, 1500);
const crumb2 = await ev(`document.getElementById("crumb").innerText.replace(/\\s+/g," ")`);
ok("course crumb", /概率论与数理统计/.test(crumb2), JSON.stringify(crumb2));

const shot = await send("Page.captureScreenshot", { format: "png" });
const { writeFileSync } = await import("node:fs");
const path = await import("node:path");
const PROJ = path.resolve(import.meta.dirname, "..");
writeFileSync(path.join(PROJ, "tests", "shot_md2.png"), Buffer.from(shot.data, "base64"));

await nav(`${BASE}/#/read?path=${encodeURIComponent("数据结构/03-实验/实验01/报告/report.md")}`, 3000);
const shot2 = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(path.join(PROJ, "tests", "shot_md.png"), Buffer.from(shot2.data, "base64"));
process.exit(0);
