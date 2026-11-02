/* app.js — Atelier Study 全局壳：路由 / 主题 / 侧栏 / 收藏 / 状态 */

import { renderHome, renderCourse, renderRecent, renderCourses, renderProgress, renderStarred } from "./library.js";
import { renderReader } from "./reader.js";
import { renderCompare } from "./assignment.js";
import { renderSearch } from "./search.js";
import { renderExams, updateExamBadge } from "./exams.js";
import { closeActivePicker } from "./tabs.js";

const $ = (s, r = document) => r.querySelector(s);

export const G = { tree: null, state: null, config: null, index: null };

export async function api(path, opts) {
  const r = await fetch(path, opts);
  let d = {};
  try { d = await r.json(); } catch (e) { /* 非 JSON 响应 */ }
  if (!r.ok) throw new Error(d.message || r.statusText || "请求失败");
  return d;
}

export async function getTree(fresh) {
  const d = await api(`/api/tree${fresh ? "?fresh=1" : ""}`);
  G.tree = d; // {root(名), stats, courses[], rootFiles[]}
  return G.tree;
}

export async function getState() {
  G.state = await api("/api/state");
  if (!G.state.settings) G.state.settings = {};
  return G.state;
}

export function saveState(state) {
  return api("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state || G.state),
  }).catch((e) => toast("状态保存失败：" + e.message));
}

/* ---------- 通用工具 ---------- */

export function toast(msg, ms = 2600) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}

export function fmtSize(n) {
  if (n == null || isNaN(n)) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function relTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60e3) return "刚刚";
  if (diff < 3600e3) return Math.floor(diff / 60e3) + " 分钟前";
  if (diff < 86400e3) return Math.floor(diff / 3600e3) + " 小时前";
  if (diff < 7 * 86400e3) return Math.floor(diff / 86400e3) + " 天前";
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* 防抖保存（settings / 阅读进度 / 展开目录共用一张时间表） */
const _saveTimers = new Map();
export function debouncedSave(key, data, ms = 600) {
  clearTimeout(_saveTimers.get(key));
  _saveTimers.set(key, setTimeout(() => {
    _saveTimers.delete(key);
    saveState(data);
  }, ms));
}

/* ---------- 阅读进度 ---------- */

export function getProgress(rel) {
  return (G.state && G.state.progress && G.state.progress[rel]) || null;
}

export function setProgress(rel, patch) {
  if (!G.state) return;
  if (!G.state.progress) G.state.progress = {};
  const cur = G.state.progress[rel] || {};
  const next = Object.assign({}, cur, patch);
  if (patch && patch.page != null) { next.page = patch.page; }
  next.ts = Date.now();
  G.state.progress[rel] = next;
  debouncedSave("progress", G.state, 600);
}

/* ---------- 作业完成状态 ---------- */

export function isCompleted(dirRel) {
  return !!(G.state && G.state.completed && G.state.completed[dirRel]);
}

export function setCompleted(dirRel, done) {
  if (!G.state) return;
  if (!G.state.completed) G.state.completed = {};
  if (done) G.state.completed[dirRel] = true;
  else delete G.state.completed[dirRel];
  debouncedSave("completed", G.state, 400);
}

/* ---------- 收藏 ---------- */

export function getFavs() {
  return (G.state && G.state.settings && G.state.settings.favorites) || {};
}
export function isFav(rel) {
  return !!getFavs()[rel];
}
export function toggleFav(rel) {
  const s = G.state;
  if (!s.settings) s.settings = {};
  if (!s.settings.favorites) s.settings.favorites = {};
  const on = !s.settings.favorites[rel];
  if (on) s.settings.favorites[rel] = Date.now();
  else delete s.settings.favorites[rel];
  debouncedSave("favs", s, 400);
  updateFavCount();
  return on;
}
export function updateFavCount() {
  const el = $("#nav-fav-count");
  if (!el) return;
  const n = Object.keys(getFavs()).length;
  el.hidden = n === 0;
  el.textContent = n > 99 ? "99+" : String(n);
}

/* ---------- 主题 ---------- */

const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");

export function resolvedTheme() {
  const pref = (G.state && G.state.settings && G.state.settings.theme) || "auto";
  return pref === "auto" ? (themeMedia.matches ? "dark" : "light") : pref;
}

export function applyTheme() {
  const pref = (G.state && G.state.settings && G.state.settings.theme) || "auto";
  const real = resolvedTheme();
  document.documentElement.dataset.theme = real;
  try { localStorage.setItem("atelier-theme", pref); } catch (e) { /* 忽略 */ }
  document.querySelectorAll("#theme-seg button").forEach((b) => {
    b.classList.toggle("active", b.dataset.themeSet === pref);
  });
}

export function setTheme(pref) {
  if (!["auto", "light", "dark"].includes(pref)) return;
  if (!G.state.settings) G.state.settings = {};
  G.state.settings.theme = pref;
  applyTheme();
  debouncedSave("theme", G.state, 400);
}

themeMedia.addEventListener("change", () => {
  if ((G.state && G.state.settings && G.state.settings.theme || "auto") === "auto") applyTheme();
});

/* ---------- 侧栏折叠 ---------- */

export function applySideCollapsed(collapsed) {
  document.body.classList.toggle("side-collapsed", !!collapsed);
}

function toggleSide() {
  const collapsed = !document.body.classList.contains("side-collapsed");
  applySideCollapsed(collapsed);
  if (!G.state.settings) G.state.settings = {};
  G.state.settings.sideCollapsed = collapsed;
  debouncedSave("side", G.state, 400);
}

/* ---------- 全文索引状态 ---------- */

let indexCache = null, indexAt = 0;
export async function fetchIndex(force = false) {
  if (!force && indexCache && Date.now() - indexAt < 30000) return indexCache;
  try {
    indexCache = await api("/api/index");
    indexAt = Date.now();
  } catch (e) {
    indexCache = { state: "error", message: e.message };
  }
  renderIndexStatus(indexCache);
  return indexCache;
}

function renderIndexStatus(index) {
  const a = $("#side-index");
  if (!a || !index) return;
  const dot = a.querySelector(".si-dot");
  const txt = a.querySelector(".si-text");
  const st = index.state || "none";
  dot.className = "si-dot " + (st === "ready" ? "ok" : st === "building" ? "warn" : st === "error" ? "err" : "");
  if (st === "ready") {
    txt.textContent = `全文索引 ${index.indexed ?? index.total ?? 0}/${index.total ?? 0} PDF · ${index.pages ?? 0} 页`;
    a.title = "全文索引已就绪，点击进入全文搜索";
  } else if (st === "building") {
    txt.textContent = `索引构建中 ${index.indexed ?? 0}/${index.total ?? 0} …`;
    a.title = "全文索引正在后台构建";
  } else if (st === "error") {
    txt.textContent = "索引异常，点击查看";
    a.title = index.message || "全文索引异常";
  } else {
    txt.textContent = "全文索引未建立";
    a.title = "首次使用请先进入全文搜索页建立索引";
  }
}

/* ---------- 文件操作 ---------- */

export async function openPath(path, mode = "open") {
  try {
    const r = await api("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, mode }),
    });
    if (r && r.message) toast(r.message);
  } catch (e) {
    toast("打开失败：" + e.message);
  }
}

export function findNode(rel) {
  const t = G.tree;
  if (!t || !rel) return null;
  // 课程节点 / 根目录散落文件
  for (const c of t.courses || []) if (c.rel === rel) return c;
  for (const f of t.rootFiles || []) if (f.rel === rel) return f;
  // 课程内逐级查找
  const slash = rel.indexOf("/");
  if (slash === -1) return null;
  let cur = (t.courses || []).find(c => c.rel === rel.slice(0, slash));
  if (!cur) return null;
  for (const part of rel.slice(slash + 1).split("/")) {
    if (!cur || cur.type !== "dir" || !Array.isArray(cur.children)) return null;
    cur = cur.children.find(c => c.name === part);
  }
  return cur && cur.rel === rel ? cur : null;
}

export function extOf(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export async function refreshTree() {
  try {
    await getTree(true);
    toast("已重新扫描资料目录");
  } finally {
    route();
  }
}

/* ---------- 面包屑与标题 ---------- */

export function setCrumb(items) {
  const crumb = $("#crumb");
  if (!crumb) return;
  crumb.innerHTML = items.map((it, i) => {
    const last = i === items.length - 1;
    const label = esc(it.label);
    return (it.href && !last)
      ? `<a href="${it.href}">${label}</a>`
      : `<b>${label}</b>`;
  }).join('<span class="c-sep">/</span>');
}

export function setTitle(t) {
  document.title = t ? `${t} — Atelier Study` : "Atelier Study";
}

/* ---------- 壳层路由 ---------- */

let cleanupFn = null;
let routeToken = 0;

const ROUTES = {
  home:   { nav: "home",    crumb: [{ label: "书架" }] },
  recent: { nav: "recent",  crumb: [{ label: "书架", href: "#/" }, { label: "最近阅读" }] },
  courses:{ nav: "courses", crumb: [{ label: "书架", href: "#/" }, { label: "全部课程" }] },
  progress:{ nav: "progress", crumb: [{ label: "书架", href: "#/" }, { label: "学习进度" }] },
  starred:{ nav: "starred", crumb: [{ label: "书架", href: "#/" }, { label: "收藏" }] },
  exams:  { nav: "exams",   crumb: [{ label: "书架", href: "#/" }, { label: "考试计划" }] },
  search: { nav: "",         crumb: [{ label: "全文搜索" }] },
  course: { nav: "courses", crumb: [] },
  read:   { nav: "",         crumb: [] },
  compare:{ nav: "",         crumb: [] },
};

function applyRouteShell(name) {
  const meta = ROUTES[name] || ROUTES.home;
  document.body.dataset.route = name;
  document.querySelectorAll("#side-nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.nav === meta.nav);
  });
  if (meta.crumb.length) setCrumb(meta.crumb);
}

function hashParams(h) {
  const q = {};
  const i = h.indexOf("?");
  if (i >= 0) for (const [k, v] of new URLSearchParams(h.slice(i + 1))) q[k] = v;
  return q;
}

export function route() {
  const main = $("#main");
  closeActivePicker();   // 路由切换：收掉可能还挂着的资料选择器（分屏/加号模态）
  if (cleanupFn) { try { cleanupFn(); } catch (e) { /* 忽略清理异常 */ } cleanupFn = null; }
  const token = ++routeToken;
  const h = location.hash || "#/";
  let name = "home", arg = null, query = "";

  try {
    let m;
    if ((m = h.match(/^#\/read\??(.*)$/))) {
      name = "read";
      const p = hashParams(h);
      const path = p.path || "";
      // 面包屑：书架 / 课程 / 文件（沉浸路由下 topbar 隐藏，但 crumb 仍写入 DOM）
      const seg = path.split("/");
      const courseNode = seg.length > 1 ? findNode(seg[0]) : null;
      setCrumb([
        { label: "书架", href: "#/" },
        { label: courseNode ? courseNode.name : (seg[0] || "课程"), href: seg.length > 1 ? `#/course/${encodeURIComponent(seg[0])}` : "#/" },
        { label: seg[seg.length - 1] || path },
      ]);
      // 分屏参数：split= 第二份文件，splitpage= 其起始页
      let splitNode = null;
      if (p.split) {
        splitNode = findNode(p.split);
        if (!splitNode) toast(`分屏文件不存在，已忽略：${p.split}`);
      }
      arg = {
        node: findNode(path), page: parseInt(p.page, 10) || 1, path,
        split: splitNode, splitPage: parseInt(p.splitpage, 10) || 1,
      };
      if (!arg.node) throw new Error("找不到文件：" + path);
    } else if ((m = h.match(/^#\/compare\??(.*)$/))) {
      name = "compare";
      const p = hashParams(h);
      const dir = p.dir || "";
      const seg = dir.split("/");
      setCrumb([
        { label: "书架", href: "#/" },
        { label: seg[0] || "课程", href: `#/course/${encodeURIComponent(seg[0] || "")}` },
        { label: "对照阅读" },
      ]);
      arg = { node: findNode(dir), dir };
      if (!arg.node) throw new Error("找不到目录：" + dir);
    } else if ((m = h.match(/^#\/search\??(.*)$/))) {
      name = "search";
      arg = hashParams(h).q || "";
    } else if ((m = h.match(/^#\/course\/(.+)$/))) {
      name = "course";
      const want = decodeURIComponent(m[1]);
      // 面包屑先写入目标课程名（课程不存在时报错页也保留导航位置）
      setCrumb([{ label: "书架", href: "#/" }, { label: want.split("/")[0] }]);
      arg = findNode(want);
      if (!arg) throw new Error("找不到课程目录");
    } else if (h === "#/recent") { name = "recent"; }
    else if (h === "#/courses") { name = "courses"; }
    else if (h === "#/progress") { name = "progress"; }
    else if (h === "#/starred") { name = "starred"; }
    else if (h === "#/exams") { name = "exams"; }

    applyRouteShell(name);
    const R = async () => {
      if (name === "read") { setTitle(arg.node.name); await renderReader(main, arg.node, arg.page, { splitNode: arg.split, splitPage: arg.splitPage }); }
      else if (name === "compare") { setTitle(arg.node.name + " · 对照"); await renderCompare(main, arg.node, arg.dir); }
      else if (name === "search") { setTitle("全文搜索"); await renderSearch(main, arg); }
      else if (name === "course") { await renderCourse(main, arg, arg.rel); }
      else if (name === "recent") { setTitle("最近阅读"); await renderRecent(main); }
      else if (name === "courses") { setTitle("全部课程"); await renderCourses(main); }
      else if (name === "progress") { setTitle("学习进度"); await renderProgress(main); }
      else if (name === "starred") { setTitle("收藏"); await renderStarred(main); }
      else if (name === "exams") { setTitle("考试计划"); return await renderExams(main); }
      else { setTitle(""); await renderHome(main); }
    };
    const p = R();
    if (p && p.then) {
      p.then((fn) => {
        if (typeof fn !== "function") return;
        if (token === routeToken) cleanupFn = fn;
        else { try { fn(); } catch (e) { /* 已被新页面接管，立即清理 */ } }
      }).catch((e) => {
        if (token === routeToken) renderError(main, e);
      });
    }
  } catch (e) {
    renderError(main, e);
  }
}

function renderError(main, e) {
  console.error(e);
  setTitle("");
  // 保留当前面包屑（错误页仍显示用户所在的导航位置）
  document.body.dataset.route = "home";
  main.innerHTML = `
    <div class="error-card page-fade">
      <h3>出错了</h3>
      <p>${esc(e.message || e)}</p>
      <button class="btn primary" id="err-back">返回书架</button>
    </div>`;
  $("#err-back").onclick = () => { location.hash = "#/"; route(); };
}

/* ---------- 初始化 ---------- */

function bindShell() {
  // 全局搜索表单
  $("#search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#search-input").value.trim();
    location.hash = q ? `#/search?q=${encodeURIComponent(q)}` : "#/search";
  });

  // "/" 聚焦搜索
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement && document.activeElement.isContentEditable)) return;
    if (e.key === "/") {
      e.preventDefault();
      const inp = $("#search-input");
      if (inp) { inp.focus(); inp.select(); }
    } else if (e.key === "Escape") {
      const inp = $("#search-input");
      if (inp && document.activeElement === inp) { inp.value = ""; inp.blur(); }
    }
  });

  // 侧栏折叠
  $("#side-toggle").addEventListener("click", toggleSide);

  // 顶栏「重新扫描」工具按钮（P1 行为保留：busy 态 + toast + 重渲染当前页）
  const tools = $("#topbar-tools");
  if (tools && !$("#btn-refresh")) {
    const btn = document.createElement("button");
    btn.id = "btn-refresh";
    btn.className = "tb-btn ghost";
    btn.title = "重新扫描资料目录";
    btn.innerHTML = `<svg class="ico"><use href="#i-refresh"/></svg><span>重新扫描</span>`;
    btn.addEventListener("click", async () => {
      if (btn.classList.contains("busy")) return;
      btn.classList.add("busy");
      try {
        await getTree(true);
        toast(`已重新扫描，${(G.tree.stats && G.tree.stats.courses) || "?"} 门课程`);
      } catch (e) {
        toast("重新扫描失败：" + (e.message || e));
      } finally {
        btn.classList.remove("busy");
        route();
      }
    });
    tools.appendChild(btn);
  }

  // 主题分段控件
  $("#theme-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-theme-set]");
    if (b) setTheme(b.dataset.themeSet);
  });

  // 退出服务
  $("#btn-shutdown").addEventListener("click", async () => {
    if (!confirm("确定要退出阅读器服务吗？")) return;
    try { await api("/api/shutdown", { method: "POST" }); } catch (e) { /* 服务已退出时请求会失败，忽略 */ }
    const main = $("#main");
    main.innerHTML = `
      <div class="empty-state page-fade">
        <span class="es-ico"><svg class="ico"><use href="#i-power"/></svg></span>
        <h3>服务已退出</h3>
        <p>阅读器后台服务已停止。如需再次使用，请重新运行「启动.bat」。</p>
      </div>`;
  });
}

async function init() {
  bindShell();
  window.G = G; // 调试/CDP 检查入口（P1 兼容）
  try {
    const [config] = await Promise.all([api("/api/config"), getState()]);
    G.config = config;
  } catch (e) {
    G.config = null;
  }
  applyTheme();
  applySideCollapsed(!!(G.state.settings && G.state.settings.sideCollapsed));
  updateFavCount();

  const verNo = $("#app-ver-no");
  if (verNo && G.config && G.config.version) verNo.textContent = G.config.version;

  window.addEventListener("hashchange", route);
  /* 返回/前进到相同 hash 时 hashchange 不触发，路由清理不会跑，
     还挂着的资料选择器模态会残留在页面上 —— popstate 兜底收掉 */
  window.addEventListener("popstate", closeActivePicker);

  try {
    await getTree();
  } catch (e) {
    renderError($("#main"), e);
    return;
  }
  fetchIndex();
  updateExamBadge();
  route();
}

init();
