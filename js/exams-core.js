/**
 * 考试计划 · 纯逻辑核心（无 DOM 依赖，可在 Node 里直接单元测试）
 *
 * 集成自本机上的 exam_planning 项目（保持原项目零改动），把其中可测的规则原样搬过来：
 *   - examTime 解析：YYYY-MM-DD[T 或空格]HH:mm[:ss][.ffffff][Z|±HH:mm]
 *   - 三态判定：upcoming / ongoing / finished（「进行中」是真实的 duration 窗口）
 *   - 倒计时格式化、紧迫等级
 *   - 月视图网格（周一为首日，35/42 格）
 *   - 数据规范化、导入校验、序列化
 *   - 学分与进度统计
 */

export const DAY = 24 * 3600 * 1000;

/** JSON 缺省 duration 时的默认考试时长（分钟） */
export const DEFAULT_DURATION = 120;

export function pad2(n) {
  return String(n).padStart(2, "0");
}

/* ==================== 日期与时间 ==================== */

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,6}))?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * 解析 examTime 为毫秒时间戳；非法返回 null。
 * 无时区后缀时按本地时间解释；带 Z / ±HH:mm 时换算为对应时刻。
 */
export function parseExamTime(value) {
  if (typeof value !== "string") return null;
  const m = ISO_RE.exec(value.trim());
  if (!m) return null;

  const year = +m[1], month = +m[2] - 1, day = +m[3];
  const hour = +m[4], minute = +m[5];
  const second = m[6] ? +m[6] : 0;
  const ms = m[7] ? Math.round(Number("0." + m[7]) * 1000) : 0;
  const zone = m[8] || "";

  // 时区偏移范围校验（拒绝 +99:99 这类垃圾值）；+0800 必须按 2+2 位切分
  if (zone && zone !== "Z") {
    const raw = zone.slice(1).replace(":", "");
    if (+raw.slice(0, 2) > 14 || +raw.slice(2, 4) > 59) return null;
  }

  // 手动组装各分量，避免不同浏览器 Date.parse 的差异与历史时区坑
  const d = new Date(0);
  d.setFullYear(year, month, day);
  d.setHours(hour, minute, second, ms);
  // 回读校验：过滤 2026-02-30、25:00 这类会被自动进位的非法值
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day ||
      d.getHours() !== hour || d.getMinutes() !== minute || d.getSeconds() !== second) {
    return null;
  }

  let ts = d.getTime();
  if (zone) {
    let offset = 0;                            // 分钟
    if (zone !== "Z") {
      const sign = zone[0] === "-" ? -1 : 1;
      const raw = zone.slice(1).replace(":", "");
      offset = sign * ((+raw.slice(0, 2)) * 60 + (+raw.slice(2, 4)));
    }
    ts = ts - new Date(ts).getTimezoneOffset() * 60000 - offset * 60000;
  }
  return ts;
}

/** 统一显示格式：YYYY-MM-DD HH:mm（本地时间，手动补零） */
export function formatDate(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

/** 毫秒差 → { d, h, m, s }（负数归零） */
export function formatCountdown(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60
  };
}

/** 列表行用的紧凑倒计时文案：「2 天 5 小时 30 分钟后」 */
export function countdownDisplayText(diffMs) {
  const cd = formatCountdown(diffMs);
  let text = "";
  if (cd.d > 0) text += cd.d + " 天 ";
  if (cd.h > 0 || cd.d > 0) text += cd.h + " 小时 ";
  text += cd.m + " 分钟后";
  return text;
}

/** <input type="datetime-local"> 需要 YYYY-MM-DDTHH:mm（本地时间） */
export function toLocalInputValue(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

/** 保存回 JSON 用：YYYY-MM-DDTHH:mm:ss（本地时间，无时区后缀） */
export function toIsoLocal(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

/* ==================== 考试阶段 ==================== */

/**
 * 三态：
 *   upcoming — 还没开始
 *   ongoing  — 已开始、还没到 examTime + duration
 *   finished — 已结束
 */
export function examPhase(exam, now) {
  if (now < exam.examTime) return "upcoming";
  if (now < exam.examTime + exam.duration * 60000) return "ongoing";
  return "finished";
}

/** Hero 主角：优先进行中的考试（先开始的优先），否则最近一场待考考试 */
export function findHeroExam(exams, now) {
  let ongoing = null;
  let upcoming = null;
  for (let i = 0; i < exams.length; i++) {
    const e = exams[i];
    const phase = examPhase(e, now);
    if (phase === "ongoing") {
      if (ongoing === null || e.examTime < ongoing.examTime) ongoing = e;
    } else if (phase === "upcoming") {
      if (upcoming === null || e.examTime < upcoming.examTime) upcoming = e;
    }
  }
  return ongoing || upcoming || null;
}

/* ==================== 紧迫程度 ==================== */

// <24 小时红 / 1–3 天橙 / 3–7 天蓝 / >7 天绿
export function urgencyTier(ms) {
  if (ms < DAY) return "red";
  if (ms < 3 * DAY) return "orange";
  if (ms <= 7 * DAY) return "blue";
  return "safe";
}

export function urgencyText(tier, ms) {
  if (tier === "red") return "即将考试 · 请做好最后复习";
  return "距离考试还有 " + Math.floor(ms / DAY) + " 天";
}

/* ==================== 日历 ==================== */

/** 本地日期键 YYYY-MM-DD：按天分组用，不受时区换算影响 */
export function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

/** 某一天 00:00 的时间戳（本地时区） */
export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 月视图网格：7 列（周一 → 周日），整周对齐。
 * 末尾若有一整周都不属于本月则裁掉，所以结果恒为 35 或 42 格。
 * 返回 [{ ts, day, inMonth, isToday, exams }]，exams 已按考试时间升序。
 */
export function buildMonthGrid(year, month, exams, now) {
  const base = new Date(year, month, 1);        // 顺带把越界月份归一化
  year = base.getFullYear();
  month = base.getMonth();

  const list = Array.isArray(exams) ? exams : [];
  const byDay = new Map();
  for (let i = 0; i < list.length; i++) {
    const key = dayKey(list[i].examTime);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(list[i]);
    else byDay.set(key, [list[i]]);
  }

  // 周一作为一周的第一天：JS 的 getDay() 周日 = 0，这里换算成 周日 = 6
  const offset = (base.getDay() + 6) % 7;
  const todayKey = dayKey(now === undefined ? Date.now() : now);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - offset + i);
    const key = dayKey(d.getTime());
    const dayExams = (byDay.get(key) || []).slice().sort((a, b) => a.examTime - b.examTime);
    cells.push({
      ts: d.getTime(),
      day: d.getDate(),
      inMonth: d.getMonth() === month && d.getFullYear() === year,
      isToday: key === todayKey,
      exams: dayExams
    });
  }
  // 最后一整周都在本月之外 → 裁掉，避免底部空一行
  if (cells.length === 42 && cells.slice(35).every((c) => !c.inMonth)) cells.length = 35;
  return cells;
}

/* ==================== 数据模型 ==================== */

/** 将单条导入数据规范化为内部结构；关键字段非法时返回 null */
export function normalizeExam(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const examTime = parseExamTime(item.examTime);
  if (examTime === null) return null;
  if (typeof item.subject !== "string" || item.subject.trim() === "") return null;
  const duration = (typeof item.duration === "number" && isFinite(item.duration) && item.duration > 0)
    ? item.duration
    : DEFAULT_DURATION;
  return {
    id: "exam-" + examTime + "-" + index + "-" + Math.random().toString(36).slice(2, 8),
    subject: item.subject.trim(),
    examTime: examTime,
    credit: (typeof item.credit === "number" && isFinite(item.credit)) ? item.credit : 0,
    focus: typeof item.focus === "string" ? item.focus : "",
    duration: duration
  };
}

/** 规范化已存储的数据；宽容策略：非法项丢弃、可修复字段就地修复 */
export function normalizeStoredExam(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  if (typeof item.subject !== "string" || item.subject.trim() === "") return null;
  let examTime = null;
  if (typeof item.examTime === "number" && isFinite(item.examTime)) {
    examTime = item.examTime;                 // 已规范化：毫秒时间戳
  } else if (typeof item.examTime === "string") {
    examTime = parseExamTime(item.examTime);  // 原始 ISO 字符串
  }
  if (examTime === null) return null;
  const duration = (typeof item.duration === "number" && isFinite(item.duration) && item.duration > 0)
    ? item.duration
    : DEFAULT_DURATION;
  return {
    id: (typeof item.id === "string" && item.id)
      ? item.id
      : "exam-" + examTime + "-" + index + "-" + Math.random().toString(36).slice(2, 8),
    subject: item.subject.trim(),
    examTime: examTime,
    credit: (typeof item.credit === "number" && isFinite(item.credit)) ? item.credit : 0,
    focus: typeof item.focus === "string" ? item.focus : "",
    duration: duration
  };
}

/** 内部结构 → 可写入 JSON 的原始结构（编辑/删除后保存时使用） */
export function serializeExam(exam) {
  return {
    id: exam.id,
    subject: exam.subject,
    examTime: toIsoLocal(exam.examTime),
    credit: exam.credit,
    focus: exam.focus,
    duration: exam.duration
  };
}

/** 导入前的本地预校验（与服务端规则一致），返回 { ok, exams, errors }
 *  注：源项目此处未校验顶层类型（传入 {} 会被当成空表格静默通过），
 *  移植时补了一条显式错误，避免「导入对象却提示成功」。 */
export function validateExamData(raw) {
  const errors = [];
  const list = [];
  if (!Array.isArray(raw)) {
    return { ok: false, exams: [], errors: ["顶层数据必须是一个数组。"] };
  }
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const n = i + 1;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push("第 " + n + " 条考试数据不是一个有效的对象。");
      continue;
    }
    let valid = true;
    if (typeof item.subject !== "string" || item.subject.trim() === "") {
      errors.push("第 " + n + " 条考试数据中的 subject 必须是字符串且不能为空。");
      valid = false;
    }
    if (parseExamTime(item.examTime) === null) {
      errors.push("第 " + n + " 条考试数据中的 examTime 不是有效的日期格式。");
      valid = false;
    }
    if (typeof item.credit !== "number" || !isFinite(item.credit)) {
      errors.push("第 " + n + " 条考试数据中的 credit 必须是数字。");
      valid = false;
    }
    if (typeof item.focus !== "string") {
      errors.push("第 " + n + " 条考试数据中的 focus 必须是字符串。");
      valid = false;
    }
    if (item.duration !== undefined &&
        (typeof item.duration !== "number" || !isFinite(item.duration) || item.duration <= 0)) {
      errors.push("第 " + n + " 条考试数据中的 duration 必须是大于 0 的数字（分钟）。");
      valid = false;
    }
    if (valid) list.push(normalizeExam(item, i));
  }
  return { ok: errors.length === 0, exams: list, errors: errors };
}

/* ==================== 汇总统计 ==================== */

/** 进度 / 学分统计：已完成按「已结束」计，进行中并入待考场次 */
export function summarize(exams, now) {
  let finished = 0, upcoming = 0, ongoing = 0;
  let creditTotal = 0, creditDone = 0;
  for (let i = 0; i < exams.length; i++) {
    const e = exams[i];
    const phase = examPhase(e, now);
    if (phase === "finished") {
      finished++;
      creditDone += e.credit;
    } else if (phase === "ongoing") {
      ongoing++;
    } else {
      upcoming++;
    }
    creditTotal += e.credit;
  }
  const total = exams.length;
  const round2 = (v) => Math.round(v * 100) / 100;   // 避免 0.1 + 0.2 的浮点尾巴
  return {
    total: total,
    finished: finished,
    upcoming: upcoming,
    ongoing: ongoing,
    pending: upcoming + ongoing,
    pct: total === 0 ? 0 : Math.round(finished / total * 100),
    creditTotal: round2(creditTotal),
    creditDone: round2(creditDone),
    creditLeft: round2(creditTotal - creditDone)
  };
}

/* ==================== 示例数据 ==================== */

/** 示例数据：日期相对基准时间 +3 / +7 / +12 天，保证任何时候演示效果完整 */
export function buildSampleExams(nowMs) {
  const base = nowMs === undefined ? Date.now() : nowMs;
  const makeTime = (offset, hour, minute) => {
    const d = new Date(base + offset * DAY);
    d.setHours(hour, minute, 0, 0);
    return toIsoLocal(d.getTime());
  };
  return [
    { subject: "高等数学", examTime: makeTime(3, 9, 0), credit: 4, focus: "极限、微分、积分重点复习" },
    { subject: "大学英语", examTime: makeTime(7, 14, 0), credit: 3, focus: "阅读理解和作文模板" },
    { subject: "数据结构", examTime: makeTime(12, 10, 0), credit: 3, focus: "树、图、排序算法" }
  ];
}
