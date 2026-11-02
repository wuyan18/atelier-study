/* ================================================================
 * tabs.js —— 阅读器标签页
 * 在同一窗口里同时打开多份资料：每页保留自己的页码与缩放，
 * 切换只走 hash 路由（不新增 iframe/窗口），关闭时自动落到相邻标签。
 * ================================================================ */
import { formatFor, isReadableName } from "./formats.js";

const KEY = "atelier.reader.tabs";
const MAX = 8;

let tabs = restore();
let activeRel = null;

function restore() {
  try {
    const raw = sessionStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(t => t && typeof t.rel === "string" && t.rel)
      .slice(0, MAX)
      .map(t => ({ rel: t.rel, name: t.name || t.rel.split("/").pop(), page: t.page || 1, scale: t.scale || null }));
  } catch {
    return [];
  }
}

function persist() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(tabs));
  } catch { /* 隐私模式下忽略 */ }
}

export function getTabs() {
  return tabs.map(t => ({ ...t }));
}

export function activeTab() {
  return tabs.find(t => t.rel === activeRel) || null;
}

export function setActive(rel) {
  activeRel = rel;
}

/* 打开（或激活）一份资料；返回该标签记录 */
export function openTab(node, page) {
  const rel = node.rel;
  let tab = tabs.find(t => t.rel === rel);
  if (!tab) {
    tab = { rel, name: node.name || rel.split("/").pop(), page: page || 1, scale: null };
    tabs.push(tab);
    if (tabs.length > MAX) {
      /* 满员时驱逐最旧的「非当前」标签：主/分屏文件正挂在屏幕上，不能被挤掉 */
      const i = tabs.findIndex(t => t.rel !== activeRel);
      tabs.splice(i < 0 ? 0 : i, 1);
    }
  } else if (page) {
    tab.page = page;
  }
  activeRel = rel;
  persist();
  return { ...tab };
}

export function remember(rel, patch) {
  const tab = tabs.find(t => t.rel === rel);
  if (!tab) return;
  if (patch.page) tab.page = patch.page;
  if (patch.scale) tab.scale = patch.scale;
  persist();
}

/* 关闭标签，返回下一个应当跳转的 rel（没有则为 null） */
export function closeTab(rel) {
  const i = tabs.findIndex(t => t.rel === rel);
  if (i < 0) return null;
  tabs.splice(i, 1);
  persist();
  if (tabs.length === 0) return null;
  const next = tabs[Math.min(i, tabs.length - 1)];
  return next.rel;
}

export function clearTabs() {
  tabs = [];
  activeRel = null;
  persist();
}

/* ---------- 标签条 ---------- */
export function renderTabStrip(host, { onSelect, onClose, onAdd }) {
  if (!host) return;
  host.innerHTML = `
    <div class="rt-scroll">
      ${tabs.map(t => {
        const f = formatFor(t.name);
        return `<button class="rtab${t.rel === activeRel ? " active" : ""}" data-rel="${escapeAttr(t.rel)}" title="${escapeAttr(t.rel)}">
          <svg class="ico rtab-ico"><use href="#${f.icon || "i-page"}"/></svg>
          <span class="rtab-name">${escapeHtml(t.name)}</span>
          <span class="rtab-page">p${t.page || 1}</span>
          <span class="rtab-x" data-close="${escapeAttr(t.rel)}" title="关闭标签">${closeIcon()}</span>
        </button>`;
      }).join("")}
    </div>
    <button class="rtab-add" title="打开其他资料">${plusIcon()}</button>`;

  host.querySelectorAll(".rtab").forEach(btn => {
    btn.addEventListener("click", e => {
      const closeRel = e.target.closest("[data-close]");
      if (closeRel) {
        e.stopPropagation();
        onClose(closeRel.dataset.close);
        return;
      }
      onSelect(btn.dataset.rel);
    });
    // 中键关闭
    btn.addEventListener("auxclick", e => {
      if (e.button === 1) { e.preventDefault(); onClose(btn.dataset.rel); }
    });
  });
  host.querySelector(".rtab-add").addEventListener("click", onAdd);
}

function closeIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;
}
function plusIcon() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;
}

export function scrollActiveIntoView(host) {
  const el = host && host.querySelector(".rtab.active");
  if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/* ---------- 资料选择器 ---------- */
/* 当前挂着的选择器模态的关闭函数（路由切换时用来收掉残留的模态） */
let pickerTeardown = null;

/* 关掉还挂着的资料选择器（路由切换时调用，避免模态残留在新页面上） */
export function closeActivePicker() {
  if (pickerTeardown) {
    try { pickerTeardown(); } catch { /* noop */ }
  }
}

/* 把资料树整理成选择器用的层级结构：只保留可读文件，目录带递归计数，空分支剪掉 */
function buildPickerTree(tree) {
  const walk = node => {
    const children = [];
    let count = 0;
    for (const c of node.children || []) {
      if (c.type === "dir") {
        const sub = walk(c);
        if (sub.count > 0) {
          children.push({ name: c.name, rel: c.rel, kind: "dir", count: sub.count, children: sub.children });
          count += sub.count;
        }
      } else if (isReadableName(c.name)) {
        children.push({ name: c.name, rel: c.rel, kind: "file" });
        count += 1;
      }
    }
    return { children, count };
  };
  const root = walk({ children: [...(tree.courses || []), ...(tree.rootFiles || [])] });
  for (const c of root.children) if (c.kind === "dir") c.kind = "course";
  return root;
}

/* 扁平化成 [{rel, name, course}]（搜索列表与回调参数用） */
function flattenTree(root) {
  const out = [];
  const walk = (nodes, course) => {
    for (const n of nodes) {
      if (n.kind === "file") out.push({ rel: n.rel, name: n.name, course: course || "" });
      else walk(n.children, n.kind === "course" ? n.name : course);
    }
  };
  walk(root.children, "");
  return out;
}

/* tree: G.tree；onPick(file)，file = {rel, name, course}
   默认按「课程 → 文件夹 → 文件」树形浏览，目录可展开收起；
   输入关键词时退回扁平筛选列表（和课程库搜索一致的心智） */
export function pickFile(tree, onPick) {
  const root = buildPickerTree(tree);
  const flat = flattenTree(root);
  const byRel = new Map(flat.map(f => [f.rel, f]));

  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `
    <div class="modal wide picker" role="dialog" aria-modal="true" aria-labelledby="picker-title">
      <div class="modal-head">
        <span id="picker-title">打开资料</span>
        <button class="tb-icon-btn picker-close" title="关闭">${closeIcon()}</button>
      </div>
      <div class="picker-search">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 16l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input type="search" placeholder="按文件名或课程筛选…" aria-label="筛选资料" />
      </div>
      <div class="modal-body picker-body"><div class="picker-list"></div></div>
      <div class="modal-foot"><span class="picker-hint">↑↓ 选择 · Enter 打开/展开 · Esc 关闭</span></div>
    </div>`;
  document.body.appendChild(back);
  /* 渐显：.modal-back 默认 opacity:0，必须补上 .in 才可见
     （否则模态不可见却盖住整页，按钮全部「失灵」—— exams.js 的弹窗同款写法） */
  requestAnimationFrame(() => { if (back.isConnected) back.classList.add("in"); });

  const input = back.querySelector("input");
  const list = back.querySelector(".picker-list");
  const expanded = new Set();       // 展开中的目录 rel
  let rows = [];                    // 当前可见的可交互行（DOM 顺序）
  let curIdx = 0;

  const renderRows = () => {
    const kw = input.value.trim().toLowerCase();
    if (kw) {
      /* 有关键词：扁平筛选（文件行带课程上下文） */
      const hits = flat.filter(f =>
        f.name.toLowerCase().includes(kw) || f.course.toLowerCase().includes(kw) || f.rel.toLowerCase().includes(kw)
      ).slice(0, 200);
      if (!hits.length) return `<div class="picker-empty">没有匹配的资料</div>`;
      return hits.map(f => {
        const fm = formatFor(f.name);
        return `<button class="picker-row picker-file" data-kind="file" data-rel="${escapeAttr(f.rel)}">
          <span class="picker-badge ${fm.badge || ""}">${fm.ext || "—"}</span>
          <span class="picker-text"><b>${escapeHtml(f.name)}</b><em>${escapeHtml(f.course)}</em></span>
        </button>`;
      }).join("");
    }
    /* 无关键词：树形浏览 */
    const renderNode = (n, depth) => {
      if (n.kind === "file") {
        const fm = formatFor(n.name);
        return `<button class="picker-row picker-file" data-kind="file" data-rel="${escapeAttr(n.rel)}" style="--depth:${depth}">
          <span class="picker-badge ${fm.badge || ""}">${fm.ext || "—"}</span>
          <span class="picker-text"><b>${escapeHtml(n.name)}</b></span>
        </button>`;
      }
      const open = expanded.has(n.rel);
      return `<button class="picker-row picker-dir${n.kind === "course" ? " course" : ""}${open ? " open" : ""}" data-kind="dir" data-rel="${escapeAttr(n.rel)}" style="--depth:${depth}" aria-expanded="${open}">
        <svg class="ico picker-arrow"><use href="#i-chev"/></svg>
        <svg class="ico picker-ficon"><use href="#${n.kind === "course" ? "i-library" : "i-folder"}"/></svg>
        <span class="picker-text"><b>${escapeHtml(n.name)}</b></span>
        <span class="picker-count">${n.count}</span>
      </button>${open ? n.children.map(c => renderNode(c, depth + 1)).join("") : ""}`;
    };
    if (!root.children.length) return `<div class="picker-empty">没有可打开的资料</div>`;
    return root.children.map(c => renderNode(c, 0)).join("");
  };

  const syncCur = () => {
    rows.forEach((r, i) => r.classList.toggle("cur", i === curIdx));
    const el = rows[curIdx];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  };

  const paint = focusRel => {
    list.innerHTML = renderRows();
    rows = [...list.querySelectorAll(".picker-row")];
    if (!rows.length) { curIdx = 0; return; }
    if (focusRel) {
      const i = rows.findIndex(r => r.dataset.rel === focusRel);
      curIdx = i >= 0 ? i : Math.min(curIdx, rows.length - 1);
    } else {
      curIdx = Math.min(curIdx, rows.length - 1);
    }
    syncCur();
  };

  const toggleDir = rel => {
    if (expanded.has(rel)) expanded.delete(rel);
    else expanded.add(rel);
    paint(rel);   // 重画后光标留在原目录行上
  };

  const done = () => {
    document.removeEventListener("keydown", onKey, true);
    back.remove();
    if (pickerTeardown === done) pickerTeardown = null;   // 只有还登记着才清（防误清新模态）
  };
  pickerTeardown = done;

  const onKey = e => {
    if (e.key === "Escape") { e.preventDefault(); done(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); if (rows.length) { curIdx = Math.min(curIdx + 1, rows.length - 1); syncCur(); } return; }
    if (e.key === "ArrowUp") { e.preventDefault(); curIdx = Math.max(curIdx - 1, 0); syncCur(); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[curIdx];
      if (!row) return;
      if (row.dataset.kind === "dir") { toggleDir(row.dataset.rel); return; }
      const f = byRel.get(row.dataset.rel);
      if (f) { done(); onPick(f); }
    }
  };

  list.addEventListener("click", e => {
    const row = e.target.closest(".picker-row");
    if (!row) return;
    if (row.dataset.kind === "dir") { toggleDir(row.dataset.rel); return; }
    const f = byRel.get(row.dataset.rel);
    if (f) { done(); onPick(f); }
  });
  input.addEventListener("input", () => { curIdx = 0; paint(); });
  back.querySelector(".picker-close").addEventListener("click", done);
  back.addEventListener("click", e => { if (e.target === back) done(); });
  document.addEventListener("keydown", onKey, true);

  paint("");
  setTimeout(() => input.focus(), 30);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
