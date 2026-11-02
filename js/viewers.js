/* viewers.js — Atelier Study：Markdown / DOCX / 代码 / 图片 / ZIP / 未知格式阅读器 */
import { toast, esc, relTime } from "./app.js";
import { formatFor } from "./formats.js";

function svgIco(sym, cls = "") {
  return `<svg class="ico ${cls}" aria-hidden="true"><use href="#${sym}"/></svg>`;
}

async function fetchText(path) {
  const r = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
  if (!r.ok) throw new Error(`读取失败（HTTP ${r.status}）`);
  return r.text();
}

/* ---------------- Markdown ---------------- */
export class MdViewer {
  async mount(container, node) {
    const md = await fetchText(node.rel);
    container.innerHTML = `
      <div class="doc-wrap">
        <div class="md-view md-body"></div>
      </div>`;
    const view = container.querySelector(".md-view");
    view.innerHTML = window.marked ? window.marked.parse(md) : `<pre class="md-fallback">${esc(md)}</pre>`;

    // KaTeX 数学公式
    if (window.renderMathInElement) {
      renderMathInElement(view, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true },
        ],
        throwOnError: false,
        errorColor: "#c0392b",
      });
    }

    // Prism 代码高亮
    if (window.Prism) {
      view.querySelectorAll("pre code").forEach(el => {
        const cls = [...el.classList].find(c => c.startsWith("language-"));
        if (cls && window.Prism.languages[cls.slice(9)]) Prism.highlightElement(el);
        else el.classList.add("language-none");
      });
    }

    // 生成目录（h1-h3）
    this._buildToc(container, view, node);

    // 阅读位置记忆
    const wrap = container.closest("#main") || container;
    const saved = (window.G?.state?.progress || {})[node.rel];
    if (saved && saved.scroll != null) {
      requestAnimationFrame(() => {
        wrap.scrollTop = saved.scroll * Math.max(0, wrap.scrollHeight - wrap.clientHeight);
      });
    }
    let t = null;
    const onScroll = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const frac = wrap.scrollTop / Math.max(1, wrap.scrollHeight - wrap.clientHeight);
        if (window.G?.state) {
          G.state.progress[node.rel] = { ...(G.state.progress[node.rel] || {}), scroll: frac, ts: Date.now() };
          import("./app.js").then(m => m.saveState(G.state)).catch(() => {});
        }
      }, 600);
    };
    wrap.addEventListener("scroll", onScroll, { passive: true });
    this._cleanup = () => { clearTimeout(t); wrap.removeEventListener("scroll", onScroll); };
    return this._cleanup;
  }

  _buildToc(container, view, node) {
    const heads = [...view.querySelectorAll("h1, h2, h3")];
    if (!heads.length) return;
    heads.forEach((h, i) => h.id = h.id || `md-h-${i}`);
    // 目录按钮 + 下拉（仅在有标题时出现）
    const aside = document.createElement("aside");
    aside.className = "md-toc";
    aside.innerHTML = `
      <button type="button" class="md-toc-btn">${svgIco("i-list")}目录（${heads.length}）</button>
      <div class="md-toc-pop" hidden>
        <div class="toc-title">${esc(node.name)}</div>
        ${heads.map(h => `<a class="toc-item toc-${h.tagName.toLowerCase()}" href="#${h.id}">${esc(h.textContent)}</a>`).join("")}
      </div>`;
    const pop = aside.querySelector(".md-toc-pop");
    aside.querySelector(".md-toc-btn").addEventListener("click", () => { pop.hidden = !pop.hidden; });
    pop.addEventListener("click", e => {
      const a = e.target.closest("a");
      if (!a) return;
      e.preventDefault();
      pop.hidden = true;
      const target = view.querySelector(`#${CSS.escape(a.getAttribute("href").slice(1))}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    container.querySelector(".doc-wrap").prepend(aside);
  }
}

/* ---------------- DOCX ---------------- */
export class DocxViewer {
  async mount(container, node) {
    container.innerHTML = `<div class="docx-view loading"></div>`;
    const buf = await (await fetch(`/api/file?path=${encodeURIComponent(node.rel)}`)).arrayBuffer();
    const result = await window.mammoth.convertToHtml({ arrayBuffer: buf });
    const view = container.querySelector(".docx-view");
    view.classList.remove("loading");
    view.innerHTML = `
      ${result.messages.length ? `<div class="doc-warn">${svgIco("i-monitor")}转换提示：${result.messages.length} 处样式被简化（Word 排版无法 1:1 还原）</div>` : ""}
      <div class="docx-body">${result.value || "<p>（空文档）</p>"}</div>`;
    if (window.Prism) view.querySelectorAll("pre code").forEach(el => Prism.highlightElement(el));
  }
}

/* ---------------- 代码 / 纯文本 ---------------- */
export class CodeViewer {
  async mount(container, node) {
    const r = await fetch(`/api/text?path=${encodeURIComponent(node.rel)}`);
    const info = await r.json(); // { content, truncated, size, encoding }
    const f = formatFor(node.name);
    const lang = detectCodeLang(node.name) || (f.lang && f.lang !== "none" ? f.lang : null);
    container.innerHTML = `
      <div class="code-wrap">
        ${info.truncated ? `<div class="truncate-banner">${svgIco("i-monitor")}文件共 ${fmtSizeI(info.size)}，仅显示前 200 KB（${info.encoding}）</div>` : ""}
        <pre class="code-view${lang ? "" : " plain"}"><code class="language-${lang || "none"}">${esc(info.content)}</code></pre>
      </div>`;
    if (window.Prism && lang) {
      Prism.highlightElement(container.querySelector("code"));
    }
  }
}

function detectCodeLang(name) {
  const map = {
    js: "javascript", mjs: "javascript", ts: "typescript", py: "python",
    c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", java: "java",
    cs: "csharp", go: "go", rs: "rust", rb: "ruby", php: "php", sh: "bash",
    bat: "batch", ps1: "powershell", sql: "sql", html: "markup", xml: "markup",
    css: "css", json: "json", yaml: "yaml", yml: "yaml", md: "markdown",
    ipynb: "python", m: "matlab", tex: "latex",
  };
  const e = name.split(".").pop().toLowerCase();
  return map[e] || null;
}

function fmtSizeI(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return n + " B";
}

/* ---------------- 图片 ---------------- */
export class ImageViewer {
  async mount(container, node, siblings = []) {
    const gallery = siblings.filter(s => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(s.name));
    container.innerHTML = `
      <div class="img-viewer">
        <div class="img-stage"><img src="/api/file?path=${encodeURIComponent(node.rel)}" alt="${esc(node.name)}" /></div>
        <div class="img-zoombar">
          <button class="tb-icon-btn" data-z="-1" title="缩小">${svgIco("i-minus")}</button>
          <span class="zoom-val">100%</span>
          <button class="tb-icon-btn" data-z="1" title="放大">${svgIco("i-plus")}</button>
          <button class="tb-icon-btn" data-fit title="适应宽度">${svgIco("i-fit")}</button>
          <span class="img-name">${esc(node.name)}</span>
        </div>
        ${gallery.length > 1 ? `
        <div class="img-gallery">
          ${gallery.map(g => `
            <div class="img-thumb${g.rel === node.rel ? " active" : ""}" data-rel="${esc(g.rel)}">
              <img src="/api/file?path=${encodeURIComponent(g.rel)}" alt="${esc(g.name)}" title="${esc(g.name)}" />
            </div>`).join("")}
        </div>` : ""}
      </div>`;

    const img = container.querySelector(".img-stage img");
    const zoomVal = container.querySelector(".zoom-val");
    let scale = 1;

    const setScale = s => {
      scale = Math.min(Math.max(s, 0.1), 6);
      img.style.width = img.naturalWidth * scale + "px";
      zoomVal.textContent = Math.round(scale * 100) + "%";
    };
    img.addEventListener("load", () => setScale(1));
    container.querySelectorAll("[data-z]").forEach(b =>
      b.addEventListener("click", () => setScale(scale * (b.dataset.z === "1" ? 1.25 : 0.8))));
    container.querySelector("[data-fit]").addEventListener("click", () => {
      const stage = container.querySelector(".img-stage");
      setScale(Math.min(1, (stage.clientWidth - 40) / img.naturalWidth));
    });
    // 缩略图切换
    container.querySelectorAll(".img-thumb").forEach(t =>
      t.addEventListener("click", () => {
        const rel = t.dataset.rel;
        location.hash = `#/read?path=${encodeURIComponent(rel)}`;
      }));
  }
}

/* ---------------- ZIP ---------------- */
export class ZipViewer {
  async mount(container, node) {
    container.innerHTML = `<div class="zip-view loading"></div>`;
    const r = await fetch(`/api/zipinfo?path=${encodeURIComponent(node.rel)}`);
    const info = await r.json();
    const view = container.querySelector(".zip-view");
    view.classList.remove("loading");
    // 坏包 / 非标准 zip：服务端返回 error，不崩溃，给出说明
    if (!info || info.error || !Array.isArray(info.entries)) {
      view.innerHTML = `
        <div class="error-card small">
          <h3>${esc(node.name)}</h3>
          <p>${esc((info && (info.error || info.message)) || "无法读取此 ZIP 清单。文件可能已损坏或使用了不支持的压缩方式。")}</p>
          <div class="unknown-actions">
            <button class="btn primary small" data-act="open">使用系统默认程序打开</button>
            <button class="btn ghost small" data-act="reveal">在资源管理器中显示</button>
          </div>
        </div>`;
      view.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", async () => {
        const { openPath, toast } = await import("./app.js");
        const rr = await openPath(node.rel, b.dataset.act === "open" ? "open" : "reveal");
        if (rr && !rr.ok) toast(rr.message || "操作失败");
      }));
      return;
    }
    const rows = info.entries.map(e => `
      <tr class="${e.isDir ? "z-dir" : ""}">
        <td class="z-path">${e.isDir ? svgIco("i-folder") : svgIco("i-page")}${esc(e.name)}</td>
        <td class="num">${e.isDir ? "—" : fmtSizeI(e.size)}</td>
        <td class="num">${e.isDir ? "—" : fmtSizeI(e.packed)}</td>
      </tr>`).join("");
    view.innerHTML = `
      <div class="zip-summary">${svgIco("i-zip")}共 ${info.total} 项${info.truncated ? `（仅列出前 ${info.entries.length} 项）` : ""}</div>
      <table class="zip-table">
        <thead><tr><th>路径</th><th>原始大小</th><th>压缩后</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }
}

/* ---------------- 未知格式 ---------------- */
export class UnknownViewer {
  async mount(container, node) {
    const { formatFor } = await import("./formats.js");
    const f = formatFor(node.name);
    container.innerHTML = `
      <div class="unknown-view">
        <span class="unknown-icon">${svgIco("i-inbox")}</span>
        <h3>${esc(node.name)}</h3>
        <p class="muted">${f.note || "此格式暂不支持在阅读器内预览"}（${fmtSizeI(node.size || 0)}）</p>
        <div class="unknown-actions">
          <button class="btn primary" data-act="open">${svgIco("i-external")}使用系统默认程序打开</button>
          <button class="btn ghost" data-act="reveal">${svgIco("i-reveal")}在资源管理器中显示</button>
        </div>
      </div>`;
    container.querySelectorAll("[data-act]").forEach(b =>
      b.addEventListener("click", async () => {
        const { openPath } = await import("./app.js");
        openPath(node.rel, b.dataset.act).catch(err => toast(err.message));
      }));
  }
}

/* 工厂 —— 以 formats.js 为唯一事实来源（支持无扩展名的 Makefile / Dockerfile 等） */
export function createViewerFor(node) {
  const f = formatFor(node.name);
  switch (f.view) {
    case "md": return new MdViewer();
    case "docx": return new DocxViewer();
    case "code": return new CodeViewer();
    case "image": return new ImageViewer();
    case "zip": return new ZipViewer();
    default: return new UnknownViewer();
  }
}
