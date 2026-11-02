const CDP = "http://127.0.0.1:9223";
const run = async () => {
  const list = await (await fetch(CDP + "/json")).json();
  const page = list.find(t => t.type === "page" && t.url.includes("127.0.0.1:8765"));
  if (!page) return console.log("NO TARGET");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise(r => {
    const i = ++id; pending.set(i, { resolve: r });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result.value;

  // G.state.progress 全貌 + 服务器端 state
  const local = await ev(`JSON.stringify(G.state.progress || {})`);
  console.log("LOCAL progress:", local.slice(0, 400));
  const sv = await ev(`fetch('/api/state').then(r => r.json()).then(s => JSON.stringify(s.progress || {}))`);
  console.log("SERVER progress:", String(sv).slice(0, 400));
  ws.close();
};
run().catch(e => console.log("FAIL:", e.message));
