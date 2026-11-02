/* CDP 自动化：考试计划页（功能集成自 exam_planning）
   覆盖：页面渲染 / 倒计时 / 月历切换 / 当天弹窗 / 新增-编辑-删除 / 表单校验 /
        键盘快捷键 / 导入 / 导出 / 深色模式 / 数据落盘 / 控制台异常
   运行：node tests/cdp_exams.mjs   （需 8765 服务 + 9223 Chrome 已启动）
   说明：测试会先备份现有考试数据，结束时原样恢复。 */
import { readFileSync, rmSync } from "node:fs";

const PORT = process.env.CDP_PORT || 9223;
const BASE = "http://127.0.0.1:8765";
const API = (p) => `${BASE}${p}`;

let ws = null, msgId = 0;
const pending = new Map();
const errors = [];
let pass = 0, fail = 0;

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, { resolve });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalRaw(expression) {
  const r = await send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (r && r.exceptionDetails) {
    const d = r.exceptionDetails.exception && (r.exceptionDetails.exception.description || r.exceptionDetails.text);
    throw new Error("JS 异常：" + String(d).split("\n")[0]);
  }
  return r && r.result ? r.result.value : undefined;
}
/* 把函数体包成 async IIFE 求值，返回值即结果 */
const run = (body) => evalRaw(`(async () => { ${body} })()`);

async function waitFor(expr, timeout = 7000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    let v;
    try { v = await evalRaw(`!!(${expr})`); } catch (e) { v = false; }
    if (v) return true;
    await sleep(120);
  }
  throw new Error("等待超时：" + label);
}

function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${extra ? "  [" + extra + "]" : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${extra ? "  [" + extra + "]" : ""}`); }
}
function okEq(name, actual, expected) {
  ok(name, actual === expected, `实际 ${JSON.stringify(actual)} 期望 ${JSON.stringify(expected)}`);
}

async function getExams() {
  const r = await (await fetch(API("/api/exams"))).json();
  return r;
}

/* ---------- 启动 CDP ---------- */
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page");
if (!page) throw new Error("没有可用的页面目标");
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push("exception: " + (d.exception && (d.exception.description || d.exception.value) || d.text));
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" "));
  }
};
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.bringToFront");

/* ---------- 备份用户数据 ---------- */
const backup = await getExams();
const backupList = (backup.data || []).map((e) => ({
  id: e.id, subject: e.subject, examTime: e.examTime, credit: e.credit, focus: e.focus, duration: e.duration,
}));
console.log(`备份现有考试：${backupList.length} 场`);

async function saveExams(list) {
  const r = await fetch(API("/api/exams"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exams: list }),
  });
  return r.json();
}

async function reloadPage(url = `${BASE}/#/exams`) {
  await send("Page.navigate", { url: "about:blank" });
  await sleep(120);
  await send("Page.navigate", { url });
  await sleep(700);
  await send("Page.reload", { ignoreCache: true });
  await sleep(1500);
}

/* ---------- 准备示例数据 ---------- */
await fetch(API("/api/exams/sample"), { method: "POST" });
await reloadPage();
await waitFor(`document.querySelector(".ex-hero-title")`, 8000, "考试页渲染");
/* 恢复浅色主题，保证基线一致 */
await run(`const b = document.querySelector('[data-theme-set="light"]'); if (b) b.click(); return 1;`);
await sleep(300);

/* ---------- 1. 页面结构 ---------- */
okEq("hero 科目", await run(`return document.querySelector(".ex-hero-title").textContent.trim();`), "高等数学");
okEq("倒计时 4 格", await run(`return document.querySelectorAll(".ex-cd .cd-cell").length`), 4);
ok("紧迫度徽标", await run(`return !!document.querySelector(".ex-urgency.tier-orange, .ex-urgency.tier-red, .ex-urgency.tier-blue, .ex-urgency.tier-safe");`));
okEq("进度卡统计 3 格", await run(`return document.querySelectorAll(".ex-prog .ex-stat").length`), 3);
okEq("学分统计 3 格", await run(`return document.querySelectorAll(".ex-credits div").length`), 3);
ok("日历有考试日", await run(`return document.querySelectorAll(".cal-cell.has-exam").length`) >= 3);
okEq("全部考试行数", await run(`return document.querySelectorAll(".ex-row").length`), 3);
okEq("页头副标题", (await run(`return document.getElementById("ex-sub").textContent;`)).includes("3 场考试"), true);
const badge = await run(`const b=document.getElementById("nav-exam-days"); return b.hidden ? "hidden" : b.textContent;`);
ok("侧栏倒计时徽标", /^(\d+|今天|考)$/.test(String(badge)), String(badge));
ok("侧栏导航高亮", await run(`return document.querySelector('[data-nav="exams"]').classList.contains("active");`));

/* ---------- 2. 倒计时跳动 ---------- */
const s1 = await run(`return document.querySelector('[data-cd="s"]').textContent;`);
await sleep(1400);
const s2 = await run(`return document.querySelector('[data-cd="s"]').textContent;`);
ok("秒数每秒刷新", s1 !== s2, `${s1} → ${s2}`);

/* ---------- 3. 月历切换 ---------- */
await run(`document.getElementById("cal-next").click(); return 1;`);
await sleep(200);
ok("下一月", (await run(`return document.getElementById("cal-month").textContent;`)).includes("12 月"));
await run(`document.getElementById("cal-prev").click(); return 1;`);
await run(`document.getElementById("cal-prev").click(); return 1;`);
await sleep(200);
ok("上一月", (await run(`return document.getElementById("cal-month").textContent;`)).includes("10 月"));
await run(`document.getElementById("cal-today").click(); return 1;`);
await sleep(200);
ok("回到今天", (await run(`return document.getElementById("cal-month").textContent;`)).includes("11 月"));

/* ---------- 4. 当天弹窗 + Esc ---------- */
await run(`document.querySelector(".cal-cell.has-exam").click(); return 1;`);
await sleep(350);
ok("当天弹窗打开", await run(`return !!document.querySelector(".modal-back .day-item");`));
ok("弹窗标题含场次", /场考试/.test(await run(`return document.getElementById("modal-title").textContent;`)));
await run(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); return 1;`);
await sleep(250);
okEq("Esc 关闭弹窗", await run(`return document.querySelectorAll(".modal-back").length`), 0);

/* ---------- 5. 新增考试 + 校验 ---------- */
await run(`document.getElementById("ex-add").click(); return 1;`);
await sleep(320);
ok("新增表单打开", await run(`return !!document.getElementById("ex-form");`));
/* 空科目 → 内联错误，弹窗不关 */
await run(`document.getElementById("f-save").click(); return 1;`);
await sleep(250);
ok("空科目报错", await run(`const e=document.getElementById("f-error"); return !!e && !e.hidden && e.textContent.length>0;`));
okEq("报错时弹窗仍在", await run(`return document.querySelectorAll(".modal-back").length`), 1);
/* 正常填写保存 */
await run(`
  document.getElementById("f-subject").value = "线性代数";
  document.getElementById("f-time").value = "2026-11-20T08:30";
  document.getElementById("f-credit").value = "2.5";
  document.getElementById("f-duration").value = "90";
  document.getElementById("f-focus").value = "矩阵与行列式";
  document.getElementById("f-save").click();
  return 1;`);
await waitFor(`document.querySelectorAll(".ex-row").length === 4`, 6000, "新增后行数 4");
const afterAdd = await getExams();
okEq("新增落盘数量", afterAdd.count, 4);
const fresh = afterAdd.data.find((e) => e.subject === "线性代数");
ok("新增字段正确", !!fresh && fresh.credit === 2.5 && fresh.duration === 90 &&
  fresh.examTime === "2026-11-20T08:30:00" && fresh.focus === "矩阵与行列式",
  JSON.stringify(fresh));
okEq("保存后弹窗关闭", await run(`return document.querySelectorAll(".modal-back").length`), 0);

/* ---------- 6. 编辑 ---------- */
await run(`const rows=[...document.querySelectorAll(".ex-row")]; const r=rows.find(x=>x.textContent.includes("线性代数")); r.querySelector('[data-act="edit"]').click(); return 1;`);
await sleep(320);
okEq("编辑表单预填", await run(`return document.getElementById("f-subject").value`), "线性代数");
await run(`document.getElementById("f-subject").value="线性代数（补考）"; document.getElementById("f-save").click(); return 1;`);
await waitFor(`document.body.textContent.includes("线性代数（补考）")`, 6000, "编辑后名称更新");
const afterEdit = await getExams();
ok("编辑已落盘", (afterEdit.data || []).some((e) => e.subject === "线性代数（补考）") && afterEdit.count === 4);

/* ---------- 7. 删除 ---------- */
await run(`const rows=[...document.querySelectorAll(".ex-row")]; const r=rows.find(x=>x.textContent.includes("补考")); r.querySelector('[data-act="del"]').click(); return 1;`);
await sleep(320);
ok("删除确认弹窗", await run(`return !!document.getElementById("cf-ok");`));
await run(`document.getElementById("cf-ok").click(); return 1;`);
await waitFor(`document.querySelectorAll(".ex-row").length === 3`, 6000, "删除后行数 3");
const afterDel = await getExams();
okEq("删除已落盘", afterDel.count, 3);

/* ---------- 8. 键盘快捷键 ---------- */
await run(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"n",bubbles:true})); return 1;`);
await sleep(320);
ok("N 键新增", await run(`return !!document.getElementById("ex-form");`));
await run(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); return 1;`);
await sleep(220);
okEq("Esc 关闭表单", await run(`return document.querySelectorAll(".modal-back").length`), 0);

/* ---------- 9. 导入 ---------- */
const importText = JSON.stringify([
  { subject: "概率论", examTime: "2026-12-02T09:00:00", credit: 3, focus: "随机变量", duration: 120 },
  { subject: "大学物理", examTime: "2026-12-08T14:30:00", credit: 4, focus: "电磁学", duration: 110 },
]);
await run(`
  const f = new File([${JSON.stringify(importText)}], "exams.json", { type: "application/json" });
  const dt = new DataTransfer(); dt.items.add(f);
  const input = document.getElementById("ex-file");
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return 1;`);
await sleep(500);
ok("导入确认弹窗", await run(`return !!document.getElementById("cf-ok");`));
await run(`document.getElementById("cf-ok").click(); return 1;`);
await waitFor(`document.querySelectorAll(".ex-row").length === 2`, 7000, "导入后行数 2");
const afterImport = await getExams();
okEq("导入落盘", afterImport.count, 2);
ok("导入内容正确", afterImport.data.map((e) => e.subject).sort().join(",") === "大学物理,概率论");

/* ---------- 10. 导出 ---------- */
await run(`document.getElementById("ex-export").click(); return 1;`);
await waitFor(`document.querySelector(".path-box")`, 6000, "导出结果弹窗");
const exportPath = await run(`return document.querySelector(".path-box").textContent.trim();`);
ok("导出文件路径", /\.json$/i.test(exportPath), exportPath);
try {
  const txt = readFileSync(exportPath, "utf8");
  ok("导出文件可读且含 2 场", JSON.parse(txt).length === 2);
  rmSync(exportPath, { force: true });
} catch (e) {
  ok("导出文件可读且含 2 场", false, e.message);
}
await run(`document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); return 1;`);

/* ---------- 11. 深色模式 ---------- */
await run(`document.querySelector('[data-theme-set="dark"]').click(); return 1;`);
await sleep(350);
okEq("深色模式生效", await run(`return document.documentElement.dataset.theme`), "dark");
okEq("深色下卡片仍渲染", await run(`return document.querySelectorAll(".ex-card").length >= 4`), true);
await run(`document.querySelector('[data-theme-set="light"]').click(); return 1;`);
await sleep(250);

/* ---------- 12. 窄窗口 ---------- */
await send("Emulation.setDeviceMetricsOverride", { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(500);
ok("窄窗口单列布局", await run(`return getComputedStyle(document.querySelector(".ex-grid")).gridTemplateColumns.split(" ").length === 1;`));
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(300);

/* ---------- 13. 控制台无异常 ---------- */
await sleep(300);
okEq("无 JS 异常 / console.error", errors.length, 0);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));

/* ---------- 恢复用户数据 ---------- */
await saveExams(backupList);
const restored = await getExams();
okEq("已恢复原始考试数据", restored.count, backupList.length);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
