/* reader.js — Atelier Study：PDF 阅读器（懒渲染、文字层、页内搜索、缩放、大纲侧栏、分屏） */
import * as pdfjsLib from "/vendor/pdfjs/pdf.min.mjs";
import { G, setProgress, getProgress, toast, setTitle, fmtSize, findNode, esc } from "./app.js";
import { createViewerFor } from "./viewers.js";
import { onPaneScroll } from "./assignment.js";
import {
  openTab, closeTab, setActive, getTabs, remember,
  renderTabStrip, scrollActiveIntoView, pickFile,
} from "./tabs.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";

/* 与 P1 保持一致：按 range 分段拉取 + 关闭自动全量下载 */
const PDFJS_OPTS = {
  cMapUrl: "/vendor/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
  wasmUrl: "/vendor/pdfjs/wasm/",
  rangeChunkSize: 1024 * 1024,
  disableAutoFetch: true,
};

function svgIco(sym, cls = "") {
  return `<svg class="ico ${cls}" aria-hidden="true"><use href="#${sym}"/></svg>`;
}

/* 分屏链接：#/read?path=…&page=…&split=…&splitpage=… */
function splitHash(rel, page, splitRel, splitPage) {
  let h = `#/read?path=${encodeURIComponent(rel)}`;
  if (page && page > 1) h += `&page=${page}`;
  if (splitRel) {
    h += `&split=${encodeURIComponent(splitRel)}`;
    if (splitPage && splitPage > 1) h += `&splitpage=${splitPage}`;
  }
  return h;
}

/* 打开资料选择器，选一份文件与当前文件并排（分屏） */
function pickSplitFile(currentRel, currentPage, onExit) {
  pickFile(G.tree, f => {
    if (f.rel === currentRel) { toast("分屏文件与当前文件相同，已取消"); return; }
    const prog = getProgress(f.rel);          // 分屏文件若有历史进度则恢复
    location.hash = splitHash(currentRel, currentPage, f.rel, prog && prog.page ? prog.page : 1);
  });
  if (onExit) onExit();
}

export async function renderReader(main, node, initialPage, opts = {}) {
  if (node.type === "dir") throw new Error("不能直接打开目录");

  /* --- 非 PDF：统一文档阅读器（Markdown / DOCX / 代码 / 图片 / ZIP / 未知） --- */
  if (!/\.pdf$/i.test(node.name)) {
    const splitting = !!opts.splitNode;
    main.className = "doc-page";
    main.innerHTML = `
      <div class="reader-tabs" id="reader-tabs"></div>
      <div class="doc-toolbar">
        <button class="btn ghost d-back" id="d-back">${svgIco("i-arrow-left")}<span>返回</span></button>
        <span class="t-sep"></span>
        <span class="rt-meta"><span class="t-title">${node.name}</span><span class="t-course">课程资料 · 阅读器</span></span>
        <span class="d-tag">${node.ext || "FILE"}</span>
        <span class="t-spacer"></span>
        <button class="btn ghost d-split${splitting ? " active" : ""}" id="d-split" title="再开一份资料并排阅读">${svgIco("i-layout-cols")}<span>分屏</span></button>
        <button class="btn ghost d-reveal" id="d-reveal">${svgIco("i-reveal")}<span>目录</span></button>
        <button class="btn ghost d-sysopen" id="d-sysopen">${svgIco("i-external")}<span>系统</span></button>
      </div>
      <div class="doc-body${splitting ? " has-split" : ""}">
        ${splitting ? `<div class="doc-main"></div><section class="split-pane" id="split-pane"></section>` : `<div class="doc-loading loading"></div>`}
      </div>`;
    openTab(node);
    setActive(node.rel);
    /* 分屏上下文（文档没有页码 API，页码取标签记录） */
    const splitCtx = opts.splitNode ? {
      rel: opts.splitNode.rel,
      swap: () => {
        const pages = Object.fromEntries(getTabs().map(t => [t.rel, t.page || 1]));
        location.hash = splitHash(opts.splitNode.rel, pages[opts.splitNode.rel] || 1, node.rel, pages[node.rel] || 1);
      },
      exit: () => { location.hash = splitHash(node.rel, 0, null, 0); },
      openAlongside: rel => {
        const pages = Object.fromEntries(getTabs().map(t => [t.rel, t.page || 1]));
        location.hash = splitHash(rel, 1, opts.splitNode.rel, pages[opts.splitNode.rel] || 1);
      },
    } : null;
    const paintTabs = initTabs(main.querySelector("#reader-tabs"), node, splitCtx);
    paintTabs();
    main.querySelector("#d-back").addEventListener("click", () => history.back());
    main.querySelector("#d-reveal").addEventListener("click", () => openPathFallback(node.rel, "reveal"));
    main.querySelector("#d-sysopen").addEventListener("click", () => openPathFallback(node.rel, "open"));
    main.querySelector("#d-split").addEventListener("click", () => {
      if (opts.splitNode) location.hash = splitHash(node.rel, 0, null, 0);   // 退出分屏
      else pickSplitFile(node.rel, 0);
    });
    setTitle(node.name);
    try {
      const viewer = createViewerFor(node);
      const container = splitting ? main.querySelector(".doc-main") : main.querySelector(".doc-body");
      // 同目录文件列表（树节点无 parent 指针，从 G.tree 反查父目录）
      const dirRel = node.rel.includes("/") ? node.rel.slice(0, node.rel.lastIndexOf("/")) : "";
      const dirNode = dirRel ? findNode(dirRel) : null;
      const siblings = dirNode ? dirNode.children.filter(c => c.type === "file") : [];
      await viewer.mount(container, node, siblings);
    } catch (err) {
      console.error(err);
      const host = main.querySelector(".doc-main") || main.querySelector(".doc-body");
      host.innerHTML = `
        <div class="error-card"><h3>无法打开此文件</h3><p>${err.message}</p>
        <button class="btn primary" id="err-sysopen">${svgIco("i-external")}使用系统程序打开</button></div>`;
      main.querySelector("#err-sysopen").addEventListener("click", () => openPathFallback(node.rel, "open"));
    }
    /* 右侧分屏 */
    let splitViewer = null;
    if (opts.splitNode) {
      openTab(opts.splitNode, opts.splitPage);
      setActive(node.rel);          // openTab 会把 active 指到分屏文件，拨回主文件
      paintTabs();
      const rec = await mountSplitPane(main.querySelector("#split-pane"), opts.splitNode, {
        initialPage: opts.splitPage,
        onClose: () => { location.hash = splitHash(node.rel, 0, null, 0); },
        onChange: () => pickSplitFile(node.rel, 0),
      }).catch(err => { console.error(err); toast("分屏文件打开失败：" + err.message); return null; });
      splitViewer = rec && rec.viewer ? rec.viewer : null;
    }
    const tabHost2 = main.querySelector("#reader-tabs");
    /* 分屏文件的标签页码/缩放随其阅读进度更新（仅 PDF 分屏有页码概念）
       旧实现把 syncTab 挂在 viewer 属性上，但没有任何地方调用它 —— 死代码 */
    const syncSplitTab = () => {
      if (!splitViewer || !splitViewer.pdf) return;
      remember(opts.splitNode.rel, { page: splitViewer.currentPage, scale: splitViewer.scale });
      const el = tabHost2 && tabHost2.querySelector(`.rtab[data-rel="${CSS.escape(opts.splitNode.rel)}"] .rtab-page`);
      if (el) el.textContent = "p" + splitViewer.currentPage;
    };
    const splitTimer = setInterval(syncSplitTab, 1200);
    return () => { clearInterval(splitTimer); if (splitViewer) splitViewer.destroy(); };
  }

  /* --- PDF --- */
  const splitting = !!opts.splitNode;
  main.className = "reader";
  main.innerHTML = `
    <div class="reader-root">
      <div class="reader-tabs" id="reader-tabs"></div>
      <div class="reader-body${splitting ? " has-split" : ""}"><div class="pdf-scroll" id="pdf-scroll"><div class="pdf-pages" id="pdf-pages"></div></div>
        ${splitting ? `<section class="split-pane" id="split-pane"></section>` : ""}
      </div>
    </div>`;
  const holder = main.querySelector(".reader-root");
  const tabHost = main.querySelector("#reader-tabs");

  /* 标签页：先登记/激活当前文件，再按标签记录恢复页码与缩放 */
  const tabRec = openTab(node, initialPage);
  setActive(node.rel);
  const viewer = new PdfViewer(holder, node, initialPage, "full");
  viewer.restoreScale = tabRec && tabRec.scale ? tabRec.scale : null;

  /* 分屏上下文：分屏文件标签的点击/关闭/加号语义（闭包在用户操作时才取 splitViewer） */
  const splitCtx = opts.splitNode ? {
    rel: opts.splitNode.rel,
    swap: () => {            // 点击分屏文件标签：主↔分屏互换，各自页码保留
      const sp = splitViewer && splitViewer.pdf ? splitViewer.currentPage : (opts.splitPage || 1);
      location.hash = splitHash(opts.splitNode.rel, sp, node.rel, viewer.currentPage);
    },
    exit: () => { location.hash = splitHash(node.rel, viewer.currentPage, null, 0); },
    openAlongside: rel => {  // “+” 打开新资料时保住当前对照
      const sp = splitViewer && splitViewer.pdf ? splitViewer.currentPage : (opts.splitPage || 1);
      location.hash = splitHash(rel, 1, opts.splitNode.rel, sp);
    },
  } : null;
  const paintTabs = initTabs(tabHost, node, splitCtx);
  paintTabs();

  /* 分屏：主工具栏按钮 */
  viewer.onSplitToggle = () => {
    if (opts.splitNode) location.hash = splitHash(node.rel, viewer.currentPage, null, 0);
    else pickSplitFile(node.rel, viewer.currentPage);
  };

  /* 右侧分屏面板（与主文件加载并行，谁慢都不挡首屏） */
  let splitViewer = null;
  if (opts.splitNode) {
    // load() 期间就会 replaceState，先给一个基础版本保住 split 参数
    viewer.urlBuilder = page => splitHash(node.rel, page, opts.splitNode.rel, opts.splitPage || 1);
  }
  const mainLoad = viewer.load().catch(err => {
    console.error(err);
    holder.innerHTML = `
      <div class="error-card"><h3>PDF 加载失败</h3><p>${err.message}</p>
      <button class="btn primary" id="err-sysopen">${svgIco("i-external")}使用系统程序打开</button></div>`;
    const btn = holder.querySelector("#err-sysopen");
    if (btn) btn.addEventListener("click", () => openPathFallback(node.rel, "open"));
  });
  if (opts.splitNode) {
    openTab(opts.splitNode, opts.splitPage);
    setActive(node.rel);            // openTab 会把 active 指到分屏文件，拨回主文件
    paintTabs();
    const rec = await mountSplitPane(main.querySelector("#split-pane"), opts.splitNode, {
      initialPage: opts.splitPage,
      onClose: () => { location.hash = splitHash(node.rel, viewer.currentPage, null, 0); },
      onChange: () => pickSplitFile(node.rel, viewer.currentPage),
    }).catch(err => { console.error(err); toast("分屏文件打开失败：" + err.message); return null; });
    splitViewer = rec && rec.viewer ? rec.viewer : null;
    /* 主文件的 hash 更新需携带 split 参数（滚动/翻页 replaceState 时保留分屏状态） */
    viewer.urlBuilder = page => {
      const sp = splitViewer && splitViewer.pdf ? splitViewer.currentPage : (opts.splitPage || 1);
      return splitHash(node.rel, page, opts.splitNode.rel, sp);
    };
  }
  const splitBtn = holder.querySelector(".r-split");
  if (splitBtn) splitBtn.classList.toggle("active", splitting);
  await mainLoad;

  // 标签上的页码随阅读进度更新
  const syncTab = () => {
    if (!viewer || !viewer.pdf) return;
    remember(node.rel, { page: viewer.currentPage, scale: viewer.scale });
    setProgress(node.rel, viewer.currentPage, viewer.pdf.numPages);   // 主文件进度落盘（最近阅读）
    const el = tabHost.querySelector(`.rtab[data-rel="${CSS.escape(node.rel)}"] .rtab-page`);
    if (el) el.textContent = "p" + viewer.currentPage;
    if (splitViewer && splitViewer.pdf) {
      remember(opts.splitNode.rel, { page: splitViewer.currentPage, scale: splitViewer.scale });
      setProgress(opts.splitNode.rel, splitViewer.currentPage, splitViewer.pdf.numPages);   // 分屏文件进度落盘
      const el2 = tabHost.querySelector(`.rtab[data-rel="${CSS.escape(opts.splitNode.rel)}"] .rtab-page`);
      if (el2) el2.textContent = "p" + splitViewer.currentPage;
    }
  };
  const tabTimer = setInterval(syncTab, 1200);

  return () => {
    clearInterval(tabTimer);
    syncTab();
    if (splitViewer) splitViewer.destroy();
    viewer.destroy();
  };
}

/* ================================================================
 * 分屏面板：右侧与主文件并排的第二份资料
 * PDF → PdfViewer pane 模式（独立翻页/缩放）；其他 → 文档 viewer
 * ================================================================ */
async function mountSplitPane(paneEl, fileNode, { initialPage = 1, onClose, onChange }) {
  if (!paneEl) throw new Error("分屏容器不存在");
  paneEl.innerHTML = `
    <div class="split-pane-label">
      <span class="pane-tag s">对照</span>
      <span class="pane-file" title="${esc(fileNode.rel)}">${esc(fileNode.name)}</span>
      <button class="tb-icon-btn sp-change" title="更换分屏文件">${svgIco("i-refresh")}</button>
      <button class="tb-icon-btn sp-close" title="关闭分屏">${svgIco("i-x")}</button>
    </div>
    <div class="pane-holder"></div>`;
  paneEl.querySelector(".sp-close").addEventListener("click", () => onClose && onClose());
  paneEl.querySelector(".sp-change").addEventListener("click", () => onChange && onChange());
  const holder = paneEl.querySelector(".pane-holder");

  if (/\.pdf$/i.test(fileNode.name)) {
    const v = new PdfViewer(paneEl, fileNode, initialPage, "pane");
    await v.load();
    return { viewer: v };
  }
  holder.classList.add("scrollable");
  try {
    const viewer = createViewerFor(fileNode);
    const dirRel = fileNode.rel.includes("/") ? fileNode.rel.slice(0, fileNode.rel.lastIndexOf("/")) : "";
    const dirNode = dirRel ? findNode(dirRel) : null;
    const siblings = dirNode ? dirNode.children.filter(c => c.type === "file") : [];
    await viewer.mount(holder, fileNode, siblings);
  } catch (err) {
    console.error(err);
    holder.innerHTML = `<div class="error-card small"><p>${err.message}</p></div>`;
  }
  return { viewer: null };
}

async function openPathFallback(rel, mode) {
  const { openPath } = await import("./app.js");
  openPath(rel, mode).catch(err => toast(err.message));
}

/* 标签条事件（PDF 阅读器与文档阅读器共用）
   splitCtx：处于分屏时为 { rel, swap(), exit(), openAlongside(rel) }，
   定义「分屏文件的标签」在该状态下的语义。 */
function tabHref(rel) {
  const t = getTabs().find(x => x.rel === rel);
  const pg = t && Number(t.page) > 1 ? `&page=${Number(t.page)}` : "";
  return `#/read?path=${encodeURIComponent(rel)}${pg}`;
}

function initTabs(tabHost, node, splitCtx) {
  const paintTabs = () => {
    renderTabStrip(tabHost, {
      onSelect: rel => {
        if (rel === node.rel) return;
        if (splitCtx && rel === splitCtx.rel) { splitCtx.swap(); return; }   // 分屏文件标签：主↔分屏互换
        location.hash = tabHref(rel);
      },
      onClose: rel => {
        if (splitCtx && rel === splitCtx.rel) {
          // 关掉分屏文件的标签 = 收起分屏（面板里正是这份文件）
          closeTab(rel);
          splitCtx.exit();
          return;
        }
        const next = closeTab(rel);
        if (rel !== node.rel) { paintTabs(); return; }
        if (next) {
          location.hash = tabHref(next);
        } else {
          const top = node.rel.includes("/") ? node.rel.split("/")[0] : "";
          location.hash = top ? `#/course/${encodeURIComponent(top)}` : "#/";
        }
      },
      onAdd: () => {
        pickFile(G.tree, f => {
          if (splitCtx) {
            if (f.rel === splitCtx.rel) { splitCtx.swap(); return; }         // 已是分屏文件 → 互换
            splitCtx.openAlongside(f.rel);                                   // 保住当前对照
            return;
          }
          if (f.rel === node.rel) { toast("已在当前标签页打开"); return; }  // 选了当前文件：明确反馈而不是无响应
          location.hash = `#/read?path=${encodeURIComponent(f.rel)}`;
        });
      },
    });
    scrollActiveIntoView(tabHost);
  };
  return paintTabs;
}

/* ================================================================
 * PdfViewer — 懒渲染 PDF 阅读器
 * mode "full"：完整 chrome（工具栏 + 大纲侧栏 + 顶部进度保存）
 * mode "pane"：作业对照页里的精简 pane（无侧栏，工具栏极简）
 * ================================================================ */
export class PdfViewer {
  constructor(root, node, initialPage, mode = "full") {
    this.root = root;
    this.node = node;
    this.mode = mode;
    this.pdf = null;
    this.dead = false;
    this.rendered = new Map();   // pageNum → {canvas, wrap, renderTask}
    this.building = new Set();
    this.destroyTimers = new Map();
    this.textCache = new Map();  // pageNum → textContent.items
    this.searchHits = [];
    this.searchIdx = -1;
    this.currentPage = 1;
    this.atFit = true;
    this.initialPage = initialPage || 1;
    this._syncing = false;
    this.onPaneScroll = null;    // 作业对照同步滚动钩子
    this.onSplitToggle = null;   // 分屏按钮（full 模式工具栏）
    this.urlBuilder = null;      // 自定义阅读 hash（分屏模式下携带 split 参数）
  }

  /* ---------- chrome ---------- */
  _buildChrome() {
    if (this.mode === "full") {
      this.chrome = document.createElement("div");
      this.chrome.className = "reader-toolbar";
      this.chrome.innerHTML = `
        <div class="rt-zone rt-left">
          <button class="tb-icon-btn r-back" title="返回上一页（Alt+←）">${svgIco("i-arrow-left")}</button>
          <span class="rt-meta">
            <span class="t-title" title="${this.node.name}">${this.node.name}</span>
            <span class="t-course">${this.courseName()}</span>
          </span>
        </div>
        <div class="rt-zone rt-center">
          <button class="tb-icon-btn r-prev" id="r-prev" title="上一页（←）">${svgIco("i-chev-left")}</button>
          <input class="r-page" id="r-page" type="number" min="1" value="1" aria-label="页码" />
          <span class="t-info"><span class="r-total" id="r-total">/ —</span></span>
          <button class="tb-icon-btn r-next" id="r-next" title="下一页（→）">${svgIco("i-chev-right")}</button>
          <span class="t-sep"></span>
          <button class="tb-icon-btn r-zoom-out lg" id="r-zoom-out" title="缩小（Ctrl + 滚轮 / Ctrl -）">${svgIco("i-minus")}</button>
          <span class="t-info r-zoom-label" id="r-zoom-label">100%</span>
          <button class="tb-icon-btn r-zoom-in lg" id="r-zoom-in" title="放大（Ctrl + 滚轮 / Ctrl +）">${svgIco("i-plus")}</button>
          <button class="btn ghost small r-fit" title="适应宽度（Ctrl 0）">${svgIco("i-fit")}<span>适宽</span></button>
        </div>
        <div class="rt-zone rt-right">
          <div class="reader-searchbar" role="search">
            ${svgIco("i-search")}
            <input class="r-search" type="search" placeholder="页内搜索…" aria-label="页内搜索" />
            <span class="t-info r-search-info">0/0</span>
            <button class="tb-icon-btn r-search-prev" title="上一个命中">${svgIco("i-chev-up")}</button>
            <button class="tb-icon-btn r-search-next" title="下一个命中">${svgIco("i-chev-down")}</button>
          </div>
          <button class="tb-icon-btn r-split" title="分屏：再开一份资料并排阅读">${svgIco("i-layout-cols")}</button>
          <button class="tb-icon-btn r-outline" title="目录 / 大纲">${svgIco("i-list")}</button>
          <button class="tb-icon-btn r-reveal" title="在资源管理器中显示">${svgIco("i-reveal")}</button>
          <button class="tb-icon-btn r-sysopen" title="使用系统程序打开">${svgIco("i-external")}</button>
        </div>`;

      this.body = this.root.querySelector(".reader-body");
      const tabHost = this.root.querySelector(".reader-tabs");
      if (tabHost) tabHost.after(this.chrome);   // 标签条在上，工具栏紧随其后
      else this.root.prepend(this.chrome);

      /* 载入进度条（贴在阅读区顶部，仅在加载中显示） */
      const scroller = this.root.querySelector(".pdf-scroll");
      if (scroller) {
        const prog = document.createElement("div");
        prog.className = "pdf-prog";
        prog.hidden = true;
        prog.innerHTML = `<span class="pdf-prog-text">载入中…</span><span class="pdf-prog-bar"><i></i></span>`;
        scroller.appendChild(prog);
      }

      /* 大纲侧栏（可折叠，为缩略图/书签预留） */
      this.side = document.createElement("aside");
      this.side.className = "reader-side";
      this.side.innerHTML = `
        <div class="rs-head">
          <span class="rs-title">${svgIco("i-list")}目录</span>
          <button class="tb-icon-btn rs-close" title="收起">${svgIco("i-x")}</button>
        </div>
        <div class="rs-body"><div class="outline-list"></div></div>`;
      this.body.appendChild(this.side);

      this.outlineLoaded = false;
      this.outlineOpen = false;
    } else {
      this.chrome = document.createElement("div");
      this.chrome.className = "pane-toolbar";
      this.chrome.innerHTML = `
        <span class="pt-title" title="${this.node.name}">${this.node.name}</span>
        <span class="t-spacer"></span>
        <button class="tb-icon-btn sm r-prev" title="上一页">${svgIco("i-chev-left")}</button>
        <input class="r-page" type="number" min="1" value="1" aria-label="页码" />
        <span class="t-info"><span class="r-total">/ —</span></span>
        <button class="tb-icon-btn sm r-next" title="下一页">${svgIco("i-chev-right")}</button>
        <span class="t-sep"></span>
        <button class="tb-icon-btn sm r-zoom-out" title="缩小">${svgIco("i-minus")}</button>
        <span class="t-info r-zoom-label">100%</span>
        <button class="tb-icon-btn sm r-zoom-in" title="放大">${svgIco("i-plus")}</button>
        <button class="tb-icon-btn sm r-fit" title="适应宽度">${svgIco("i-fit")}</button>`;
      const holder = this.root.querySelector(".pane-holder") || this.root;
      holder.innerHTML = `<div class="pdf-scroll"><div class="pdf-pages"></div></div>`; // 保持 .pane-holder .pdf-scroll 结构（测试依赖）
      holder.before(this.chrome); // 面板内：标签栏 → 工具栏 → 滚动区
    }

    /* 元素引用 */
    const q = s => this.chrome.querySelector(s);
    this._els = {
      scroll: this.mode === "full"
        ? this.root.querySelector(".pdf-scroll")
        : this.root.querySelector(".pane-holder .pdf-scroll"),
      pages: this.mode === "full"
        ? this.root.querySelector(".pdf-pages")
        : this.root.querySelector(".pane-holder .pdf-pages"),
      page: q(".r-page"),
      total: q(".r-total"),
      zoomLabel: q(".r-zoom-label"),
      search: q(".r-search"),
      searchInfo: q(".r-search-info"),
    };
  }

  courseName() {
    const rel = this.node.rel || "";
    const top = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "";
    return top || "课程资料";
  }

  /* 更新地址栏（保留分屏参数；默认 #/read?path=&page=） */
  _replaceUrl(page) {
    const url = this.urlBuilder
      ? this.urlBuilder(page)
      : `#/read?path=${encodeURIComponent(this.node.rel)}${page > 1 ? "&page=" + page : ""}`;
    history.replaceState(null, "", url);
  }

  /* ---------- 加载 ---------- */
  async load() {
    this._buildChrome();
    const loadingTask = pdfjsLib.getDocument({
      url: `/api/file?path=${encodeURIComponent(this.node.rel)}`,
      ...PDFJS_OPTS,
    });
    this._watchProgress(loadingTask);

    this.pdf = await loadingTask.promise;
    this._loadDone();

    /* 只取第一页的页对象：其余页在真正要渲染时再取。
       以前在这里 Promise.all 取全部页，等于逼 PDF.js 把整本文件（最大 66 MB）
       走一遍对象流；现在按需读取，首屏只碰第一页附近的字节。 */
    this.pageObjs = new Array(this.pdf.numPages + 1);
    this.pageProms = new Array(this.pdf.numPages + 1);
    this.pageObjs[1] = await this.pdf.getPage(1);

    this.baseViewport = this.pageObjs[1].getViewport({ scale: 1 });
    this.fitScale = this._computeFit();
    if (this.restoreScale && this.restoreScale > 0.1) {
      this.scale = Math.min(Math.max(this.restoreScale, 0.1), 6);
      this.atFit = Math.abs(this.scale - this.fitScale) < 0.01;
    } else {
      this.scale = this.fitScale;
      this.atFit = true;
    }

    if (this.mode === "full") {
      // 恢复阅读进度
      const prog = getProgress(this.node.rel);
      let start = this.initialPage;
      if (!start && prog && prog.page) start = prog.page;
      this.currentPage = Math.min(Math.max(start || 1, 1), this.pdf.numPages);
      setProgress(this.node.rel, { page: this.currentPage, total: this.pdf.numPages });
      this._replaceUrl(this.currentPage);
      // 大文件提示
      if (this.node.sizeBytes > 30 * 1024 * 1024) {
        toast(`文件较大（${fmtSize(this.node.sizeBytes)}），页面按需加载中…`);
      }
    } else {
      this.currentPage = Math.min(Math.max(this.initialPage || 1, 1), this.pdf.numPages);
    }

    this._buildDom();
    this._bindToolbar();
    this._observe();
    if (this.mode === "full") this._bindKeys();
    this._scrollToPage(this.currentPage, "instant");
    this._updateZoomLabel();

    /* 不把首屏交给 IntersectionObserver：可见性被系统判定为遮挡时它不会触发，
       页面就会一直停在占位符上。这里显式画当前页，并顺手预热相邻页。 */
    this._renderPage(this.currentPage);
    this._prefetchNeighbors();
  }

  /* 页对象按需获取（同一页只请求一次） */
  _page(n) {
    if (this.pageObjs[n]) return Promise.resolve(this.pageObjs[n]);
    if (!this.pageProms[n]) {
      this.pageProms[n] = this.pdf.getPage(n).then(p => { this.pageObjs[n] = p; return p; });
      this.pageProms[n].catch(() => { this.pageProms[n] = null; });
    }
    return this.pageProms[n];
  }

  _prefetchNeighbors() {
    for (const n of [this.currentPage - 1, this.currentPage + 1]) {
      if (n >= 1 && n <= this.pdf.numPages) this._page(n).catch(() => {});
    }
  }

  /* ---------- 加载进度 ---------- */
  _watchProgress(loadingTask) {
    const box = this._els.scroll && this._els.scroll.querySelector(".pdf-prog");
    if (!box) return;
    box.hidden = false;
    const bar = box.querySelector("i");
    const txt = box.querySelector(".pdf-prog-text");
    loadingTask.onProgress = ({ loaded, total }) => {
      const pct = total ? Math.min(99, Math.round((loaded / total) * 100)) : null;
      if (bar) bar.style.width = (pct === null ? 35 : pct) + "%";
      if (txt) {
        txt.textContent = total
          ? `载入中 ${pct}% · ${fmtSize(loaded)} / ${fmtSize(total)}`
          : `载入中 · ${fmtSize(loaded)}`;
      }
    };
  }

  _loadDone() {
    const box = this._els.scroll && this._els.scroll.querySelector(".pdf-prog");
    if (box) {
      const bar = box.querySelector("i");
      if (bar) bar.style.width = "100%";
      clearTimeout(this._progTimer);
      this._progTimer = setTimeout(() => { box.hidden = true; }, 260);
    }
  }

  _computeFit() {
    const cw = this._els.scroll.clientWidth;
    // 两侧留白：屏幕上给纸张一点呼吸空间，避免页面顶到边缘
    const side = Math.max(14, Math.min(64, Math.round(cw * 0.045)));
    const w = cw - side * 2;
    return w > 100 ? w / this.baseViewport.width : 1;
  }

  _buildDom() {
    const pages = this._els.pages;
    pages.innerHTML = "";
    this._els.total.textContent = `/ ${this.pdf.numPages}`;
    this._els.page.max = this.pdf.numPages;
    this._els.page.value = this.currentPage;
    this._updateNavState();

    const frag = document.createDocumentFragment();
    for (let i = 1; i <= this.pdf.numPages; i++) {
      // 已取到的页对象用真实尺寸，未取到的先用第一页比例占位（渲染时再校正）
      const vp = this.pageObjs[i] ? this.pageObjs[i].getViewport({ scale: 1 }) : this.baseViewport;
      const wrap = document.createElement("div");
      wrap.className = "pdf-page placeholder";
      wrap.dataset.page = i;
      wrap.style.width = Math.round(vp.width * this.scale) + "px";
      wrap.style.height = Math.round(vp.height * this.scale) + "px";
      wrap.innerHTML = `<div class="page-loading">第 ${i} 页</div>`;
      frag.appendChild(wrap);
    }
    pages.appendChild(frag);
  }

  /* ---------- 懒渲染观察 ---------- */
  _observe() {
    this._visible = new Set();
    this._queue = [];
    this._active = 0;

    this.io = new IntersectionObserver(entries => {
      for (const en of entries) {
        const n = +en.target.dataset.page;
        if (en.isIntersecting) {
          clearTimeout(this.destroyTimers.get(n));
          this.destroyTimers.delete(n);
          this._visible.add(n);
          this._enqueue(n);
        } else {
          this._visible.delete(n);
          if (this.rendered.has(n)) {
            const t = setTimeout(() => this._destroyPage(n), 4000);
            this.destroyTimers.set(n, t);
          }
        }
      }
    }, { root: this._els.scroll, rootMargin: "120% 0px" });
    this._els.pages.querySelectorAll(".pdf-page").forEach(w => this.io.observe(w));

    // 遮挡/后台标签页会让 IO 不再回调：回到前台时补一次渲染
    this._visHandler = () => {
      if (document.visibilityState !== "visible") return;
      this._sweepVisible();
    };
    document.addEventListener("visibilitychange", this._visHandler);

    // 滚动 → 当前页同步
    this._els.scroll.addEventListener("scroll", () => {
      if (this._syncing) return;
      if (this.onPaneScroll) this.onPaneScroll(this);
      clearTimeout(this._scrollTimer);
      this._scrollTimer = setTimeout(() => {
        this.currentPage = this._currentPageFromScroll();
        this._els.page.value = this.currentPage;
        this._updateNavState();
        this._prefetchNeighbors();
        if (this.mode === "full") {
          setProgress(this.node.rel, { page: this.currentPage, total: this.pdf.numPages });
          this._replaceUrl(this.currentPage);
        }
      }, 250);
    }, { passive: true });
  }

  /* 排队渲染：同时最多 2 页，滚走的页直接丢弃，避免快速滚动时堆一堆任务 */
  _enqueue(n) {
    if (this.dead || this.rendered.has(n) || this.building.has(n)) return;
    if (this._queue.includes(n)) return;
    this._queue.push(n);
    this._drain();
  }

  _drain() {
    if (this._draining) return;
    this._draining = true;
    while (this._active < 2 && this._queue.length) {
      const n = this._queue.shift();
      if (!this._visible.has(n) && n !== this.currentPage) continue;
      this._active++;
      this._renderPage(n).finally(() => {
        this._active--;
        this._draining = false;
        this._drain();
      });
    }
    this._draining = false;
  }

  _sweepVisible() {
    const sc = this._els.scroll;
    const top = sc.scrollTop, bottom = top + sc.clientHeight;
    this._els.pages.querySelectorAll(".pdf-page").forEach(w => {
      const t = w.offsetTop, b = t + w.offsetHeight;
      if (b > top && t < bottom && !this.rendered.has(+w.dataset.page)) {
        this._visible.add(+w.dataset.page);
        this._enqueue(+w.dataset.page);
      }
    });
  }

  /* ---------- 页面渲染 ---------- */
  async _renderPage(n) {
    if (this.dead || this.rendered.has(n) || this.building.has(n)) return;
    this.building.add(n);
    try {
      const pageObj = await this._page(n);
      if (this.dead) return;
      const vp = pageObj.getViewport({ scale: this.scale });
      const wrap = this._els.pages.querySelector(`.pdf-page[data-page="${n}"]`);
      if (!wrap || this.dead) return;

      // 校正占位尺寸（不同页尺寸可能不同）
      const w = Math.round(vp.width), h = Math.round(vp.height);
      if (Math.abs(wrap.offsetWidth - w) > 1) wrap.style.width = w + "px";
      if (Math.abs(wrap.offsetHeight - h) > 1) wrap.style.height = h + "px";

      const canvas = document.createElement("canvas");
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = Math.round(vp.width) + "px";
      canvas.style.height = Math.round(vp.height) + "px";
      wrap.appendChild(canvas);

      const ctx = canvas.getContext("2d", { alpha: false });
      const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null;
      const task = pageObj.render({ canvasContext: ctx, viewport: vp, transform });
      this.rendered.set(n, { canvas, wrap, renderTask: task });

      await task.promise;

      // 文字层（选择/复制）
      const textDivs = [];
      const tc = await pageObj.getTextContent();
      this.textCache.set(n, tc.items);
      const textLayerDiv = document.createElement("div");
      textLayerDiv.className = "textLayer";
      wrap.appendChild(textLayerDiv);
      const tl = new pdfjsLib.TextLayer({
        textContentSource: tc,
        container: textLayerDiv,
        viewport: vp,
      });
      await tl.render();

      wrap.classList.remove("placeholder");
      const loading = wrap.querySelector(".page-loading");
      if (loading) loading.remove();
      if (this.searchHits.length) this._applyHighlight(n);
    } catch (err) {
      if (err && err.name === "RenderingCancelledException") return;
      console.error(`渲染第 ${n} 页失败:`, err);
    } finally {
      this.building.delete(n);
    }
  }

  _destroyPage(n) {
    const rec = this.rendered.get(n);
    if (!rec) return;
    try { rec.renderTask.cancel(); } catch { /* noop */ }
    rec.canvas.remove();
    const tl = rec.wrap.querySelector(".textLayer");
    if (tl) tl.remove();
    rec.wrap.classList.add("placeholder");
    if (!rec.wrap.querySelector(".page-loading")) {
      const d = document.createElement("div");
      d.className = "page-loading";
      d.textContent = `第 ${n} 页`;
      rec.wrap.appendChild(d);
    }
    this.rendered.delete(n);
  }

  /* ---------- 缩放 ---------- */
  _pageTopOf(w) {
    return w.offsetTop - this._els.scroll.offsetTop;
  }

  _pageAtOffset(docY) {
    let best = null;
    this._els.pages.querySelectorAll(".pdf-page").forEach(w => {
      const t = this._pageTopOf(w);
      if (docY >= t && docY < t + w.offsetHeight) best = w;
    });
    return best;
  }

  /* anchorClientX/Y：以鼠标位置为锚点缩放（不传则以视口中心为准）；两轴都保真 */
  _setScale(s, anchorClientX, anchorClientY) {
    s = Math.min(Math.max(s, 0.1), 6);
    if (Math.abs(s - this.scale) < 0.001) return;
    const sc = this._els.scroll;
    const rect = sc.getBoundingClientRect();
    const localX = typeof anchorClientX === "number" ? anchorClientX - rect.left : sc.clientWidth / 2;
    const localY = typeof anchorClientY === "number" ? anchorClientY - rect.top : sc.clientHeight / 2;
    const docY = sc.scrollTop + localY;
    const docX = sc.scrollLeft + localX;

    /* 锚点所在的页，以及锚点在页内的相对位置（0~1） */
    const wrap = this._pageAtOffset(docY)
      || this._els.pages.querySelector(`.pdf-page[data-page="${this.currentPage}"]`);
    const pageNo = wrap ? +wrap.dataset.page : this.currentPage;
    let relY = 0.5, relX = 0.5;
    if (wrap) {
      const y = wrap.offsetHeight ? (docY - this._pageTopOf(wrap)) / wrap.offsetHeight : 0.5;
      const x = wrap.offsetWidth ? (docX - (wrap.offsetLeft - sc.offsetLeft)) / wrap.offsetWidth : 0.5;
      relY = Math.min(Math.max(y, 0), 1);
      relX = Math.min(Math.max(x, 0), 1);
    }

    this.scale = s;
    this.atFit = false;
    this._rerenderAll();

    const nw = this._els.pages.querySelector(`.pdf-page[data-page="${pageNo}"]`);
    if (nw) {
      sc.scrollTop = Math.max(0, this._pageTopOf(nw) + relY * nw.offsetHeight - localY);
      sc.scrollLeft = Math.max(0, nw.offsetLeft - sc.offsetLeft + relX * nw.offsetWidth - localX);
      this.currentPage = pageNo;
      this._els.page.value = pageNo;
      this._updateNavState();
    }
  }

  /* Ctrl/⌘ + 滚轮 = 缩放文档本身（而不是整个网页）
     第一格立即生效；连续滚动时因子持续累加，按节流窗口统一应用：
     既不丢格（旧实现只取最后一格），也不会每帧全量重渲染。 */
  _bindWheelZoom() {
    const sc = this._els.scroll;
    const APPLY_MS = 120;
    let acc = 1;                 // 待应用的累积因子
    let anchorX = null, anchorY = null;
    let last = 0;                // 上次实际应用的时间戳
    this._wheelHandler = e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();        // 阻止浏览器整页缩放
      const dy = e.deltaY || 0;
      if (!dy) return;
      acc *= Math.exp(-dy * 0.0022);   // 平滑：向上放大，向下缩小
      anchorX = e.clientX; anchorY = e.clientY;
      const now = performance.now();
      if (now - last >= APPLY_MS) {
        // 距上次应用已超过节流窗：立即应用（保证第一格就有反馈）
        last = now;
        const f = acc; acc = 1;
        this._setScale(this.scale * f, anchorX, anchorY);
      } else {
        // 节流窗内：累积，到窗口边界统一应用
        clearTimeout(this._wheelTimer);
        this._wheelTimer = setTimeout(() => {
          last = performance.now();
          const f = acc; acc = 1;
          if (f !== 1) this._setScale(this.scale * f, anchorX, anchorY);
        }, APPLY_MS - (now - last));
      }
    };
    sc.addEventListener("wheel", this._wheelHandler, { passive: false });
  }

  _rerenderAll() {
    const cur = this.currentPage;
    for (const [n] of this.rendered) this._destroyPage(n);
    this._els.pages.querySelectorAll(".pdf-page").forEach(w => {
      const n = +w.dataset.page;
      const vp = this.pageObjs[n] ? this.pageObjs[n].getViewport({ scale: this.scale }) : this.baseViewport;
      w.style.width = Math.round(vp.width * (this.pageObjs[n] ? 1 : this.scale)) + "px";
      w.style.height = Math.round(vp.height * (this.pageObjs[n] ? 1 : this.scale)) + "px";
    });
    this._scrollToPage(cur, "instant");
    // IO 只在交叉状态变化时触发；销毁后必须显式重渲染当前页
    this._renderPage(cur);
    this._updateZoomLabel();
  }

  _updateZoomLabel() {
    this._els.zoomLabel.textContent = Math.round(this.scale * 100) + "%";
  }

  /* 首页禁用「上一页」、末页禁用「下一页」：到边界时给可见反馈 */
  _updateNavState() {
    if (!this.pdf) return;
    const prev = this.chrome && this.chrome.querySelector(".r-prev");
    const next = this.chrome && this.chrome.querySelector(".r-next");
    if (prev) prev.disabled = this.currentPage <= 1;
    if (next) next.disabled = this.currentPage >= this.pdf.numPages;
  }

  _scrollToPage(n, behavior = "smooth") {
    const w = this._els.pages.querySelector(`.pdf-page[data-page="${n}"]`);
    if (!w) return;
    this._els.scroll.scrollTo({ top: w.offsetTop - this._els.scroll.offsetTop - 8, behavior });
  }

  _currentPageFromScroll() {
    const center = this._els.scroll.scrollTop + this._els.scroll.clientHeight / 2;
    let best = 1, bestDist = Infinity;
    this._els.pages.querySelectorAll(".pdf-page").forEach(w => {
      const mid = w.offsetTop + w.offsetHeight / 2;
      const d = Math.abs(mid - center);
      if (d < bestDist) { bestDist = d; best = +w.dataset.page; }
    });
    return best;
  }

  /* ---------- 工具栏事件 ---------- */
  _bindToolbar() {
    const q = s => this.chrome.querySelector(s);
    if (this.mode === "full") {
      q(".r-back").addEventListener("click", () => {
        const top = this.node.rel.split("/")[0];
        location.hash = `#/course/${encodeURIComponent(top)}`;
      });
      q(".r-reveal").addEventListener("click", () => openPathFallback(this.node.rel, "reveal"));
      q(".r-sysopen").addEventListener("click", () => openPathFallback(this.node.rel, "open"));
      q(".r-outline").addEventListener("click", () => this._toggleOutline());
      q(".r-split").addEventListener("click", () => this.onSplitToggle && this.onSplitToggle());
      this.side.querySelector(".rs-close").addEventListener("click", () => this._toggleOutline(false));
    }
    q(".r-prev").addEventListener("click", () => this._jump(this.currentPage - 1));
    q(".r-next").addEventListener("click", () => this._jump(this.currentPage + 1));
    this._els.page.addEventListener("keydown", e => {
      if (e.key === "Enter") { this._jump(+this._els.page.value || 1); this._els.page.blur(); }
    });
    q(".r-zoom-out").addEventListener("click", () => this._setScale(this.scale / 1.2));
    q(".r-zoom-in").addEventListener("click", () => this._setScale(this.scale * 1.2));
    this._els.zoomLabel.addEventListener("click", () => {
      // 点百分比：在「适宽」和「100%」之间切换
      const target = this.atFit ? 1 : this._computeFit();
      this.fitScale = this._computeFit();
      this.scale = target;
      this.atFit = Math.abs(target - this.fitScale) < 0.001;
      this._rerenderAll();
    });
    this._els.zoomLabel.style.cursor = "pointer";
    this._els.zoomLabel.title = "点击在「适宽 / 原始大小」之间切换";
    q(".r-fit").addEventListener("click", () => {
      this.fitScale = this._computeFit();
      this.scale = this.fitScale;
      this.atFit = true;
      this._rerenderAll();
    });
    this._bindWheelZoom();

    // 页内搜索
    if (this._els.search) {
      this._els.search.addEventListener("keydown", e => {
        if (e.key === "Enter") {
          if (this._lastQuery === this._els.search.value.trim() && this.searchHits.length) {
            this._jumpHit(e.shiftKey ? -1 : 1);
          } else {
            this._doSearch(this._els.search.value.trim());
          }
        }
      });
      q(".r-search-prev").addEventListener("click", () => this._jumpHit(-1));
      q(".r-search-next").addEventListener("click", () => this._jumpHit(1));
    }

    // 窗口尺寸变化：适宽模式下重新适配
    this._resizeHandler = () => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => {
        if (this.atFit) {
          this.fitScale = this._computeFit();
          this.scale = this.fitScale;
          this._rerenderAll();
        }
      }, 300);
    };
    window.addEventListener("resize", this._resizeHandler);
  }

  _jump(n) {
    n = Math.min(Math.max(n, 1), this.pdf.numPages);
    if (n === this.currentPage) return;
    this.currentPage = n;
    this._els.page.value = n;
    this._updateNavState();
    this._scrollToPage(n);
    if (this.mode === "full") {
      setProgress(this.node.rel, { page: n, total: this.pdf.numPages });
      this._replaceUrl(n);
    }
  }

  /* ---------- 键盘（仅 full 模式） ---------- */
  _bindKeys() {
    this._keyHandler = e => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.altKey && e.key === "ArrowLeft") { history.back(); return; }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "=" || e.key === "+") { this._setScale(this.scale * 1.2); e.preventDefault(); }
        else if (e.key === "-") { this._setScale(this.scale / 1.2); e.preventDefault(); }
        else if (e.key === "0") {
          this.fitScale = this._computeFit();
          this.scale = this.fitScale;
          this.atFit = true;
          this._rerenderAll();
          e.preventDefault();
        }
        return;
      }
      if (e.key === "ArrowLeft") { this._jump(this.currentPage - 1); e.preventDefault(); }
      else if (e.key === "ArrowRight") { this._jump(this.currentPage + 1); e.preventDefault(); }
    };
    window.addEventListener("keydown", this._keyHandler);
  }

  /* ---------- 大纲侧栏 ---------- */
  async _toggleOutline(force) {
    const open = force !== undefined ? force : !this.outlineOpen;
    this.outlineOpen = open;
    this.side.classList.toggle("open", open);
    this.chrome.querySelector(".r-outline").classList.toggle("active", open);
    if (open && !this.outlineLoaded) {
      this.outlineLoaded = true;
      const list = this.side.querySelector(".outline-list");
      try {
        const outline = await this.pdf.getOutline();
        if (!outline || !outline.length) {
          list.innerHTML = `<div class="outline-empty">此 PDF 没有内嵌目录</div>`;
          return;
        }
        const flat = [];
        const walk = (items, depth) => {
          for (const it of items) {
            flat.push({ it, depth });
            if (it.items && it.items.length) walk(it.items, depth + 1);
          }
        };
        walk(outline, 0);
        list.innerHTML = "";
        for (const { it, depth } of flat) {
          let page = null;
          try {
            const dest = typeof it.dest === "string"
              ? await this.pdf.getDestination(it.dest)
              : it.dest;
            if (dest && dest[0]) {
              const idx = typeof dest[0] === "object" && dest[0] !== null
                ? await this.pdf.getPageIndex(dest[0]) : dest[0];
              page = idx + 1;
            }
          } catch { /* 无效目标忽略 */ }
          const btn = document.createElement("button");
          btn.className = `outline-item d${depth}`;
          btn.innerHTML = `<span class="ol-label">${it.title || "（无标题）"}</span>${page ? `<span class="ol-page">${page}</span>` : ""}`;
          btn.addEventListener("click", () => {
            if (page) {
              this._jump(page);
              list.querySelectorAll(".outline-item").forEach(x => x.classList.remove("current"));
              btn.classList.add("current");
            }
          });
          if (page === this.currentPage) btn.classList.add("current");
          list.appendChild(btn);
        }
      } catch (err) {
        console.warn("读取 PDF 大纲失败:", err);
        list.innerHTML = `<div class="outline-empty">无法读取目录</div>`;
      }
    }
  }

  /* ---------- 页内搜索 ---------- */
  async _doSearch(q) {
    this.searchHits = [];
    this.searchIdx = -1;
    this._lastQuery = q;
    if (!q) { this._clearHighlights(); this._updateSearchInfo(); return; }
    const lower = q.toLowerCase();

    for (let n = 1; n <= this.pdf.numPages; n++) {
      let items = this.textCache.get(n);
      if (!items) {
        try { items = (await this.pageObjs[n].getTextContent()).items; this.textCache.set(n, items); }
        catch { continue; }
      }
      const pageText = items.map(it => it.str).join(" ").toLowerCase();
      if (pageText.includes(lower)) {
        // 计算该页命中次数
        let count = 0, idx = 0;
        while ((idx = pageText.indexOf(lower, idx)) !== -1) { count++; idx += lower.length; }
        this.searchHits.push({ page: n, spanIdx: -1, count });
      }
    }

    if (!this.searchHits.length) {
      const hasText = [...this.textCache.values()].some(items => items && items.length);
      if (!hasText) toast("未找到文本（此文件可能是扫描件）");
      else toast(`在已加载文本的页面中未找到“${q}”，滚动浏览更多页面后重新搜索`);
      this._clearHighlights();
      this._updateSearchInfo();
      return;
    }

    this._jumpHit(1);
  }

  _jumpHit(dir) {
    if (!this.searchHits.length) return;
    this.searchIdx = (this.searchIdx + dir + this.searchHits.length) % this.searchHits.length;
    const hit = this.searchHits[this.searchIdx];
    this._scrollToPage(hit.page);
    // 高亮 DOM 中该页的文本 span
    const wrap = this._els.pages.querySelector(`.pdf-page[data-page="${hit.page}"]`);
    if (wrap) {
      const spans = [...wrap.querySelectorAll(".textLayer span")];
      const match = spans.find(s => s.textContent.toLowerCase().includes((this._lastQuery || "").toLowerCase()));
      spans.forEach(s => s.classList.remove("current"));
      if (match) {
        match.classList.add("search-hit", "current");
        match.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
    this._updateSearchInfo();
  }

  _applyHighlight(n) { /* 懒页渲染后由 _jumpHit 精确高亮 */ }

  _clearHighlights() {
    this._els.pages.querySelectorAll(".textLayer .search-hit, .textLayer .current")
      .forEach(s => s.classList.remove("search-hit", "current"));
  }

  _updateSearchInfo() {
    if (!this._els.searchInfo) return;
    this._els.searchInfo.textContent = this.searchHits.length
      ? `${this.searchIdx + 1}/${this.searchHits.length}`
      : "0/0";
  }

  /* ---------- 清理 ---------- */
  destroy() {
    this.dead = true;
    clearTimeout(this._scrollTimer);
    clearTimeout(this._resizeTimer);
    clearTimeout(this._wheelTimer);
    clearTimeout(this._progTimer);
    if (this._keyHandler) window.removeEventListener("keydown", this._keyHandler);
    if (this._resizeHandler) window.removeEventListener("resize", this._resizeHandler);
    if (this._visHandler) document.removeEventListener("visibilitychange", this._visHandler);
    if (this._wheelHandler && this._els && this._els.scroll) {
      this._els.scroll.removeEventListener("wheel", this._wheelHandler);
    }
    for (const t of this.destroyTimers.values()) clearTimeout(t);
    this.destroyTimers.clear();
    if (this.io) this.io.disconnect();
    if (this.pdf) this.pdf.destroy();
  }
}
