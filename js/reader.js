/* reader.js — Atelier Study：PDF 阅读器（懒渲染、文字层、页内搜索、缩放、大纲侧栏） */
import * as pdfjsLib from "/vendor/pdfjs/pdf.min.mjs";
import { G, setProgress, getProgress, toast, setTitle, fmtSize, findNode } from "./app.js";
import { createViewerFor } from "./viewers.js";
import { onPaneScroll } from "./assignment.js";

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

export async function renderReader(main, node, initialPage) {
  if (node.type === "dir") throw new Error("不能直接打开目录");

  /* --- 非 PDF：统一文档阅读器（Markdown / DOCX / 代码 / 图片 / ZIP / 未知） --- */
  if (!/\.pdf$/i.test(node.name)) {
    main.className = "doc-page";
    main.innerHTML = `
      <div class="doc-toolbar">
        <button class="btn ghost d-back" id="d-back">${svgIco("i-arrow-left")}<span>返回</span></button>
        <span class="t-sep"></span>
        <span class="rt-meta"><span class="t-title">${node.name}</span><span class="t-course">课程资料 · 阅读器</span></span>
        <span class="d-tag">${node.ext || "FILE"}</span>
        <span class="t-spacer"></span>
        <button class="btn ghost d-reveal" id="d-reveal">${svgIco("i-reveal")}<span>目录</span></button>
        <button class="btn ghost d-sysopen" id="d-sysopen">${svgIco("i-external")}<span>系统</span></button>
      </div>
      <div class="doc-body"><div class="doc-loading loading"></div></div>`;
    main.querySelector("#d-back").addEventListener("click", () => history.back());
    main.querySelector("#d-reveal").addEventListener("click", () => openPathFallback(node.rel, "reveal"));
    main.querySelector("#d-sysopen").addEventListener("click", () => openPathFallback(node.rel, "open"));
    setTitle(node.name);
    try {
      const viewer = createViewerFor(node);
      const container = main.querySelector(".doc-body");
      // 同目录文件列表（树节点无 parent 指针，从 G.tree 反查父目录）
      const dirRel = node.rel.includes("/") ? node.rel.slice(0, node.rel.lastIndexOf("/")) : "";
      const dirNode = dirRel ? findNode(dirRel) : null;
      const siblings = dirNode ? dirNode.children.filter(c => c.type === "file") : [];
      await viewer.mount(container, node, siblings);
    } catch (err) {
      console.error(err);
      main.querySelector(".doc-body").innerHTML = `
        <div class="error-card"><h3>无法打开此文件</h3><p>${err.message}</p>
        <button class="btn primary" id="err-sysopen">${svgIco("i-external")}使用系统程序打开</button></div>`;
      main.querySelector("#err-sysopen").addEventListener("click", () => openPathFallback(node.rel, "open"));
    }
    return () => { /* viewer cleanup 由各自 mount 返回值挂在 container 上 */ };
  }

  /* --- PDF --- */
  main.className = "reader";
  main.innerHTML = `<div class="reader-root"><div class="reader-body"><div class="pdf-scroll" id="pdf-scroll"><div class="pdf-pages" id="pdf-pages"></div></div></div></div>`;
  const holder = main.querySelector(".reader-root");
  const viewer = new PdfViewer(holder, node, initialPage, "full");
  await viewer.load().catch(err => {
    console.error(err);
    holder.innerHTML = `
      <div class="error-card"><h3>PDF 加载失败</h3><p>${err.message}</p>
      <button class="btn primary" id="err-sysopen">${svgIco("i-external")}使用系统程序打开</button></div>`;
    holder.querySelector("#err-sysopen").addEventListener("click", () => openPathFallback(node.rel, "open"));
  });
  return () => viewer.destroy();
}

async function openPathFallback(rel, mode) {
  const { openPath } = await import("./app.js");
  openPath(rel, mode).catch(err => toast(err.message));
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
          <button class="tb-icon-btn r-zoom-out" id="r-zoom-out" title="缩小（Ctrl-）">${svgIco("i-minus")}</button>
          <span class="t-info r-zoom-label" id="r-zoom-label">100%</span>
          <button class="tb-icon-btn r-zoom-in" id="r-zoom-in" title="放大（Ctrl+）">${svgIco("i-plus")}</button>
          <button class="btn ghost small r-fit" title="适应宽度">${svgIco("i-fit")}<span>适宽</span></button>
        </div>
        <div class="rt-zone rt-right">
          <div class="reader-searchbar" role="search">
            ${svgIco("i-search")}
            <input class="r-search" type="search" placeholder="页内搜索…" aria-label="页内搜索" />
            <span class="t-info r-search-info">0/0</span>
            <button class="tb-icon-btn r-search-prev" title="上一个命中">${svgIco("i-chev-up")}</button>
            <button class="tb-icon-btn r-search-next" title="下一个命中">${svgIco("i-chev-down")}</button>
          </div>
          <button class="tb-icon-btn r-outline" title="目录 / 大纲">${svgIco("i-list")}</button>
          <button class="tb-icon-btn r-reveal" title="在资源管理器中显示">${svgIco("i-reveal")}</button>
          <button class="tb-icon-btn r-sysopen" title="使用系统程序打开">${svgIco("i-external")}</button>
        </div>`;

      this.body = this.root.querySelector(".reader-body");
      this.root.prepend(this.chrome); // .reader-root 是纵向 flex：工具栏在上，body 在下

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
        <button class="tb-icon-btn sm r-next" title="下一页">${svgIco("i-chev-left")}</button>
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

  /* ---------- 加载 ---------- */
  async load() {
    this._buildChrome();
    const loadingTask = pdfjsLib.getDocument({
      url: `/api/file?path=${encodeURIComponent(this.node.rel)}`,
      ...PDFJS_OPTS,
    });
    this.pdf = await loadingTask.promise;

    // 预取所有页面对象（轻量，不渲染）
    this.pageObjs = new Array(this.pdf.numPages + 1);
    const jobs = [];
    for (let i = 1; i <= this.pdf.numPages; i++) {
      jobs.push(this.pdf.getPage(i).then(p => { this.pageObjs[i] = p; }));
    }
    await Promise.all(jobs);

    this.baseViewport = this.pageObjs[1].getViewport({ scale: 1 });
    this.fitScale = this._computeFit();
    this.scale = this.fitScale;
    this.atFit = true;

    if (this.mode === "full") {
      // 恢复阅读进度
      const prog = getProgress(this.node.rel);
      let start = this.initialPage;
      if (!start && prog && prog.page) start = prog.page;
      this.currentPage = Math.min(Math.max(start || 1, 1), this.pdf.numPages);
      setProgress(this.node.rel, { page: this.currentPage, total: this.pdf.numPages });
      if (this.initialPage !== this.currentPage) {
        history.replaceState(null, "",
          `#/read?path=${encodeURIComponent(this.node.rel)}&page=${this.currentPage}`);
      }
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
  }

  _computeFit() {
    const w = this._els.scroll.clientWidth - 36;
    return w > 100 ? w / this.baseViewport.width : 1;
  }

  _buildDom() {
    const pages = this._els.pages;
    pages.innerHTML = "";
    this._els.total.textContent = `/ ${this.pdf.numPages}`;
    this._els.page.max = this.pdf.numPages;
    this._els.page.value = this.currentPage;

    const frag = document.createDocumentFragment();
    for (let i = 1; i <= this.pdf.numPages; i++) {
      const vp = this.pageObjs[i].getViewport({ scale: 1 });
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
    this.io = new IntersectionObserver(entries => {
      for (const en of entries) {
        const n = +en.target.dataset.page;
        if (en.isIntersecting) {
          clearTimeout(this.destroyTimers.get(n));
          this.destroyTimers.delete(n);
          this._renderPage(n);
        } else if (this.rendered.has(n)) {
          const t = setTimeout(() => this._destroyPage(n), 4000);
          this.destroyTimers.set(n, t);
        }
      }
    }, { root: this._els.scroll, rootMargin: "120% 0px" });
    this._els.pages.querySelectorAll(".pdf-page").forEach(w => this.io.observe(w));

    // 滚动 → 当前页同步
    this._els.scroll.addEventListener("scroll", () => {
      if (this._syncing) return;
      if (this.onPaneScroll) this.onPaneScroll(this);
      clearTimeout(this._scrollTimer);
      this._scrollTimer = setTimeout(() => {
        this.currentPage = this._currentPageFromScroll();
        this._els.page.value = this.currentPage;
        if (this.mode === "full") {
          setProgress(this.node.rel, { page: this.currentPage, total: this.pdf.numPages });
          history.replaceState(null, "",
            `#/read?path=${encodeURIComponent(this.node.rel)}&page=${this.currentPage}`);
        }
      }, 250);
    }, { passive: true });
  }

  /* ---------- 页面渲染 ---------- */
  async _renderPage(n) {
    if (this.dead || this.rendered.has(n) || this.building.has(n)) return;
    this.building.add(n);
    try {
      const pageObj = this.pageObjs[n];
      const vp = pageObj.getViewport({ scale: this.scale });
      const wrap = this._els.pages.querySelector(`.pdf-page[data-page="${n}"]`);
      if (!wrap || this.dead) return;

      // resize wrapper to current scale
      wrap.style.width = Math.round(vp.width) + "px";
      wrap.style.height = Math.round(vp.height) + "px";

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
  _setScale(s) {
    s = Math.min(Math.max(s, 0.1), 6);
    if (Math.abs(s - this.scale) < 0.001) return;
    this.scale = s;
    this.atFit = false;
    this._rerenderAll();
  }

  _rerenderAll() {
    const cur = this.currentPage;
    for (const [n] of this.rendered) this._destroyPage(n);
    this._els.pages.querySelectorAll(".pdf-page").forEach(w => {
      const vp = this.pageObjs[+w.dataset.page].getViewport({ scale: this.scale });
      w.style.width = Math.round(vp.width) + "px";
      w.style.height = Math.round(vp.height) + "px";
    });
    this._scrollToPage(cur, "instant");
    // IO 只在交叉状态变化时触发；销毁后必须显式重渲染当前页
    this._renderPage(cur);
    this._updateZoomLabel();
  }

  _updateZoomLabel() {
    this._els.zoomLabel.textContent = Math.round(this.scale * 100) + "%";
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
      this.side.querySelector(".rs-close").addEventListener("click", () => this._toggleOutline(false));
    }
    q(".r-prev").addEventListener("click", () => this._jump(this.currentPage - 1));
    q(".r-next").addEventListener("click", () => this._jump(this.currentPage + 1));
    this._els.page.addEventListener("keydown", e => {
      if (e.key === "Enter") { this._jump(+this._els.page.value || 1); this._els.page.blur(); }
    });
    q(".r-zoom-out").addEventListener("click", () => this._setScale(this.scale / 1.15));
    q(".r-zoom-in").addEventListener("click", () => this._setScale(this.scale * 1.15));
    q(".r-fit").addEventListener("click", () => {
      this.fitScale = this._computeFit();
      this.scale = this.fitScale;
      this.atFit = true;
      this._rerenderAll();
    });

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
    this._scrollToPage(n);
    if (this.mode === "full") {
      setProgress(this.node.rel, { page: n, total: this.pdf.numPages });
      history.replaceState(null, "",
        `#/read?path=${encodeURIComponent(this.node.rel)}&page=${n}`);
    }
  }

  /* ---------- 键盘（仅 full 模式） ---------- */
  _bindKeys() {
    this._keyHandler = e => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.altKey && e.key === "ArrowLeft") { history.back(); return; }
      if (e.ctrlKey || e.metaKey) return;
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
    if (this._keyHandler) window.removeEventListener("keydown", this._keyHandler);
    if (this._resizeHandler) window.removeEventListener("resize", this._resizeHandler);
    for (const t of this.destroyTimers.values()) clearTimeout(t);
    this.destroyTimers.clear();
    if (this.io) this.io.disconnect();
    if (this.pdf) this.pdf.destroy();
  }
}
