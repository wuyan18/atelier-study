/* 单元测试：js/exams-core.js
   - 自身行为断言（无需任何外部依赖，始终执行）
   - 与源项目 exam_planning/web/core.js 的逐项等价断言（源项目在本机时才执行；
     卸载/移除源项目后自动跳过，不会让本项目的测试变红）
   运行：node tests/unit_exams_core.mjs */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import * as mine from "../js/exams-core.js";

const ORIG = "C:\\code\\项目\\exam_planning\\web\\core.js";
let orig = null;
try {
  orig = await import(pathToFileURL(ORIG).href);
} catch {
  console.log("提示：未找到源项目 " + ORIG + "，跳过「与源项目逐项对比」的断言（自检照常执行）。\n");
}

let pass = 0, fail = 0, skip = 0;
function check(name, fn) {
  try { fn(); pass++; console.log("PASS  " + name); }
  catch (e) { fail++; console.log("FAIL  " + name + "\n      " + String(e.message).split("\n").join("\n      ")); }
}
/* 需要源项目在场的对比断言 */
function pcheck(name, fn) {
  if (!orig) { skip++; console.log("SKIP  " + name); return; }
  check(name, fn);
}

/* ---------- 常量 ---------- */
check("DAY / DEFAULT_DURATION", () => {
  assert.equal(mine.DAY, 86400000);
  assert.equal(mine.DEFAULT_DURATION, 120);
});
pcheck("DAY / DEFAULT_DURATION 与源一致", () => {
  assert.equal(mine.DAY, orig.DAY);
  assert.equal(mine.DEFAULT_DURATION, orig.DEFAULT_DURATION);
});

/* ---------- 时间解析 ---------- */
const TIME_CASES = [
  "2026-11-05T09:00:00", "2026-11-05 09:00", "2026-11-05T09:00:00.5",
  "2026-11-05T09:00:00+08:00", "2026-11-05T09:00:00-05:30", "2026-11-05T00:00:00Z",
  "2026-02-30T09:00:00", "2026-11-05T25:00:00", "2026-13-01T09:00:00",
  "2026-11-05", "", "abc", null, undefined, 1793840400000,
];
pcheck("parseExamTime 全部用例与源一致（含非法输入拒绝）", () => {
  for (const v of TIME_CASES) {
    assert.equal(mine.parseExamTime(v), orig.parseExamTime(v), "输入 " + JSON.stringify(v));
  }
});
check("parseExamTime 拒绝 02-30 / 25:00 / 13 月 / 空与非字符串", () => {
  assert.equal(mine.parseExamTime("2026-02-30T09:00:00"), null);
  assert.equal(mine.parseExamTime("2026-11-05T25:00:00"), null);
  assert.equal(mine.parseExamTime("2026-13-01T09:00:00"), null);
  assert.equal(mine.parseExamTime(""), null);
  assert.equal(mine.parseExamTime(null), null);
});
check("parseExamTime 带时区与本地时间等价", () => {
  assert.equal(mine.parseExamTime("2026-11-05T09:00:00"), mine.parseExamTime("2026-11-05T09:00:00+08:00"));
});

/* ---------- 格式化 ---------- */
pcheck("formatDate / toLocalInputValue / toIsoLocal / dayKey / startOfDay 与源一致", () => {
  for (const ts of [0, 1793840400000, Date.now(), 1795134600000]) {
    assert.equal(mine.formatDate(ts), orig.formatDate(ts));
    assert.equal(mine.toLocalInputValue(ts), orig.toLocalInputValue(ts));
    assert.equal(mine.toIsoLocal(ts), orig.toIsoLocal(ts));
    assert.equal(mine.dayKey(ts), orig.dayKey(ts));
    assert.equal(mine.startOfDay(ts), orig.startOfDay(ts));
  }
});
check("iso 往返可解析", () => {
  const ts = mine.parseExamTime("2026-11-20T08:30:00");
  assert.equal(mine.parseExamTime(mine.toIsoLocal(ts)), ts);
  assert.equal(mine.toLocalInputValue(ts), "2026-11-20T08:30");
});

/* ---------- 倒计时 ---------- */
pcheck("formatCountdown / countdownDisplayText 与源一致", () => {
  for (const ms of [0, 999, 61000, 3599000, 90061000, 8 * mine.DAY, -5000]) {
    assert.deepEqual(mine.formatCountdown(ms), orig.formatCountdown(ms), "ms=" + ms);
    assert.equal(mine.countdownDisplayText(ms), orig.countdownDisplayText(ms), "ms=" + ms);
  }
});
check("formatCountdown 基本语义（天/时/分/秒拆解、负数归零）", () => {
  assert.deepEqual(mine.formatCountdown(2 * mine.DAY + 3 * 3600e3 + 4 * 60e3 + 5e3), { d: 2, h: 3, m: 4, s: 5 });
  const neg = mine.formatCountdown(-5000);
  assert.equal(neg.d, 0);
  assert.equal(neg.s, 0);
});

/* ---------- 阶段与主角 ---------- */
const NOW = mine.parseExamTime("2026-11-02T20:00:00");
const SET = [
  { id: "a", subject: "已结束", examTime: NOW - 3 * 3600e3, credit: 3, focus: "", duration: 120 },
  { id: "b", subject: "进行中", examTime: NOW - 30 * 60e3, credit: 4, focus: "", duration: 120 },
  { id: "c", subject: "进行中2", examTime: NOW - 10 * 60e3, credit: 2, focus: "", duration: 60 },
  { id: "d", subject: "待考近", examTime: NOW + 2 * 3600e3, credit: 3, focus: "", duration: 120 },
  { id: "e", subject: "待考远", examTime: NOW + 5 * mine.DAY, credit: 4, focus: "", duration: 120 },
];
pcheck("examPhase 三态与源一致", () => {
  for (const e of SET) assert.equal(mine.examPhase(e, NOW), orig.examPhase(e, NOW), e.subject);
});
check("examPhase 三态正确（含时长判定进行中）", () => {
  assert.equal(mine.examPhase(SET[1], NOW), "ongoing");
  assert.equal(mine.examPhase(SET[0], NOW), "finished");
  assert.equal(mine.examPhase(SET[3], NOW), "upcoming");
});
pcheck("findHeroExam 与源一致", () => {
  assert.equal(mine.findHeroExam(SET, NOW).id, orig.findHeroExam(SET, NOW).id);
});
check("findHeroExam 优先进行中，其次最近待考", () => {
  assert.equal(mine.findHeroExam(SET, NOW).id, "b");         // 进行中取开始更早的一场
  assert.equal(mine.findHeroExam([SET[0]], NOW), null);      // 全部结束
  assert.equal(mine.findHeroExam([SET[4], SET[3]], NOW).id, "d");
  assert.equal(mine.findHeroExam([], NOW), null);
});

/* ---------- 紧迫度 ---------- */
pcheck("urgencyTier 边界与源一致", () => {
  const cases = [0, mine.DAY - 1, mine.DAY, 3 * mine.DAY - 1, 3 * mine.DAY, 7 * mine.DAY, 7 * mine.DAY + 1, 30 * mine.DAY];
  for (const ms of cases) assert.equal(mine.urgencyTier(ms), orig.urgencyTier(ms), "ms=" + ms);
});
check("urgencyTier 四档边界（1 天 / 3 天 / 7 天）", () => {
  assert.equal(mine.urgencyTier(3600e3), "red");
  assert.equal(mine.urgencyTier(2 * mine.DAY), "orange");
  assert.equal(mine.urgencyTier(6 * mine.DAY), "blue");
  assert.equal(mine.urgencyTier(20 * mine.DAY), "safe");
});
pcheck("urgencyText 与源一致", () => {
  for (const [tier, ms] of [["red", 3600e3], ["orange", 2 * mine.DAY], ["blue", 6 * mine.DAY], ["safe", 20 * mine.DAY]]) {
    assert.equal(mine.urgencyText(tier, ms), orig.urgencyText(tier, ms));
  }
});

/* ---------- 月历 ---------- */
pcheck("buildMonthGrid 12 个月逐格与源一致", () => {
  for (let m = 0; m < 12; m++) {
    const a = mine.buildMonthGrid(2026, m, SET, NOW);
    const b = orig.buildMonthGrid(2026, m, SET, NOW);
    assert.equal(a.length, b.length, `月 ${m + 1} 格数`);
    for (let i = 0; i < a.length; i++) {
      assert.equal(a[i].day, b[i].day);
      assert.equal(a[i].inMonth, b[i].inMonth);
      assert.equal(a[i].isToday, b[i].isToday);
      assert.equal(a[i].ts, b[i].ts);
      assert.deepEqual(a[i].exams.map((e) => e.id), b[i].exams.map((e) => e.id));
    }
  }
});
check("buildMonthGrid 周一对齐 + 当月首日位置 + 整周", () => {
  const g = mine.buildMonthGrid(2026, 10, SET, NOW);         // 2026 年 11 月
  assert.equal(g.length % 7, 0);
  assert.equal(g[0].day, 26);                                // 11/1 是周日 → 首格 10/26
  assert.equal(g[0].inMonth, false);
  assert.equal(g[6].day, 1);
  assert.equal(g[6].inMonth, true);
  assert.equal(g.find((c) => c.isToday).day, 2);             // NOW = 11/2
});
check("buildMonthGrid 跨年归一化", () => {
  const g = mine.buildMonthGrid(2026, 12, SET, NOW);         // 2027 年 1 月
  assert.ok(g.some((c) => c.inMonth && c.day === 1));
});

/* ---------- 导入校验 ---------- */
const OK_RAW = [
  { subject: "高等数学", examTime: "2026-11-05T09:00:00", credit: 4, focus: "积分" },
  { subject: "英语", examTime: "2026-11-09 14:00", credit: 3, focus: "", duration: 90 },
];
pcheck("validateExamData 合法数据与源一致", () => {
  const a = mine.validateExamData(OK_RAW), b = orig.validateExamData(OK_RAW);
  assert.equal(a.ok, b.ok);
  assert.deepEqual(a.errors, b.errors);
});
check("validateExamData 合法数据（缺省时长 120）", () => {
  const a = mine.validateExamData(OK_RAW);
  assert.equal(a.ok, true);
  assert.equal(a.exams.length, 2);
  assert.equal(a.exams[1].duration, 90);
  assert.equal(a.exams[0].duration, mine.DEFAULT_DURATION);
});
pcheck("validateExamData 错误消息逐条与源一致", () => {
  const BAD = [
    null,
    { examTime: "2026-11-05T09:00:00", credit: 1, focus: "" },
    { subject: "X", examTime: "2026-02-30T09:00:00", credit: 1, focus: "" },
    { subject: "X", examTime: "2026-11-05T09:00:00", credit: "3", focus: "" },
    { subject: "X", examTime: "2026-11-05T09:00:00", credit: 3, focus: 1 },
    { subject: "X", examTime: "2026-11-05T09:00:00", credit: 3, focus: "", duration: 0 },
  ];
  const a = mine.validateExamData(BAD), b = orig.validateExamData(BAD);
  assert.equal(a.ok, false);
  assert.deepEqual(a.errors, b.errors);
  assert.equal(a.exams.length, 0);
});
check("validateExamData 逐项错误（6 条）", () => {
  const a = mine.validateExamData([
    null,
    { examTime: "2026-11-05T09:00:00", credit: 1, focus: "" },
    { subject: "X", examTime: "2026-02-30T09:00:00", credit: 1, focus: "" },
    { subject: "X", examTime: "2026-11-05T09:00:00", credit: "3", focus: "" },
    { subject: "X", examTime: "2026-11-05T09:00:00", credit: 3, focus: 1 },
    { subject: "X", examTime: "2026-11-05T09:00:00", credit: 3, focus: "", duration: 0 },
  ]);
  assert.equal(a.ok, false);
  assert.equal(a.errors.length, 6);
  assert.match(a.errors[2], /^第 3 条考试数据中的 examTime/);
  assert.equal(a.errors[3], "第 4 条考试数据中的 credit 必须是数字。");
});
check("validateExamData 顶层非数组：本移植主动兜底（源项目会静默通过或抛错）", () => {
  for (const v of [{}, "x", 1, null, undefined]) {
    const a = mine.validateExamData(v);
    assert.equal(a.ok, false, "输入 " + JSON.stringify(v) + " 应判失败");
    assert.deepEqual(a.exams, []);
    assert.equal(a.errors.length > 0, true);
  }
  /* 源项目行为（记录差异，不作为断言）：{} 与 1 → 循环不执行 → ok:true；null → 抛 TypeError。 */
  if (orig) assert.equal(orig.validateExamData({}).ok, true);
});
pcheck("normalizeStoredExam 接受毫秒与字符串（与源一致）", () => {
  const ts = mine.parseExamTime("2026-11-05T09:00:00");
  const a = mine.normalizeStoredExam({ subject: "A", examTime: ts, credit: 2, focus: "" }, 0);
  const b = orig.normalizeStoredExam({ subject: "A", examTime: ts, credit: 2, focus: "" }, 0);
  assert.equal(a.examTime, b.examTime);
  const stripId = (id) => String(id).slice(0, String(id).lastIndexOf("-")); // id 尾部带随机后缀
  assert.equal(stripId(a.id), stripId(b.id));
});
check("normalizeStoredExam 字段归一化", () => {
  const ts = mine.parseExamTime("2026-11-05T09:00:00");
  const a = mine.normalizeStoredExam({ subject: "A", examTime: ts, credit: 2, focus: "" }, 0);
  assert.match(a.id, /^exam-\d+-\d+-[a-z0-9]+$/);
  assert.equal(mine.normalizeStoredExam({ subject: "A", examTime: "2026-11-05T09:00:00" }, 1).examTime, ts);
  assert.equal(mine.normalizeStoredExam({ subject: "", examTime: ts }, 0), null);
});

/* ---------- 序列化 ---------- */
pcheck("serializeExam 与源一致", () => {
  const e = mine.normalizeStoredExam({ id: "k", subject: "A", examTime: "2026-11-05T09:00:00", credit: 2, focus: "f", duration: 100 }, 0);
  assert.deepEqual(mine.serializeExam(e), orig.serializeExam(e));
});
check("serializeExam 输出本地 ISO 字符串", () => {
  const e = mine.normalizeStoredExam({ id: "k", subject: "A", examTime: "2026-11-05T09:00:00", credit: 2, focus: "f", duration: 100 }, 0);
  assert.equal(mine.serializeExam(e).examTime, "2026-11-05T09:00:00");
});

/* ---------- 统计 ---------- */
pcheck("summarize 与源一致（含学分与百分比）", () => {
  for (const list of [SET, [SET[0]], []]) {
    assert.deepEqual(mine.summarize(list, NOW), orig.summarize(list, NOW));
  }
});
check("summarize 计数与学分", () => {
  const s = mine.summarize(SET, NOW);
  assert.equal(s.total, 5);
  assert.equal(s.finished, 1);
  assert.equal(s.ongoing, 2);
  assert.equal(s.pending, 4);
  assert.equal(s.pct, 20);
  assert.equal(s.creditTotal, 16);
  assert.equal(s.creditDone, 3);
  assert.equal(s.creditLeft, 13);
});

/* ---------- 示例数据 ---------- */
pcheck("buildSampleExams 与源一致（固定基准时间）", () => {
  const base = mine.parseExamTime("2026-11-02T12:00:00");
  assert.deepEqual(mine.buildSampleExams(base), orig.buildSampleExams(base));
});
check("buildSampleExams 生成 3 场未来考试", () => {
  const base = mine.parseExamTime("2026-11-02T12:00:00");
  const list = mine.buildSampleExams(base);
  assert.equal(list.length, 3);
  for (const e of list) assert.ok(mine.parseExamTime(e.examTime) > base);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败${skip ? " / " + skip + " 跳过（源项目不在本机）" : ""}`);
process.exit(fail ? 1 : 0);
