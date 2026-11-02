/* exams.js — 考试计划页（功能集成自本机 exam_planning 项目，原项目零改动）
   页面结构：页头操作区 / 下一场考试倒计时 + 进度 / 月历 + 全部考试 / 弹窗 */
import { api, toast, esc, setCrumb, setTitle } from "./app.js";
import {
  formatCountdown, formatDate, toLocalInputValue, examPhase, findHeroExam,
  urgencyTier, urgencyText, buildMonthGrid, normalizeStoredExam, serializeExam,
  validateExamData, summarize, pad2, parseExamTime,
} from "./exams-core.js";

const ico = (s, c = "") => `<svg class="ico ${c}" aria-hidden="true"><use href="#${s}"/></svg>`;

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const CAL_HEAD = ["一", "二", "三", "四", "五", "六", "日"];
const PHASE_TEXT = { upcoming: "待考试", ongoing: "进行中", finished: "已结束" };

const S = {
  exams: [],
  status: "loading",     // loading | ok | empty | corrupt | error
  detail: "",
  file: "",
  calY: 0,
  calM: 0,
  timer: null,
  heroSig: "",
  modal: null,
  keydown: null,
};

/* ==================== 小工具 ==================== */

const num = (v) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "0");
const creditText = (v) => (v ? `${num(v)} 学分` : "—");
const pad = (n) => String(n).padStart(2, "0");

function hm(ts) {
  const d = new Date(ts);
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function dayLabel(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function untilText(exam, now) {
  const phase = examPhase(exam, now);
  if (phase === "finished") return "已结束";
  if (phase === "ongoing") {
    const left = Math.max(0, exam.examTime + exam.duration * 60000 - now);
    return "进行中 · 还剩 " + Math.max(1, Math.round(left / 60000)) + " 分钟";
  }
  const diff = exam.examTime - now;
  const cd = formatCountdown(diff);
  if (cd.d === 0) return cd.h === 0 ? `${cd.m} 分钟后` : `${cd.h} 小时 ${cd.m} 分钟后`;
  return `${cd.d} 天 ${cd.h} 小时后`;
}

function urgencyLine(exam, phase, now) {
  if (phase === "ongoing") return "考试进行中 · 保持专注";
  return urgencyText(urgencyTier(exam.examTime - now), exam.examTime - now);
}

function chipClass(exam, now) {
  const phase = examPhase(exam, now);
  if (phase === "finished") return "chip-finished";
  if (phase === "ongoing") return "chip-ongoing";
  return urgencyTier(exam.examTime - now) === "red" ? "chip-urgent" : "chip-upcoming";
}

/* ==================== 页面骨架 ==================== */

const HEAD_TEMPLATE = `
  <header class="page-head ex-head">
    <div class="page-head-text">
      <h1 class="page-title">考试计划</h1>
      <p class="page-sub" id="ex-sub">考试时间、倒计时与复习重点</p>
    </div>
    <div class="ex-actions" id="ex-actions">
      <button class="btn primary small" id="ex-add">${ico("i-plus")}<span>新增考试</span></button>
      <button class="btn ghost small" id="ex-import">${ico("i-upload")}<span>导入</span></button>
      <button class="btn ghost small" id="ex-export">${ico("i-download")}<span>导出</span></button>
      <button class="btn ghost small" id="ex-sample">${ico("i-spark")}<span>示例</span></button>
      <button class="btn ghost small" id="ex-datadir">${ico("i-folder")}<span>数据目录</span></button>
      <button class="btn ghost small danger" id="ex-clear">${ico("i-trash")}<span>清除</span></button>
    </div>
  </header>`;

/* ==================== 各区块渲染 ==================== */

function emptyCard() {
  return `
  <section class="ex-card ex-empty">
    <div class="empty-state">
      <span class="es-ico">${ico("i-calendar")}</span>
      <h3>还没有考试安排</h3>
      <p>把考试时间录进来，Atelier 会帮你盯着倒计时、自动排进月历，并按学分统计复习进度。</p>
    </div>
    <div class="ex-empty-actions">
      <button class="btn primary" id="ex-empty-add">${ico("i-plus")}新增考试</button>
      <button class="btn ghost" id="ex-empty-sample">${ico("i-spark")}加载示例数据</button>
      <button class="btn ghost" id="ex-empty-import">${ico("i-upload")}导入 JSON</button>
    </div>
    <p class="ex-empty-path">数据文件：<code id="ex-path" title="考试数据 JSON 路径">data\\exams.json</code></p>
  </section>`;
}

function corruptCard() {
  return `
  <section class="ex-card ex-corrupt">
    <div class="error-card small">
      <h3>考试数据文件损坏</h3>
      <p>${esc(S.detail || "exams.json 无法解析，可能是手动编辑时格式出错。")}</p>
      <div class="ex-corrupt-actions">
        <button class="btn primary" id="ex-retry">${ico("i-refresh")}重新读取</button>
        <button class="btn ghost" id="ex-empty-import">${ico("i-upload")}导入文件覆盖</button>
        <button class="btn ghost" id="ex-datadir">${ico("i-folder")}打开数据目录</button>
      </div>
    </div>
  </section>`;
}

function heroHtml(now) {
  const hero = findHeroExam(S.exams, now);
  if (!hero) {
    const allDone = S.exams.length > 0;
    return `
    <div class="eh-done">
      <span class="eh-ico">${ico("i-check")}</span>
      <h2>${allDone ? "全部考试已完成" : "还没有考试安排"}</h2>
      <p>${allDone
        ? `共 ${S.exams.length} 场考试都已结束，可以开始添加下一轮了。`
        : "添加第一场考试，开始安排复习节奏。"}</p>
      <button class="btn primary small" id="ex-hero-add">${ico("i-plus")}新增考试</button>
    </div>`;
  }
  const phase = examPhase(hero, now);
  const target = phase === "ongoing" ? hero.examTime + hero.duration * 60000 : hero.examTime;
  const cd = formatCountdown(Math.max(0, target - now));
  const tier = phase === "ongoing" ? "ongoing" : urgencyTier(hero.examTime - now);
  return `
    <div class="ex-hero-top">
      <span class="ex-eyebrow">${phase === "ongoing" ? "正在考试" : "下一场考试"}</span>
      <span class="ex-badge ${phase}">${PHASE_TEXT[phase]}</span>
    </div>
    <h2 class="ex-hero-title">${esc(hero.subject)}</h2>
    <div class="ex-cd" id="ex-cd">
      <div class="cd-cell"><b data-cd="d">${cd.d}</b><span>天</span></div>
      <div class="cd-cell"><b data-cd="h">${pad(cd.h)}</b><span>小时</span></div>
      <div class="cd-cell"><b data-cd="m">${pad(cd.m)}</b><span>分</span></div>
      <div class="cd-cell"><b data-cd="s">${pad(cd.s)}</b><span>秒</span></div>
    </div>
    <div class="ex-hero-meta">
      <span>${ico("i-calendar")}${formatDate(hero.examTime)}</span>
      <span>${ico("i-clock")}${hero.duration} 分钟</span>
      <span>${ico("i-award")}${creditText(hero.credit)}</span>
    </div>
    ${hero.focus ? `<div class="ex-focus"><span class="exf-label">学习重点</span><p class="exf-text">${esc(hero.focus)}</p></div>` : ""}
    <p class="ex-urgency tier-${tier}" id="ex-urgency">${esc(urgencyLine(hero, phase, now))}</p>`;
}

function progressHtml(now) {
  const st = summarize(S.exams, now);
  return `
    <div class="ex-card-head">
      <h2>${ico("i-chart")}考试进度</h2>
      <span class="ex-pct">${st.pct}%</span>
    </div>
    <div class="ex-bar"><i style="width:${st.pct}%"></i></div>
    <p class="ex-prog-text">已完成 ${st.finished} / ${st.total} 场${st.ongoing ? ` · ${st.ongoing} 场进行中` : ""}</p>
    <div class="ex-stats">
      <div class="ex-stat"><b>${st.total}</b><span>总考试</span></div>
      <div class="ex-stat"><b>${st.finished}</b><span>已完成</span></div>
      <div class="ex-stat"><b>${st.pending}</b><span>待考试</span></div>
    </div>
    <div class="ex-credits">
      <div><span>总学分</span><b>${num(st.creditTotal)}</b></div>
      <div><span>已完成</span><b class="ok">${num(st.creditDone)}</b></div>
      <div><span>剩余</span><b>${num(st.creditLeft)}</b></div>
    </div>`;
}

function calInfoText(now) {
  const cells = buildMonthGrid(S.calY, S.calM, S.exams, now);
  const count = cells.filter((c) => c.inMonth).reduce((a, c) => a + c.exams.length, 0);
  if (count > 0) return `本月 ${count} 场考试`;
  const next = findHeroExam(S.exams, now);
  if (next) return `本月暂无考试 · 下一场 ${dayLabel(next.examTime)}`;
  return "本月暂无考试";
}

function calCellHtml(cell, now) {
  const cls = ["cal-cell"];
  if (!cell.inMonth) cls.push("is-other");
  if (cell.isToday) cls.push("is-today");
  if (!cell.exams.length) {
    return `<div class="${cls.join(" ")}"><span class="cal-num">${cell.day}</span></div>`;
  }
  const rep = cell.exams.find((e) => examPhase(e, now) !== "finished") || cell.exams[cell.exams.length - 1];
  const more = cell.exams.length > 1 ? `<span class="cal-more">+${cell.exams.length - 1}</span>` : "";
  const summary = cell.exams.map((e) => `${e.subject} ${hm(e.examTime)}`).join("；");
  const title = `${cell.day} 日 · ${cell.exams.length} 场考试：${summary}`;
  return `<button type="button" class="${cls.join(" ")} has-exam" data-day="${cell.ts}" title="${esc(title)}" aria-label="${esc(title)}">
      <span class="cal-num">${cell.day}</span>
      <span class="cal-chip ${chipClass(rep, now)}">${esc(rep.subject)}</span>${more}
    </button>`;
}

function calHtml(now) {
  const cells = buildMonthGrid(S.calY, S.calM, S.exams, now);
  return `
    <div class="ex-card-head">
      <h2>${ico("i-calendar")}考试日历</h2>
      <div class="cal-nav">
        <button class="icon-btn" id="cal-prev" type="button" title="上一月（←）">${ico("i-chev-left")}</button>
        <span class="cal-month" id="cal-month">${S.calY} 年 ${S.calM + 1} 月</span>
        <button class="icon-btn" id="cal-next" type="button" title="下一月（→）">${ico("i-chev-right")}</button>
        <button class="btn small ghost" id="cal-today" type="button" title="回到本月（T）">今天</button>
      </div>
    </div>
    <div class="cal-week">${CAL_HEAD.map((d) => `<span>${d}</span>`).join("")}</div>
    <div class="cal-grid" id="cal-grid">${cells.map((c) => calCellHtml(c, now)).join("")}</div>
    <div class="cal-foot">
      <div class="cal-legend">
        <span class="cal-lg"><i class="chip-upcoming"></i>待考试</span>
        <span class="cal-lg"><i class="chip-urgent"></i>3 天内</span>
        <span class="cal-lg"><i class="chip-ongoing"></i>进行中</span>
        <span class="cal-lg"><i class="chip-finished"></i>已结束</span>
      </div>
      <span class="cal-info" id="cal-info">${esc(calInfoText(now))}</span>
    </div>
    <p class="cal-hint">← → 切换月份 · T 今天 · N 新增</p>`;
}

function rowHtml(exam, now) {
  const d = new Date(exam.examTime);
  const phase = examPhase(exam, now);
  const end = exam.examTime + exam.duration * 60000;
  return `
    <article class="ex-row ${phase}" data-id="${esc(exam.id)}">
      <div class="exr-date">
        <b>${pad(d.getMonth() + 1)}/${pad(d.getDate())}</b>
        <span>${WEEK[d.getDay()]}</span>
      </div>
      <div class="exr-main">
        <div class="exr-title">${esc(exam.subject)}<span class="ex-badge ${phase}">${PHASE_TEXT[phase]}</span></div>
        <div class="exr-meta">${hm(exam.examTime)}–${hm(end)} · ${exam.duration} 分钟 · ${creditText(exam.credit)}</div>
        ${exam.focus ? `<div class="exr-focus" title="${esc(exam.focus)}">${esc(exam.focus)}</div>` : ""}
      </div>
      <div class="exr-side">
        <span class="exr-until">${esc(untilText(exam, now))}</span>
        <div class="exr-actions">
          <button class="icon-btn" type="button" data-act="edit" title="编辑">${ico("i-edit")}</button>
          <button class="icon-btn" type="button" data-act="del" title="删除">${ico("i-trash")}</button>
        </div>
      </div>
    </article>`;
}

function agendaHtml(now) {
  const list = S.exams.slice().sort((a, b) => a.examTime - b.examTime);
  const body = list.length
    ? `<div class="ex-rows">${list.map((e) => rowHtml(e, now)).join("")}</div>`
    : `<p class="ex-rows-empty">暂无考试安排。</p>`;
  return `
    <div class="ex-card-head">
      <h2>${ico("i-list")}全部考试</h2>
      <span class="exh-note">${list.length} 场 · 按时间排序</span>
    </div>
    ${body}`;
}

/* ==================== 整页绘制 ==================== */

function paint() {
  const root = document.getElementById("ex-body");
  if (!root) return;
  const now = Date.now();
  const sub = document.getElementById("ex-sub");
  const st = summarize(S.exams, now);

  if (S.status === "corrupt") {
    root.innerHTML = corruptCard();
    if (sub) sub.textContent = "数据文件异常，请重新读取或导入覆盖";
    return;
  }
  if (S.status === "error") {
    root.innerHTML = `
      <section class="ex-card">
        <div class="error-card small">
          <h3>读取考试数据失败</h3>
          <p>${esc(S.detail || "无法连接本地服务")}</p>
          <button class="btn primary" id="ex-retry">${ico("i-refresh")}重试</button>
        </div>
      </section>`;
    return;
  }
  if (!S.exams.length) {
    root.innerHTML = emptyCard();
    const p = document.getElementById("ex-path");
    if (p && S.file) p.title = S.file;
    if (sub) sub.textContent = "考试时间、倒计时与复习重点 · 暂无数据";
    return;
  }

  if (sub) {
    sub.textContent = `${st.total} 场考试 · 已完成 ${st.finished} 场 · 待考 ${st.pending} 场 · 总学分 ${num(st.creditTotal)}`;
  }
  root.innerHTML = `
    <div class="ex-grid">
      <section class="ex-card ex-hero" id="ex-hero">${heroHtml(now)}</section>
      <section class="ex-card ex-prog" id="ex-prog">${progressHtml(now)}</section>
    </div>
    <div class="ex-grid ex-grid-2">
      <section class="ex-card ex-cal" id="ex-cal">${calHtml(now)}</section>
      <section class="ex-card ex-agenda" id="ex-agenda">${agendaHtml(now)}</section>
    </div>`;
  S.heroSig = heroSignature(now);
}

function heroSignature(now) {
  const hero = findHeroExam(S.exams, now);
  return hero ? hero.id + ":" + examPhase(hero, now) : "none";
}

function repaintHero(now) {
  const el = document.getElementById("ex-hero");
  if (el) el.innerHTML = heroHtml(now);
}

function repaintProgress(now) {
  const el = document.getElementById("ex-prog");
  if (el) el.innerHTML = progressHtml(now);
}

function repaintCalendar(now) {
  const el = document.getElementById("ex-cal");
  if (el) el.innerHTML = calHtml(now);
}

function updateCdBox(box, cd) {
  const map = { d: String(cd.d), h: pad(cd.h), m: pad(cd.m), s: pad(cd.s) };
  for (const [key, val] of Object.entries(map)) {
    const b = box.querySelector(`[data-cd="${key}"]`);
    if (!b || b.textContent === val) continue;
    b.textContent = val;
    b.classList.remove("bump");
    void b.offsetWidth;          // 重置动画
    b.classList.add("bump");
  }
}

/* ==================== 每秒刷新 ==================== */

function tick() {
  if (S.status !== "ok" || !S.exams.length) return;
  const now = Date.now();
  const hero = findHeroExam(S.exams, now);
  const sig = heroSignature(now);
  if (sig !== S.heroSig) {
    S.heroSig = sig;
    repaintHero(now);
    repaintProgress(now);
    repaintCalendar(now);
    return;
  }
  if (!hero) return;
  const phase = examPhase(hero, now);
  const target = phase === "ongoing" ? hero.examTime + hero.duration * 60000 : hero.examTime;
  const box = document.getElementById("ex-cd");
  if (box) updateCdBox(box, formatCountdown(Math.max(0, target - now)));
  const u = document.getElementById("ex-urgency");
  if (u) {
    u.textContent = urgencyLine(hero, phase, now);
    u.className = "ex-urgency tier-" + (phase === "ongoing" ? "ongoing" : urgencyTier(hero.examTime - now));
  }
}

function startTimer() {
  stopTimer();
  S.timer = setInterval(tick, 1000);
}

function stopTimer() {
  if (S.timer) {
    clearInterval(S.timer);
    S.timer = null;
  }
}

/* ==================== 数据读写 ==================== */

async function load() {
  try {
    const r = await api("/api/exams");
    S.file = r.file || "";
    if (r.success === false) {
      S.status = "corrupt";
      S.detail = r.detail || r.message || "";
      S.exams = [];
      return;
    }
    S.exams = (r.data || []).map(normalizeStoredExam).filter(Boolean);
    S.status = S.exams.length ? "ok" : "empty";
  } catch (e) {
    S.status = "error";
    S.detail = e.message;
  }
}

async function reload() {
  await load();
  paint();
  updateExamBadge(S.exams);
}

async function persist(list, okMsg) {
  const r = await api("/api/exams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exams: list.map(serializeExam) }),
  });
  if (!r.success) throw new Error(r.message || "保存失败");
  S.exams = (r.data || []).map(normalizeStoredExam).filter(Boolean);
  S.status = S.exams.length ? "ok" : "empty";
  paint();
  updateExamBadge(S.exams);
  toast(okMsg || r.message || "已保存");
}

/* ==================== 弹窗 ==================== */

function closeModal() {
  if (!S.modal) return;
  S.modal.remove();
  S.modal = null;
}

function openModal({ title, body, foot = "", mount = null, wide = false }) {
  closeModal();
  const back = document.createElement("div");
  back.className = "modal-back";
  back.innerHTML = `
    <div class="modal${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header class="modal-head">
        <h3 id="modal-title">${esc(title)}</h3>
        <button class="icon-btn" type="button" data-close title="关闭">${ico("i-x")}</button>
      </header>
      <div class="modal-body">${body}</div>
      ${foot ? `<footer class="modal-foot">${foot}</footer>` : ""}
    </div>`;
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add("in"));
  back.addEventListener("click", (e) => {
    if (e.target === back) closeModal();
    if (e.target.closest("[data-close]")) closeModal();
  });
  S.modal = back;
  if (mount) mount(back);
  const first = back.querySelector("input, textarea");
  if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 40);
}

function confirmDialog(message, onOk, { title = "请确认", okText = "确定", danger = false } = {}) {
  openModal({
    title,
    body: `<p class="confirm-text">${esc(message)}</p>`,
    foot: `<button class="btn ghost" type="button" data-close>取消</button>
           <button class="btn primary${danger ? " danger" : ""}" type="button" id="cf-ok">${esc(okText)}</button>`,
    mount(back) {
      back.querySelector("#cf-ok").addEventListener("click", async () => {
        const btn = back.querySelector("#cf-ok");
        btn.disabled = true;
        try {
          await onOk();
          closeModal();
        } catch (e) {
          toast(e.message || String(e));
          btn.disabled = false;
        }
      });
    },
  });
}

/* ---------- 当天详情 ---------- */

function openDayModal(ts) {
  const key = new Date(ts).toDateString();
  const now = Date.now();
  const list = S.exams
    .filter((e) => new Date(e.examTime).toDateString() === key)
    .sort((a, b) => a.examTime - b.examTime);
  if (!list.length) return;
  const body = `<div class="day-list">${list.map((e) => {
    const phase = examPhase(e, now);
    const end = e.examTime + e.duration * 60000;
    return `
      <div class="day-item" data-id="${esc(e.id)}">
        <div class="di-top">
          <b>${esc(e.subject)}</b>
          <span class="ex-badge ${phase}">${PHASE_TEXT[phase]}</span>
          <span class="di-credit">${creditText(e.credit)}</span>
        </div>
        <div class="di-meta">${hm(e.examTime)}–${hm(end)} · ${e.duration} 分钟</div>
        ${e.focus ? `<div class="di-focus">学习重点：${esc(e.focus)}</div>` : ""}
        <div class="di-until">${esc(untilText(e, now))}</div>
        <div class="di-actions">
          <button class="btn small ghost" type="button" data-act="edit">${ico("i-edit")}编辑</button>
          <button class="btn small ghost danger" type="button" data-act="del">${ico("i-trash")}删除</button>
        </div>
      </div>`;
  }).join("")}</div>`;

  openModal({
    title: `${dayLabel(ts)} · ${list.length} 场考试`,
    body,
    foot: `<button class="btn ghost" type="button" data-close>关闭</button>
           <button class="btn primary" type="button" id="day-add">${ico("i-plus")}在这天新增考试</button>`,
    mount(back) {
      back.querySelector("#day-add").addEventListener("click", () => openForm(null, ts));
      back.querySelector(".modal-body").addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        const id = btn.closest(".day-item").dataset.id;
        const exam = S.exams.find((x) => x.id === id);
        if (!exam) return;
        if (btn.dataset.act === "edit") openForm(exam);
        else await removeExam(exam);
      });
    },
  });
}

/* ---------- 新增 / 编辑 ---------- */

function openForm(exam, defaultTs) {
  const isEdit = !!exam;
  const now = Date.now();
  let ts = exam ? exam.examTime : (defaultTs || 0);
  if (!ts) {
    const t = new Date(now + 3600 * 1000);
    t.setMinutes(Math.ceil(t.getMinutes() / 15) * 15, 0, 0);
    ts = t.getTime();
  }
  const body = `
    <form id="ex-form" class="ex-form" novalidate>
      <label class="field">
        <span>科目</span>
        <input id="f-subject" type="text" maxlength="60" placeholder="例如：高等数学" autocomplete="off" value="${exam ? esc(exam.subject) : ""}">
      </label>
      <div class="field-row">
        <label class="field grow">
          <span>考试时间</span>
          <input id="f-time" type="datetime-local" value="${toLocalInputValue(ts)}">
        </label>
        <label class="field narrow">
          <span>时长（分钟）</span>
          <input id="f-duration" type="number" min="5" step="5" value="${exam ? exam.duration : 120}">
        </label>
        <label class="field narrow">
          <span>学分</span>
          <input id="f-credit" type="number" min="0" step="0.5" value="${exam ? exam.credit : 3}">
        </label>
      </div>
      <p class="form-hint">学分用于统计复习总量；时长决定「进行中」的判定（默认 120 分钟）。</p>
      <label class="field">
        <span>学习重点</span>
        <textarea id="f-focus" rows="3" maxlength="200" placeholder="复习范围、重点章节…">${exam ? esc(exam.focus) : ""}</textarea>
      </label>
      <p class="form-error" id="f-error" hidden></p>
    </form>`;

  openModal({
    title: isEdit ? "编辑考试" : "新增考试",
    body,
    foot: `<button class="btn ghost" type="button" data-close>取消</button>
           <button class="btn primary" type="button" id="f-save">${ico("i-check")}保存</button>`,
    mount(back) {
      const form = back.querySelector("#ex-form");
      const err = back.querySelector("#f-error");
      const fail = (msg) => {
        err.textContent = msg;
        err.hidden = false;
      };
      const submit = async () => {
        err.hidden = true;
        const subject = back.querySelector("#f-subject").value.trim();
        const timeStr = back.querySelector("#f-time").value;
        const duration = Number(back.querySelector("#f-duration").value);
        const credit = Number(back.querySelector("#f-credit").value);
        const focus = back.querySelector("#f-focus").value.trim();
        if (!subject) return fail("请填写科目名称。");
        if (!timeStr) return fail("请选择考试时间。");
        const parsed = parseExamTime(timeStr);
        if (parsed === null) return fail("考试时间格式不正确。");
        if (!Number.isFinite(duration) || duration <= 0) return fail("时长必须是大于 0 的数字。");
        if (!Number.isFinite(credit) || credit < 0) return fail("学分必须是不小于 0 的数字。");

        const next = {
          id: exam ? exam.id : "exam-" + parsed + "-" + Math.random().toString(36).slice(2, 7),
          subject,
          examTime: parsed,
          credit,
          focus,
          duration: Math.round(duration),
        };
        const list = S.exams.map((e) => (exam && e.id === exam.id ? next : e));
        if (!exam) list.push(next);
        const btn = back.querySelector("#f-save");
        btn.disabled = true;
        try {
          await persist(list, exam ? "已更新考试" : "已新增考试");
          closeModal();
        } catch (e) {
          btn.disabled = false;
          fail(e.message || String(e));
        }
      };
      back.querySelector("#f-save").addEventListener("click", submit);
      form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
      form.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); submit(); }
      });
    },
  });
}

/* ---------- 删除 ---------- */

async function removeExam(exam) {
  confirmDialog(`确定删除「${exam.subject} · ${formatDate(exam.examTime)}」吗？`, async () => {
    await persist(S.exams.filter((e) => e.id !== exam.id), "已删除考试");
  }, { title: "删除考试", okText: "删除", danger: true });
}

/* ---------- 导入 / 导出 / 示例 / 清空 ---------- */

async function importFile(file) {
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch (e) {
    toast("JSON 解析失败：" + e.message);
    return;
  }
  const { ok, exams, errors } = validateExamData(raw);
  if (!ok) {
    openModal({
      title: "导入失败",
      body: `<p class="confirm-text">文件里有 ${errors.length} 处格式问题，未写入任何数据：</p>
        <ul class="err-list">${errors.slice(0, 8).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`,
      foot: `<button class="btn ghost" type="button" data-close>关闭</button>`,
    });
    return;
  }
  if (!exams.length) {
    toast("文件里没有考试数据");
    return;
  }
  if (S.exams.length) {
    confirmDialog(
      `导入会替换现有 ${S.exams.length} 场考试，本次将导入 ${exams.length} 场。`,
      async () => { await persist(exams, `已导入 ${exams.length} 场考试`); },
      { title: "导入考试数据", okText: "替换导入" }
    );
  } else {
    await persist(exams, `已导入 ${exams.length} 场考试`);
  }
}

async function exportFlow() {
  if (!S.exams.length) { toast("还没有考试数据可以导出"); return; }
  const r = await api("/api/exams/export", { method: "POST" });
  if (!r.success) { toast(r.message || "导出失败"); return; }
  openModal({
    title: "已导出",
    body: `<p class="confirm-text">共 ${r.count} 场考试，文件已保存到：</p>
      <p class="path-box">${esc(r.path)}</p>`,
    foot: `<button class="btn ghost" type="button" data-close>关闭</button>
           <button class="btn primary" type="button" id="ex-reveal">${ico("i-reveal")}打开所在文件夹</button>`,
    mount(back) {
      back.querySelector("#ex-reveal").addEventListener("click", async () => {
        try {
          await api("/api/exams/open-dir", { method: "POST" });
        } catch (e) { toast(e.message); }
      });
    },
  });
}

async function sampleFlow() {
  const run = async () => {
    const r = await api("/api/exams/sample", { method: "POST" });
    if (!r.success) throw new Error(r.message || "加载示例失败");
    await reload();
    toast(`已加载 ${r.count} 场示例考试`);
  };
  if (S.exams.length) {
    confirmDialog(`加载示例会替换现有 ${S.exams.length} 场考试。`, run, {
      title: "加载示例数据", okText: "替换",
    });
  } else {
    try { await run(); } catch (e) { toast(e.message); }
  }
}

async function clearFlow() {
  confirmDialog(`确定清除全部 ${S.exams.length} 场考试吗？数据文件会被删除（旧数据仍保留在 .bak 备份中）。`, async () => {
    const r = await api("/api/exams/clear", { method: "POST" });
    if (!r.success) throw new Error(r.message || "清除失败");
    await reload();
    toast("考试数据已清除");
  }, { title: "清除考试数据", okText: "清除", danger: true });
}

/* ==================== 月份切换 ==================== */

function shiftMonth(delta) {
  const d = new Date(S.calY, S.calM + delta, 1);
  S.calY = d.getFullYear();
  S.calM = d.getMonth();
  repaintCalendar(Date.now());
}

function gotoToday() {
  const d = new Date();
  S.calY = d.getFullYear();
  S.calM = d.getMonth();
  repaintCalendar(Date.now());
}

/* ==================== 事件绑定 ==================== */

function bind(root) {
  root.addEventListener("click", async (e) => {
    const t = e.target;
    const hit = (sel) => t.closest(sel);

    if (hit("#ex-add") || hit("#ex-empty-add") || hit("#ex-hero-add")) { openForm(null); return; }
    if (hit("#ex-import") || hit("#ex-empty-import")) { root.querySelector("#ex-file").click(); return; }
    if (hit("#ex-export")) { await exportFlow(); return; }
    if (hit("#ex-sample") || hit("#ex-empty-sample")) { await sampleFlow(); return; }
    if (hit("#ex-clear")) { await clearFlow(); return; }
    if (hit("#ex-datadir")) {
      try { await api("/api/exams/open-dir", { method: "POST" }); }
      catch (err) { toast(err.message); }
      return;
    }
    if (hit("#ex-retry")) { await reload(); return; }

    if (hit("#cal-prev")) { shiftMonth(-1); return; }
    if (hit("#cal-next")) { shiftMonth(1); return; }
    if (hit("#cal-today")) { gotoToday(); return; }

    const cell = hit(".cal-cell.has-exam");
    if (cell) { openDayModal(Number(cell.dataset.day)); return; }

    const actBtn = hit(".ex-row [data-act]");
    if (actBtn) {
      const exam = S.exams.find((x) => x.id === actBtn.closest(".ex-row").dataset.id);
      if (!exam) return;
      if (actBtn.dataset.act === "edit") openForm(exam);
      else await removeExam(exam);
      return;
    }

    const row = hit(".ex-row");
    if (row) {
      const exam = S.exams.find((x) => x.id === row.dataset.id);
      if (exam) openForm(exam);
    }
  });

  const file = root.querySelector("#ex-file");
  file.addEventListener("change", () => {
    const f = file.files && file.files[0];
    file.value = "";
    if (f) importFile(f);
  });

  // 整页拖拽导入
  const dropOn = root;
  dropOn.addEventListener("dragover", (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
    e.preventDefault();
    dropOn.classList.add("dropping");
  });
  dropOn.addEventListener("dragleave", (e) => {
    if (e.target === dropOn) dropOn.classList.remove("dropping");
  });
  dropOn.addEventListener("drop", (e) => {
    dropOn.classList.remove("dropping");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    if (!/\.json$/i.test(f.name)) { toast("请拖入 .json 格式的考试数据文件"); return; }
    importFile(f);
  });
}

function onKey(e) {
  if (S.modal) {
    if (e.key === "Escape") { e.preventDefault(); closeModal(); }
    return;
  }
  const el = document.activeElement;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
  if (e.key === "ArrowLeft") { e.preventDefault(); shiftMonth(-1); }
  else if (e.key === "ArrowRight") { e.preventDefault(); shiftMonth(1); }
  else if (e.key === "t" || e.key === "T") { e.preventDefault(); gotoToday(); }
  else if (e.key === "n" || e.key === "N") { e.preventDefault(); openForm(null); }
}

/* ==================== 侧栏徽标 ==================== */

export function updateExamBadge(exams) {
  const el = document.getElementById("nav-exam-days");
  if (!el) return;
  const apply = (list) => {
    const now = Date.now();
    const next = findHeroExam(list, now);
    if (!next) {
      el.hidden = true;
      el.textContent = "";
      el.removeAttribute("title");
      return;
    }
    const diff = next.examTime - now;
    const phase = examPhase(next, now);
    el.hidden = false;
    el.textContent = phase === "ongoing" ? "考" : diff < 86400000 ? "今天"
      : String(Math.ceil(diff / 86400000));
    el.title = phase === "ongoing"
      ? `正在考试：${next.subject}`
      : `${next.subject} · ${formatDate(next.examTime)}`;
  };
  if (Array.isArray(exams)) { apply(exams); return; }
  api("/api/exams").then((r) => {
    apply((r.data || []).map(normalizeStoredExam).filter(Boolean));
  }).catch(() => { el.hidden = true; });
}

/* ==================== 页面入口 ==================== */

export async function renderExams(main) {
  const d = new Date();
  S.calY = d.getFullYear();
  S.calM = d.getMonth();
  S.status = "loading";
  S.heroSig = "";

  setCrumb([{ label: "书架", href: "#/" }, { label: "考试计划" }]);
  setTitle("考试计划");

  main.className = "exams-page";
  main.innerHTML = `
    <div class="wrap wrap-1180" id="ex-root">
      ${HEAD_TEMPLATE}
      <div id="ex-body"><div class="loading">正在读取考试数据…</div></div>
      <input type="file" id="ex-file" accept=".json,application/json" hidden>
      <p class="ex-foot-note">考试数据保存在项目 <code>data\\exams.json</code>，与资料目录（只读）相互独立。</p>
    </div>`;

  const root = document.getElementById("ex-root");
  bind(root);

  await load();
  paint();
  updateExamBadge(S.exams);
  startTimer();

  S.keydown = (e) => onKey(e);
  document.addEventListener("keydown", S.keydown);

  return () => {
    stopTimer();
    if (S.keydown) document.removeEventListener("keydown", S.keydown);
    S.keydown = null;
    closeModal();
  };
}
