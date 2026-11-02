/* assignment.js — Atelier Study：题目/作答对照页（专业双栏阅读工作区） */
import { G, toast, isCompleted, setCompleted, esc } from "./app.js";
import { PdfViewer } from "./reader.js";
import { createViewerFor } from "./viewers.js";

function svgIco(sym, cls = "") {
  return `<svg class="ico ${cls}" aria-hidden="true"><use href="#${sym}"/></svg>`;
}

/* 识别目录里的题目/作答文件（就近递归 1 层） */
export function analyzeDir(node) {
  const files = [];
  const walk = (n, depth) => {
    for (const c of n.children || []) {
      if (c.type === "file") files.push(c);
      else if (depth === 0) walk(c, depth + 1);
    }
  };
  walk(node, 0);

  const question = [], answer = [], unclassified = [];
  let q = null, a = null;
  for (const f of files) {
    const n = f.name.toLowerCase();
    if (/题目|question/.test(n)) question.push(f);
    else if (/作答|答案|answer|solution/.test(n)) answer.push(f);
    else unclassified.push(f);
  }
  // inferred: 文件名形如 assignment01.pdf 之类
  const inferRank = f => (/\.pdf$/i.test(f.name) ? 0 : /\.docx$/i.test(f.name) ? 1 : 2);
  const pick = arr => arr.length ? arr.slice().sort((x, y) => inferRank(x) - inferRank(y))[0] : null;
  q = pick(question); a = pick(answer);
  // 若没有明确的题目/答案标记，尝试从 assignment 命名推断
  if (!q) {
    const cand = unclassified.filter(f => /^assignment[\w.-]*$/i.test(f.name.replace(/\.[^.]+$/, "")) && /\.(pdf|docx|md)$/i.test(f.name));
    if (cand.length) {
      cand.sort((x, y) => inferRank(x) - inferRank(y));
      q = cand[0];
      cand.slice(1).forEach(f => unclassified.splice(unclassified.indexOf(f), 1));
    }
  }
  return { question: q, answer: a, unclassified, inferred: !question.length && !!q, assignable: !!(q || a) };
}

/* 课程作业统计（作业/实验/小测 目录） */
export function courseAssignStats(courseNode) {
  let assignDirs = 0, done = 0;
  const walk = n => {
    for (const c of n.children || []) {
      if (c.type !== "dir") continue;
      if (/^(作业|实验|小测)/.test(c.name)) {
        const hasContent = (c.children || []).some(x => x.type === "file" || (x.children || []).length);
        if (hasContent) { assignDirs++; if (isCompleted(c.rel)) done++; }
      } else walk(c);
    }
  };
  walk(courseNode);
  return { assignDirs, done };
}

/* 同步滚动钩子（reader.js 的 pane 调用） */
export function onPaneScroll(srcViewer) {
  if (!syncState.enabled || srcViewer._syncing) return;
  const other = syncState.panes.find(p => p.viewer !== srcViewer && p.viewer);
  if (!other || !other.viewer._els || !other.viewer._els.scroll) return;
  const src = srcViewer._els.scroll, dst = other.viewer._els.scroll;
  const p = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
  syncState.lock = true;
  dst.scrollTop = p * (dst.scrollHeight - dst.clientHeight);
  requestAnimationFrame(() => { syncState.lock = false; });
}

const syncState = { enabled: true, panes: [], lock: false };

export async function renderCompare(main, node, dirRel) {
  const info = analyzeDir(node);
  main.className = "compare";
  main.innerHTML = `
    <div class="compare-root">
      <header class="compare-header">
        <button class="btn ghost c-back" id="c-back">${svgIco("i-arrow-left")}<span>返回</span></button>
        <span class="c-title">${esc(node.name)}<span class="ct-tag">对照阅读</span></span>
        <span class="t-spacer"></span>
        <label class="ct-label"><input type="checkbox" id="c-done-box" ${isCompleted(dirRel) ? "checked" : ""}/><span>已完成</span></label>
        <label class="ct-label"><span>同步滚动</span><input type="checkbox" id="c-sync-box" class="switch" ${syncState.enabled ? "checked" : ""}/></label>
        <button class="btn ghost small c-layout" id="c-layout" title="切换左右/上下布局">${svgIco("i-layout-rows")}<span>上下排列</span></button>
      </header>
      <div class="compare-split">
        <section class="compare-pane" id="pane-q"></section>
        <section class="compare-pane" id="pane-a"></section>
      </div>
      <div class="compare-unclass" id="compare-unclass" hidden></div>
    </div>`;

  main.querySelector("#c-back").addEventListener("click", () => history.back());
  main.querySelector("#c-done-box").addEventListener("change", e => {
    setCompleted(dirRel, e.target.checked);
    toast(e.target.checked ? "已标记为完成" : "已取消完成标记");
  });
  main.querySelector("#c-sync-box").addEventListener("change", e => {
    syncState.enabled = e.target.checked;
    toast(e.target.checked ? "已开启同步滚动" : "已关闭同步滚动");
  });
  const layoutBtn = main.querySelector("#c-layout");
  const split = main.querySelector(".compare-split");
  layoutBtn.addEventListener("click", () => {
    split.classList.toggle("vertical");
    const v = split.classList.contains("vertical");
    layoutBtn.innerHTML = v ? `${svgIco("i-layout-cols")}<span>双栏并排</span>` : `${svgIco("i-layout-rows")}<span>上下排列</span>`;
  });
  // 窄屏自动上下
  const mq = matchMedia("(max-width: 900px)");
  const applyMq = () => { if (mq.matches) split.classList.add("vertical"); };
  mq.addEventListener?.("change", applyMq); applyMq();

  /* 挂载两个 pane */
  syncState.panes = [];
  const specs = [
    { id: "pane-q", label: "QUESTION", tag: "题目", file: info.question, emptyText: "暂无题目文件" },
    { id: "pane-a", label: "SOLUTION", tag: "作答", file: info.answer, emptyText: "暂无作答文件" },
  ];
  for (const s of specs) {
    const pane = main.querySelector(`#${s.id}`);
    pane.innerHTML = `
      <div class="pane-label">
        <span class="pane-tag ${s.id === "pane-q" ? "q" : "a"}">${s.tag}</span>
        <span class="pane-file">${s.file ? esc(s.file.name) : s.emptyText}</span>
      </div>
      <div class="pane-holder"></div>`;
    const holder = pane.querySelector(".pane-holder");
    if (!s.file) {
      holder.innerHTML = `
        <div class="pane-empty">
          <span class="pe-ico">${svgIco("i-inbox")}</span>
          <p>${s.emptyText}</p>
        </div>`;
      continue;
    }
    if (/\.pdf$/i.test(s.file.name)) {
      const v = new PdfViewer(pane, s.file, 1, "pane");
      syncState.panes.push({ viewer: v });
      v.onPaneScroll = onPaneScroll;
      await v.load().catch(err => {
        console.error(err);
        holder.innerHTML = `<div class="error-card small"><p>${err.message}</p></div>`;
      });
    } else {
      holder.classList.add("scrollable");
      try {
        const viewer = createViewerFor(s.file);
        // 同目录文件（树节点无 parent 指针，从 G.tree 反查）
        const { findNode } = await import("./app.js");
        const dirRel2 = s.file.rel.includes("/") ? s.file.rel.slice(0, s.file.rel.lastIndexOf("/")) : "";
        const dirNode2 = dirRel2 ? findNode(dirRel2) : null;
        const siblings = dirNode2 ? dirNode2.children.filter(c => c.type === "file") : [];
        await viewer.mount(holder, s.file, siblings);
        holder.addEventListener("scroll", () => {
          if (!syncState.enabled || syncState.lock) return;
          const other = syncState.panes.length > 1
            ? syncState.panes.find(p => p.el !== holder) : null;
          const dst = other ? other.el : (document.querySelector("#pane-a .pane-holder.scrollable, #pane-q .pane-holder.scrollable") !== holder
            ? document.querySelector("#pane-a .pane-holder.scrollable, #pane-q .pane-holder.scrollable") : null);
          if (!dst) return;
          const p = holder.scrollTop / Math.max(1, holder.scrollHeight - holder.clientHeight);
          syncState.lock = true;
          dst.scrollTop = p * (dst.scrollHeight - dst.clientHeight);
          requestAnimationFrame(() => { syncState.lock = false; });
        }, { passive: true });
        syncState.panes.push({ el: holder });
      } catch (err) {
        console.error(err);
        holder.innerHTML = `<div class="error-card small"><p>${err.message}</p></div>`;
      }
    }
  }

  /* 未分类文件（不强行配对） */
  if (info.unclassified.length) {
    const box = main.querySelector("#compare-unclass");
    box.hidden = false;
    box.innerHTML = `
      <div class="unclass-head"><b>未分类文件（${info.unclassified.length}）</b>
      <span class="muted">文件名中无“题目/作答/答案”标识，未强行配对</span></div>
      <div class="unclass-list">
        ${info.unclassified.map(f => `
          <button class="unclass-file" data-open="${esc(f.rel)}" title="${esc(f.rel)}">
            <span class="badge pdf">${(f.name.split(".").pop() || "").toUpperCase()}</span>
            <span class="uf-name">${esc(f.name)}</span>
            <span class="muted">${f.sizeText || ""}</span>
            <span class="uf-hint">单独打开</span>
          </button>`).join("")}
      </div>`;
    box.querySelectorAll("[data-open]").forEach(b =>
      b.addEventListener("click", () => {
        location.hash = `#/read?path=${encodeURIComponent(b.dataset.open)}`;
      }));
  }

  return () => { syncState.panes = []; };
}
