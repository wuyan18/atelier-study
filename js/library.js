/* library.js — Atelier Study：书架 / 课程目录树 / 最近阅读 / 全部课程 / 学习进度 / 收藏 */
import {
  G, fmtSize, extOf, saveState, openPath, toast,
  isCompleted, esc, relTime, findNode, isFav, toggleFav, fetchIndex,
} from "./app.js";
import { analyzeDir, courseAssignStats } from "./assignment.js";
import { formatFor, isReadableName } from "./formats.js";

function isReadable(f) { return isReadableName(f.name); }

function svgIco(sym, cls = "") {
  return `<svg class="ico ${cls}" aria-hidden="true"><use href="#${sym}"/></svg>`;
}
const ICON_SYM = { pdf: "i-pdf", doc: "i-doc", md: "i-doc", text: "i-code", code: "i-code",
                   image: "i-image", zip: "i-zip", other: "i-page" };
function iconFor(node) {
  const f = formatFor(node.name);
  return svgIco(ICON_SYM[f.group] || "i-page");
}
function badgeClassFor(node) {
  return formatFor(node.name).badge;
}

/* ---------- 疑似重复检测（课程内、≥100KB、同扩展且同 size → 仅标记不判定） ---------- */
function findDupSizes(node) {
  const byKey = new Map(); // key: size|ext
  const walk = (n) => {
    if (n.type === "file") {
      const e = extOf(n.name);
      if (n.size >= 100 * 1024) {
        const k = `${n.size}|${e}`;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(n.rel);
      }
    } else if (Array.isArray(n.children)) n.children.forEach(walk);
  };
  walk(node);
  const dup = new Map();
  for (const [, rels] of byKey) {
    if (rels.length > 1) rels.forEach(r => dup.set(r, rels.length));
  }
  return dup;
}

/* ---------- 阅读记录（真实 state.progress，按 ts 倒序） ---------- */
function recentEntries() {
  const prog = (G.state && G.state.progress) || {};
  const out = [];
  for (const rel of Object.keys(prog)) {
    const p = prog[rel];
    if (!p || !p.ts) continue;
    const node = findNode(rel);
    if (!node) continue;
    const courseRel = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "";
    out.push({ rel, prog: p, node, courseRel });
  }
  out.sort((a, b) => b.prog.ts - a.prog.ts);
  return out;
}

function readHashFor(rel, prog) {
  const page = prog && prog.page ? prog.page : 1;
  return prog && prog.page
    ? `#/read?path=${encodeURIComponent(rel)}&page=${page}`
    : `#/read?path=${encodeURIComponent(rel)}`;
}

function badgeTile(node, cls = "") {
  const badge = badgeClassFor(node);
  return `<span class="badge ${badge || "pdf"} ${cls}">${iconFor(node)}</span>`;
}

function progressBits(prog) {
  // 返回 { text, bar } —— 仅真实数据
  if (prog && prog.total) {
    const pct = Math.max(2, Math.min(100, Math.round((prog.page / prog.total) * 100)));
    return { text: `读到 ${prog.page}/${prog.total} 页`, bar: pct, pct };
  }
  if (prog && prog.page) return { text: `第 ${prog.page} 页`, bar: 0, pct: 0 };
  return { text: "已读", bar: 0, pct: 0 };
}

function recentItemHtml(e, withBar = true) {
  const bits = progressBits(e.prog);
  const course = e.courseRel ? esc(courseName(e.courseRel)) : "";
  return `
    <div class="recent-item" data-hash="${esc(readHashFor(e.rel, e.prog))}" title="${esc(e.rel)}">
      ${badgeTile(e.node)}
      <div class="ri-main">
        <div class="ri-name">${esc(e.node.name)}</div>
        <div class="ri-sub">${course ? course + " · " : ""}${esc(e.node.sizeText || "")}</div>
      </div>
      <div class="ri-side">
        <div class="ri-prog">
          ${withBar && bits.bar ? `<span class="mini-bar"><i style="width:${bits.bar}%"></i></span>` : ""}
          <span>${e.prog.total ? bits.text : "已读"}</span>
        </div>
        <span class="ri-time">${relTime(e.prog.ts)}</span>
      </div>
    </div>`;
}

const courseNameCache = new Map();
function courseName(rel) {
  if (courseNameCache.has(rel)) return courseNameCache.get(rel);
  const node = findNode(rel);
  const name = node ? node.name : rel;
  courseNameCache.set(rel, name);
  return name;
}

function bindRecentClicks(root) {
  root.querySelectorAll("[data-hash]").forEach(el =>
    el.addEventListener("click", () => { location.hash = el.dataset.hash; }));
}

/* ---------- 书架首页 ---------- */
export function renderHome(main) {
  const t = G.tree;
  const parts = [];
  const recents = recentEntries();

  parts.push(`<div class="wrap page-fade">`);

  // A. 欢迎区域
  const hour = new Date().getHours();
  const greet = hour < 5 ? "夜深了，注意休息。" : hour < 12 ? "早上好，从回顾开始。" : hour < 18 ? "下午好，保持专注。" : "晚上好，适合安静阅读。";
  parts.push(`
    <section class="hero">
      <div class="hero-text">
        <p class="hero-eyebrow">My Library</p>
        <h1 class="hero-title">书架</h1>
        <p class="hero-sub">${t.stats.courses} 门课程 · ${t.stats.files} 个文件 · ${t.stats.sizeText}</p>
        <p class="hero-greet">${greet}在这里整理、阅读与回顾你的课程资料。</p>
      </div>
      <div class="hero-stats">
        <div class="hstat"><b>${t.stats.courses}</b><span>门课程</span></div>
        <div class="hstat"><b>${t.stats.files}</b><span>个文件</span></div>
        <div class="hstat"><b>${t.stats.sizeText}</b><span>资料容量</span></div>
        <div class="hstat"><b id="stat-pages">—</b><span>已索引页</span></div>
      </div>
    </section>`);

  // D. 快捷继续阅读（有记录才出现）
  if (recents.length) {
    const e = recents[0];
    const bits = progressBits(e.prog);
    parts.push(`
      <div class="continue-card" data-hash="${esc(readHashFor(e.rel, e.prog))}" title="${esc(e.rel)}">
        <span class="cc-play">${svgIco("i-play")}</span>
        <div class="cc-info">
          <div class="cc-label">Continue · 继续阅读</div>
          <div class="cc-name">${esc(e.node.name)}</div>
          <div class="cc-meta">${e.courseRel ? esc(courseName(e.courseRel)) + " · " : ""}${e.prog.total ? bits.text : "上次已读"}${bits.bar ? `<span class="mini-bar"><i style="width:${bits.bar}%"></i></span>` : ""}</div>
        </div>
        <button class="btn primary small" type="button">${svgIco("i-read")}继续阅读</button>
      </div>`);
  }

  // B. 课程卡片
  parts.push(`
    <div class="home-sec-head">
      <h2>${svgIco("i-library")}我的课程</h2>
      <a class="see-all" href="#/courses">全部课程 ${svgIco("i-chev")}</a>
    </div>
    <div class="bookshelf">`);
  let i = 0;
  for (const c of t.courses) parts.push(courseCard(c, i++));
  parts.push(`</div>`);

  // C. 最近阅读
  parts.push(`
    <div class="home-sec-head">
      <h2>${svgIco("i-clock")}最近阅读</h2>
      ${recents.length ? `<a class="see-all" href="#/recent">查看全部 ${svgIco("i-chev")}</a>` : ""}
    </div>`);
  if (recents.length) {
    parts.push(`<div class="recent-list">`);
    for (const e of recents.slice(0, 4)) parts.push(recentItemHtml(e));
    parts.push(`</div>`);
  } else {
    parts.push(`
      <div class="empty-state" style="padding:30px 20px">
        <span class="es-ico">${svgIco("i-clock")}</span>
        <h3>暂无阅读记录</h3>
        <p>打开任意一份资料后，这里会显示最近阅读的内容，方便快速继续。</p>
      </div>`);
  }

  // 根目录散落文件
  if (t.rootFiles.length) {
    parts.push(`
      <div class="home-sec-head"><h2>${svgIco("i-page")}根目录文件</h2></div>
      <div class="panel-list">`);
    parts.push(renderFiles(t.rootFiles, new Map()));
    parts.push(`</div>`);
  }

  parts.push(`</div>`);
  main.className = "home";
  main.innerHTML = parts.join("");

  main.querySelectorAll(".course-card").forEach(el => {
    const go = () => { location.hash = `#/course/${encodeURIComponent(el.dataset.rel)}`; };
    el.addEventListener("click", go);
    el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
  bindRecentClicks(main);
  bindFileActions(main);

  // PDF 索引页数（真实索引数据）
  fetchIndex().then(idx => {
    const el = document.getElementById("stat-pages");
    if (el && idx && idx.state === "ready") el.textContent = String(idx.pages ?? 0);
    else if (el) el.textContent = "—";
  }).catch(() => {});
}

/* 课程卡片（封面感） */
function courseCard(c, i) {
  const st = courseAssignStats(c);
  const empty = c.stats.fileCount === 0;
  const pct = st.assignDirs ? Math.round((st.done / st.assignDirs) * 100) : 0;
  const num = String(i + 1).padStart(2, "0");
  return `
    <article class="course-card ${empty ? "empty-course" : ""} tone-${(i % 6) + 1}" data-rel="${esc(c.rel)}" tabindex="0" aria-label="进入课程 ${esc(c.name)}">
      <div class="cc-cover">
        <span class="cc-code">COURSE ${num}</span>
        <span class="cc-cover-ico">${svgIco("i-library")}</span>
        <span class="cc-initial" aria-hidden="true">${esc(c.name.slice(0, 1))}</span>
      </div>
      <div class="cc-body">
        <div class="cc-titles">
          <h3 class="card-title">${esc(c.name)}</h3>
          <span class="card-sub">${c.stats.fileCount} 个文件${c.stats.pdfs ? ` · ${c.stats.pdfs} 个 PDF` : ""} · ${fmtSize(c.stats.sizeBytes)}</span>
        </div>
        <div class="card-progress">
          ${st.assignDirs ? `
          <div class="cp-head">
            <span class="card-assign ${st.done ? "has" : ""}">${svgIco("i-check")}作业 ${st.done}/${st.assignDirs}</span>
            <span class="cp-size">${pct}%</span>
          </div>
          <div class="cp-bar"><i style="width:${pct}%"></i></div>` : `
          <div class="cp-head">
            <span class="cp-note">${empty ? "空课程" : "暂无作业目录"}</span>
            <span class="cp-size">${c.stats.fileCount} 个文件</span>
          </div>
          <div class="cp-note-bar"></div>`}
        </div>
        <div class="cc-foot">
          <span class="cf-label">${empty ? "空课程" : "进入课程"}</span>
          <span class="card-go">${svgIco("i-arrow-right")}</span>
        </div>
      </div>
    </article>`;
}

/* ---------- 课程页 ---------- */
const EMPTY_FOLD_THRESHOLD = 3; // 空目录超过此数聚合

export function renderCourse(main, node, rel) {
  const expanded = G.state.expandedDirs || (G.state.expandedDirs = {});
  const dupSizes = findDupSizes(node);
  const st = courseAssignStats(node);
  main.className = "course";
  main.innerHTML = `
    <div class="wrap wrap-1080 page-fade">
      <header class="page-head">
        <div class="page-head-text">
          <h1 class="page-title">${esc(node.name)}</h1>
          <p class="page-sub">${node.stats.fileCount} 个文件${node.stats.pdfs ? ` · ${node.stats.pdfs} 个 PDF` : ""} · ${node.stats.sizeText || fmtSize(node.stats.sizeBytes)}</p>
        </div>
        <div class="page-head-chips">
          ${st.assignDirs
            ? `<span class="hchip ok">${svgIco("i-check")}作业 ${st.done}/${st.assignDirs}</span>`
            : `<span class="hchip">${svgIco("i-scales")}暂无作业目录</span>`}
          <span class="hchip">${svgIco("i-folder")}${countDirs(node)} 个目录</span>
        </div>
      </header>
      <div class="tree-toolbar">
        <div class="tree-filter">
          ${svgIco("i-filter")}
          <input id="tree-filter" type="text" placeholder="筛选文件名…" autocomplete="off" spellcheck="false" />
          <button type="button" class="tf-clear" title="清除筛选">${svgIco("i-x")}</button>
        </div>
        <span class="tf-count" id="tf-count"></span>
      </div>
      <div class="tree" id="course-tree"></div>
    </div>`;
  const root = document.getElementById("course-tree");
  root.innerHTML = renderChildren(node.children, rel, expanded, 0, dupSizes);
  bindTree(root, expanded);
  bindTreeFilter(main, root);
  setCrumbCourse(node);
  return null;
}

function setCrumbCourse(node) {
  // 延迟导入避免循环依赖问题：app.js 的 setCrumb 在此模块加载时已可用
  import("./app.js").then(({ setCrumb }) => {
    setCrumb([{ label: "书架", href: "#/" }, { label: node.name }]);
  });
}

function bindTreeFilter(scope, root) {
  const input = scope.querySelector("#tree-filter");
  const clear = scope.querySelector(".tf-clear");
  const box = scope.querySelector(".tree-filter");
  const count = scope.querySelector("#tf-count");
  const apply = () => {
    const q = input.value.trim().toLowerCase();
    root.classList.toggle("filtering", !!q);
    box.classList.toggle("has-q", !!q);
    let n = 0;
    root.querySelectorAll(".file-row").forEach(r => {
      const hit = !q || (r.dataset.rel || "").toLowerCase().includes(q);
      r.classList.toggle("fh", !hit);
      if (hit && q) n++;
    });
    root.querySelectorAll(".dir-block").forEach(d => {
      d.classList.toggle("fh", !!q && !d.querySelector(".file-row:not(.fh)"));
    });
    count.textContent = q ? `${n} 个匹配文件` : "";
  };
  input.addEventListener("input", apply);
  clear.addEventListener("click", () => { input.value = ""; apply(); input.focus(); });
}

function countDirs(node) {
  let n = 0;
  const walk = (x) => { for (const c of x.children || []) { if (c.type === "dir") { n++; walk(c); } } };
  walk(node);
  return n;
}

function renderChildren(children, parentRel, expanded, depth, dupSizes) {
  const empties = children.filter(c => c.type === "dir" && c.empty);
  const normals = children.filter(c => !(c.type === "dir" && c.empty));
  const out = [];
  for (const c of normals) out.push(renderNode(c, expanded, depth, dupSizes));
  if (empties.length > EMPTY_FOLD_THRESHOLD) {
    const first = empties[0].name, last = empties[empties.length - 1].name;
    const label = first === last ? first : `${first} ~ ${last}`;
    out.push(`
      <div class="empty-fold" data-fold="1">
        <span class="ef-tail">${svgIco("i-folder")}</span>
        <span class="ef-label">${esc(label)}</span>
        <span class="ef-note">（${empties.length} 个空目录）</span>
        <div class="ef-list">${empties.map(e => `<div class="ef-item">${svgIco("i-folder")}${esc(e.name)}</div>`).join("")}</div>
      </div>`);
  } else {
    for (const c of empties) out.push(renderNode(c, expanded, depth, dupSizes));
  }
  return out.join("");
}

function renderNode(node, expanded, depth, dupSizes) {
  if (node.type === "file") return renderFiles([node], dupSizes);
  const isOpen = depth === 0
    ? (node.rel in expanded ? !!expanded[node.rel] : !node.archive && !node.empty)
    : (node.rel in expanded ? !!expanded[node.rel] : !node.archive);
  const classes = ["dir-block"];
  if (node.archive) classes.push("archive");
  if (node.empty) classes.push("emptydir");
  if (isOpen) classes.push("open");

  // 作业类目录 → 对照入口 + 完成状态徽章
  const info = analyzeDir(node);
  const done = isCompleted(node.rel);
  const assignBtn = info.assignable
    ? `<button class="compare-btn" data-compare="${esc(node.rel)}" title="题目/作答并排对照阅读">${svgIco("i-scales")}对照${info.question && info.answer ? "" : "（部分）"}</button>`
    : "";
  const doneBadge = /^(作业|实验|小测)/.test(node.name)
    ? (done ? `<span class="done-badge" title="已手动标记完成">${svgIco("i-check")}已完成</span>` : "")
    : "";

  return `
    <div class="${classes.join(" ")}" data-rel="${esc(node.rel)}">
      <div class="dir-head">
        <span class="arrow">${svgIco("i-chev")}</span>
        <span class="d-icon">${svgIco("i-folder")}</span>
        <span class="dir-name">${esc(node.name)}</span>
        <span class="dir-meta">${node.stats.fileCount} 项</span>
        ${doneBadge}
        <span class="t-spacer"></span>
        ${assignBtn}
      </div>
      <div class="children">${node.children.length ? renderChildren(node.children, node.rel, expanded, depth + 1, dupSizes) : ""}</div>
    </div>`;
}

function renderFiles(files, dupSizes) {
  return files.map(f => {
    const readable = isReadable(f);
    const badge = badgeClassFor(f);
    const prog = (G.state.progress || {})[f.rel];
    const progText = prog && prog.total ? ` · <span class="rd">读到 ${prog.page}/${prog.total}</span>` : "";
    const dupCount = dupSizes && dupSizes.get(f.rel);
    const dupTag = dupCount
      ? ` <span class="dup-badge" title="与同课程 ${dupCount - 1} 个文件大小相同（仅大小判断，内容未必相同）">疑似重复</span>` : "";
    const starred = isFav(f.rel);
    return `
    <div class="file-row" data-rel="${esc(f.rel)}">
      <span class="f-icon ${badge || "other"}">${iconFor(f)}</span>
      <span class="f-name" title="${esc(f.rel)}" ${readable ? `data-read="${esc(f.rel)}"` : ""}><span class="fname-text">${esc(f.name)}</span>${badge ? `<span class="badge ${badge}">${extOf(f.name).toUpperCase()}</span>` : ""}${dupTag}</span>
      <span class="f-size">${f.sizeText || ""}${progText}</span>
      <span class="f-actions">
        <button class="fav-btn${starred ? " starred" : ""}" data-fav="${esc(f.rel)}" title="${starred ? "取消收藏" : "收藏该文件"}">${svgIco("i-star")}</button>
        ${readable ? `<button data-read="${esc(f.rel)}" title="在阅读器中打开">${svgIco("i-read")}阅读</button>` : ""}
        <button data-reveal="${esc(f.rel)}" title="在资源管理器中显示">${svgIco("i-reveal")}目录</button>
        <button data-sysopen="${esc(f.rel)}" title="使用系统默认程序打开">${svgIco("i-external")}系统</button>
      </span>
    </div>`;
  }).join("");
}

function bindTree(root, expanded) {
  root.querySelectorAll(".dir-head").forEach(head => {
    head.addEventListener("click", e => {
      if (e.target.closest("button")) return;
      const block = head.closest(".dir-block");
      block.classList.toggle("open");
      expanded[block.dataset.rel] = block.classList.contains("open");
      queueSaveExpanded();
    });
  });
  root.querySelectorAll(".empty-fold").forEach(ef => {
    ef.addEventListener("click", () => ef.classList.toggle("open"));
  });
  // 对照阅读入口
  root.querySelectorAll("[data-compare]").forEach(btn => {
    btn.addEventListener("click", ev => {
      ev.stopPropagation();
      location.hash = `#/compare?dir=${encodeURIComponent(btn.dataset.compare)}`;
    });
  });
  bindFileActions(root);
}

let expSaveTimer = null;
function queueSaveExpanded() {
  clearTimeout(expSaveTimer);
  expSaveTimer = setTimeout(() => saveState(G.state).catch(() => {}), 800);
}

export function bindFileActions(container) {
  container.querySelectorAll("[data-read]").forEach(el =>
    el.addEventListener("click", () => {
      const rel = el.dataset.read;
      const prog = (G.state.progress || {})[rel];
      const page = prog && prog.page ? prog.page : 1;
      location.hash = `#/read?path=${encodeURIComponent(rel)}&page=${page}`;
    }));
  container.querySelectorAll("[data-reveal]").forEach(el =>
    el.addEventListener("click", ev => {
      ev.stopPropagation();
      openPath(el.dataset.reveal, "reveal").catch(err => toast(err.message));
    }));
  container.querySelectorAll("[data-sysopen]").forEach(el =>
    el.addEventListener("click", ev => {
      ev.stopPropagation();
      openPath(el.dataset.sysopen, "open").catch(err => toast(err.message));
    }));
  container.querySelectorAll("[data-fav]").forEach(el =>
    el.addEventListener("click", ev => {
      ev.stopPropagation();
      const rel = el.dataset.fav;
      const on = toggleFav(rel);
      el.classList.toggle("starred", on);
      el.title = on ? "取消收藏" : "收藏该文件";
      toast(on ? "已收藏，可在左侧「收藏」中查看" : "已取消收藏");
    }));
  // 不可读格式文件名点击 → 提示（保留系统打开入口）
  container.querySelectorAll(".f-name").forEach(el => {
    if (el.dataset.read) return;
    el.addEventListener("click", () =>
      toast("该格式暂不支持在阅读器内预览，请使用“系统打开”按钮"));
  });
}

/* ---------- 最近阅读页 ---------- */
export function renderRecent(main) {
  const recents = recentEntries();
  main.className = "recent";
  main.innerHTML = `
    <div class="wrap page-fade">
      <div class="page-titlebar">
        <h1>${svgIco("i-clock")}最近阅读</h1>
        <p class="pt-sub">${recents.length ? `共 ${recents.length} 份资料有阅读记录，点击任意条目恢复上次位置` : "暂无阅读记录"}</p>
      </div>
      ${recents.length ? `
      <div class="panel-list recent-list">
        ${recents.map(e => recentItemHtml(e)).join("")}
      </div>` : `
      <div class="empty-state">
        <span class="es-ico">${svgIco("i-clock")}</span>
        <h3>还没有阅读记录</h3>
        <p>从书架进入任意课程，打开一份 PDF 或笔记，阅读进度会自动保存在本机。</p>
      </div>`}
    </div>`;
  bindRecentClicks(main);
  bindFileActions(main);
}

/* ---------- 全部课程页 ---------- */
export function renderCourses(main) {
  const t = G.tree;
  main.className = "courses";
  main.innerHTML = `
    <div class="wrap page-fade">
      <div class="page-titlebar">
        <h1>${svgIco("i-grid")}全部课程</h1>
        <p class="pt-sub">${t.stats.courses} 门课程 · ${t.stats.files} 个文件 · ${t.stats.sizeText}</p>
      </div>
      <div class="bookshelf">
        ${t.courses.map((c, i) => courseCard(c, i)).join("")}
      </div>
    </div>`;
  main.querySelectorAll(".course-card").forEach(el => {
    const go = () => { location.hash = `#/course/${encodeURIComponent(el.dataset.rel)}`; };
    el.addEventListener("click", go);
    el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
}

/* ---------- 学习进度页 ---------- */
export function renderProgress(main) {
  const t = G.tree;
  const cards = [];
  let totalDone = 0, totalAssign = 0, totalRead = 0;

  for (const c of t.courses) {
    const st = courseAssignStats(c);
    const entries = recentEntries().filter(e => e.courseRel === c.rel);
    if (!st.assignDirs && !entries.length) continue;
    totalDone += st.done; totalAssign += st.assignDirs; totalRead += entries.length;
    const pct = st.assignDirs
      ? Math.round((st.done / st.assignDirs) * 100)
      : (c.stats.fileCount ? Math.min(100, Math.round((entries.length / c.stats.fileCount) * 100)) : 0);
    cards.push(`
      <div class="prog-card">
        <div class="prog-card-head">
          <h3>${esc(c.name)}</h3>
          <span class="prog-pct">${pct}%</span>
        </div>
        <div class="cp-bar"><i style="width:${pct}%"></i></div>
        ${st.assignDirs ? `
        <div class="prog-assign">${svgIco("i-check")}作业完成 ${st.done}/${st.assignDirs}
          ${entries.length ? `<span class="sec-note">· 阅读 ${entries.length} 份</span>` : ""}
        </div>` : `
        <div class="prog-assign">${svgIco("i-clock")}已阅读 ${entries.length} 份资料</div>`}
        ${entries.length ? `
        <div class="prog-files">
          ${entries.slice(0, 6).map(e => {
            const bits = progressBits(e.prog);
            return `
            <div class="prog-file" data-hash="${esc(readHashFor(e.rel, e.prog))}" title="${esc(e.rel)}">
              <span class="pf-name">${esc(e.node.name)}</span>
              <span class="mini-bar${bits.pct >= 100 ? " full" : ""}"><i style="width:${bits.bar || 4}%"></i></span>
              <span class="pf-page">${e.prog.total ? bits.text : "已读"}</span>
            </div>`;
          }).join("")}
          ${entries.length > 6 ? `<div class="sec-note">…另外 ${entries.length - 6} 份</div>` : ""}
        </div>` : ""}
      </div>`);
  }

  main.className = "progress";
  main.innerHTML = `
    <div class="wrap wrap-1080 page-fade">
      <div class="page-titlebar">
        <h1>${svgIco("i-chart")}学习进度</h1>
        <p class="pt-sub">${totalAssign ? `作业已完成 ${totalDone}/${totalAssign}` : "暂无作业目录"}${totalRead ? ` · 累计阅读 ${totalRead} 份资料` : ""}（数据来自本机阅读记录）</p>
      </div>
      ${cards.length ? `<div class="prog-grid">${cards.join("")}</div>` : `
      <div class="empty-state">
        <span class="es-ico">${svgIco("i-chart")}</span>
        <h3>暂无学习数据</h3>
        <p>阅读 PDF 资料或标记作业完成后，这里会展示每门课程的进度概览。</p>
      </div>`}
    </div>`;
  bindRecentClicks(main);
}

/* ---------- 收藏页 ---------- */
export function renderStarred(main) {
  const favs = G.state.settings && G.state.settings.favorites ? G.state.settings.favorites : {};
  const rels = Object.keys(favs).sort((a, b) => (favs[b] || 0) - (favs[a] || 0));
  const nodes = [], missing = [];
  for (const rel of rels) {
    const node = findNode(rel);
    if (node) nodes.push(node); else missing.push(rel);
  }
  main.className = "starred";
  main.innerHTML = `
    <div class="wrap page-fade">
      <div class="page-titlebar">
        <h1>${svgIco("i-star")}收藏</h1>
        <p class="pt-sub">${nodes.length ? `${nodes.length} 份收藏的资料` : "暂无收藏"}${missing.length ? ` · ${missing.length} 个收藏的文件已不在资料目录中` : ""}</p>
      </div>
      ${nodes.length ? `
      <div class="panel-list fav-list">
        ${renderFiles(nodes, new Map())}
      </div>` : `
      <div class="empty-state">
        <span class="es-ico">${svgIco("i-star")}</span>
        <h3>还没有收藏</h3>
        <p>在课程文件列表中把鼠标悬停在某一行，点击星标按钮即可收藏常用资料。</p>
      </div>`}
    </div>`;
  bindFileActions(main);
}
