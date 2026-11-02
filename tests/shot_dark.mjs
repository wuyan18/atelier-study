// 深色模式截图：Emulation.setEmulatedMedia prefers-color-scheme: dark
import fs from "node:fs";

const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = "http://127.0.0.1:8765";

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("no page target");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
function send(method, params = {}) {
  const mid = ++id;
  return new Promise((res, rej) => {
    pending.set(mid, (m) => (m.error ? rej(new Error(method + ": " + m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });

const shots = [
  ["home", `${BASE}/#/`, 2500],
  ["course", `${BASE}/#/course/${encodeURIComponent("数据结构")}`, 2500],
  ["md", `${BASE}/#/read?path=${encodeURIComponent("数据结构/03-实验/实验01/报告/report.md")}`, 3000],
];
for (const [name, url, wait] of shots) {
  await send("Page.navigate", { url });
  await sleep(wait);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(`tests/shot_dark_${name}.png`, Buffer.from(data, "base64"));
  console.log("saved shot_dark_" + name + ".png");
}

await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
ws.close();
