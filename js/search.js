/* search.js — Atelier Study：全文搜索页（大搜索框 + 按课程分组结果 + 索引状态） */
import { G, esc, toast, fetchIndex } from "./app.js";

function svgIco(sym, cls = "") {
  return `<svg class="ico ${cls}" aria-hidden="true"><use href="#${sym}"/></svg>`;
}

export async function renderSearch(main, query) {
  // 同步顶部搜索框显示
  const topInput = document.getElementById("search-input");
  if (topInput && query) topInput.value = query;

  main.className = "search-page";
  let index = null;
  try { index = await fetchIndex(); } catch { /* 显示无索引状态 */ }

  if (!query) {
    renderIndexStatus(main, index);
    return;
  }
  // 扫描件提示文案（含真实文件名）
  const scannedNote = index && Array.isArray(index.scanned) && index.scanned.length
    ? `另有 ${index.scanned.length} 个扫描件（无文字层，未纳入索引）：${index.scanned.join("、")}`
    : "";

  // 命中：请求搜索 API
  let data = null;
  try {
    data = await (await fetch(`/api/search?q=${encodeURIComponent(query)}`)).json();
  } catch (err) {
    main.innerHTML = `<div class="wrap wrap-920 page-fade">
      <div class="error-card"><h3>搜索失败</h3><p>${err.message}</p></div></div>`;
    return;
  }

  // 索引构建中
  if (data.index && data.index.state === "building") {
    main.innerHTML = `
      <div class="wrap wrap-920 page-fade">
        ${searchHero(query)}
        <div class="search-box search-progress">
          <span class="spin-ico"></span>
          正在建立全文索引（${data.index.indexed}/${data.index.total} 个 PDF）…构建完成后自动显示结果。
          <button class="btn ghost small" id="retry-search">刷新</button>
        </div>
      </div>`;
    main.querySelector("#retry-search").addEventListener("click", () => {
      location.hash = `#/search?q=${encodeURIComponent(query)}`;
    });
    return;
  }

  const results = data.results || [];
  const totalHits = data.totalHits || 0;
  const totalFiles = data.totalFiles || results.length;

  // 按课程分组
  const byCourse = new Map();
  for (const r of results) {
    if (!byCourse.has(r.course)) byCourse.set(r.course, []);
    byCourse.get(r.course).push(r);
  }

  const parts = [];
  parts.push(`<div class="wrap wrap-920 page-fade">`);
  parts.push(searchHero(query));

  if (!results.length) {
    parts.push(`
      <div class="search-box search-empty">
        <h3>没有找到包含 “${esc(query)}” 的文字内容</h3>
        <p class="dim">索引只覆盖有文字层的 PDF；扫描件（图片型 PDF）不参与全文搜索。</p>
        ${scannedNote ? `<div class="search-scanned">${esc(scannedNote)}</div>` : ""}
      </div>`);
  } else {
    parts.push(`
      <div class="search-box search-summary">
        <span>找到 <b>${totalFiles}</b> 个文件 · <b>${totalHits}</b> 处命中</span>
        <span class="idx-info">${indexText(index)}</span>
        <span class="t-spacer"></span>
        <button class="btn ghost small" id="rebuild-index">重建索引</button>
      </div>`);
    for (const [course, hits] of byCourse) {
      parts.push(`<div class="search-course">`);
      parts.push(`<div class="search-course-name">${esc(course)}<span class="dim">（${hits.length} 个文件）</span></div>`);
      for (const r of hits) parts.push(resultCard(r, query));
      parts.push(`</div>`);
    }
  }

  // 扫描件提示（真实索引数据）
  if (scannedNote) {
    parts.push(`<div class="search-scanned">${esc(scannedNote)}</div>`);
  }
  parts.push(`</div>`);

  main.innerHTML = parts.join("");
  bindSearchActions(main, index, query);
}

function searchHero(query) {
  return `
    <div class="search-hero">
      <h1>${svgIco("i-search")}全文搜索</h1>
      <form class="search-big" id="big-search-form">
        ${svgIco("i-search")}
        <input id="big-search-input" type="text" placeholder="搜索全部 PDF 的文字内容…" value="${esc(query || "")}" autocomplete="off" />
        <button class="btn primary search-go" type="submit">搜索</button>
      </form>
    </div>`;
}

function renderIndexStatus(main, index) {
  const ready = index && index.state === "ready";
  main.innerHTML = `
    <div class="wrap wrap-920 page-fade">
      ${searchHero("")}
      <div class="search-box search-empty">
        <div class="search-summary">
          <span>在上方输入关键词，按回车搜索全部 PDF 的文字内容。</span>
          <span class="t-spacer"></span>
          <button class="btn ghost small" id="rebuild-index">重建索引</button>
        </div>
        <div class="idx-info">${indexText(index) || "全文索引未建立"}</div>
      </div>
    </div>`;
  bindSearchActions(main, index, "");
}

function indexText(index) {
  if (!index) return "";
  if (index.state === "building") return `索引构建中 ${index.indexed}/${index.total}`;
  if (index.state === "error") return "索引异常，点击查看";
  if (index.state !== "ready") return "全文索引未建立";
  return `${index.total} 个 PDF · ${index.pages} 页 · ${index.durationMs ? Math.round(index.durationMs / 1000) + "s" : ""}`;
}

function resultCard(r, query) {
  const firstHit = (r.hits && r.hits[0]) || {};
  const page = firstHit.page || 1;
  const hitLines = (r.hits || []).slice(0, 5).map(h => `
    <a class="hit-line" href="#/read?path=${encodeURIComponent(r.rel)}&page=${h.page}" title="第 ${h.page} 页">
      <span class="hit-page">第 ${h.page} 页</span>
      <span class="hit-snippet">${highlightSnippet(h.snippet || "", query)}</span>
    </a>`).join("");
  const more = (r.hits || []).length > 5
    ? `<span class="hit-more dim">…另有 ${r.hits.length - 5} 处命中（打开文件后可用页内搜索继续）</span>` : "";
  return `
    <div class="search-hit-card" data-rel="${esc(r.rel)}">
      <div class="hit-file">
        <a class="hit-open" href="#/read?path=${encodeURIComponent(r.rel)}&page=${page}">
          <span class="badge pdf">pdf</span>${esc(r.name)}
        </a>
        <span class="hit-path dim">${esc(r.rel)}</span>
        <span class="hit-count dim">${r.hits.length} 处命中 · 共 ${r.totalPages} 页</span>
      </div>
      <div class="hit-lines">${hitLines}${more}</div>
    </div>`;
}

function highlightSnippet(text, query) {
  if (!query) return esc(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return esc(text);
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return `${esc(before)}<mark>${esc(match)}</mark>${esc(after)}`;
}

function bindSearchActions(main, index, query) {
  // 大搜索框
  const form = main.querySelector("#big-search-form");
  if (form) {
    form.addEventListener("submit", e => {
      e.preventDefault();
      const q = main.querySelector("#big-search-input").value.trim();
      if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
      else location.hash = "#/search";
    });
  }
  // 重建索引
  const rb = main.querySelector("#rebuild-index");
  if (rb) {
    rb.addEventListener("click", async () => {
      rb.disabled = true;
      rb.textContent = "重建中…";
      try {
        const d = await (await fetch("/api/index/rebuild", { method: "POST" })).json();
        toast(d.message || "已开始重建索引");
      } catch (err) {
        toast(err.message);
      }
      setTimeout(() => { rb.disabled = false; rb.textContent = "重建索引"; }, 1500);
    });
  }
  // 结果卡片点击 → 打开 PDF
  main.querySelectorAll(".search-hit-card").forEach(card => {
    card.addEventListener("click", e => {
      const a = e.target.closest("a");
      if (a) return; // 命中行有自己的链接
      const rel = card.dataset.rel;
      const firstPage = (card.querySelector(".hit-line")?.getAttribute("href") || "").match(/page=(\d+)/);
      location.hash = `#/read?path=${encodeURIComponent(rel)}${firstPage ? `&page=${firstPage[1]}` : ""}`;
    });
  });
}
