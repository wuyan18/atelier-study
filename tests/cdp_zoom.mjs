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

  // 后台标签页不触发 IntersectionObserver（PROJECT_STATUS 教训）——先置前
  await send("Page.bringToFront");

  // 回到阅读器页
  await ev(`location.hash = '#/read?path=' + ${JSON.stringify(encodeURIComponent('数据结构/03-实验/实验01/报告/report.pdf'))} + '&page=1'`);
  await new Promise(r => setTimeout(r, 6000));
  let st = await ev(`JSON.stringify({zoom: document.getElementById('r-zoom-label').textContent, canvases: document.querySelectorAll('#pdf-pages canvas').length, ph: document.querySelectorAll('.pdf-page.placeholder').length, loadingTexts: [...document.querySelectorAll('.page-loading')].map(e => e.textContent).slice(0, 3)})`);
  console.log("FRESH LOAD:", st);

  // zoom in 后等足够时间
  await ev(`document.getElementById('r-zoom-in').click()`);
  await new Promise(r => setTimeout(r, 5000));
  st = await ev(`JSON.stringify({zoom: document.getElementById('r-zoom-label').textContent, canvases: document.querySelectorAll('#pdf-pages canvas').length, ph: document.querySelectorAll('.pdf-page.placeholder').length, loadingTexts: [...document.querySelectorAll('.page-loading')].map(e => e.textContent).slice(0, 3)})`);
  console.log("AFTER ZOOM-IN+5s:", st);

  // 滚动一下触发 IO 重渲染
  await ev(`document.getElementById('pdf-scroll').scrollTop += 50`);
  await new Promise(r => setTimeout(r, 3000));
  st = await ev(`JSON.stringify({canvases: document.querySelectorAll('#pdf-pages canvas').length})`);
  console.log("AFTER SCROLL:", st);
  ws.close();
};
run();
