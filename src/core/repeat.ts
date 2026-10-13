// 重复规则纯函数：发生日推算 + 完成状态判定。
//
// 设计要点（与 docs/重复任务约定一致）：
// - 日期一律 "yyyy-MM-dd" 本地时区字符串（与 core/dates 相同约定），ISO 字典序即可比较；
// - 完成滚动：下一次发生日 = 规则意义上严格晚于 max(今天, 当前锚点) 的第一个发生日
//   ——拖了几天没打卡不堆逾期（直接滚到当前期），周二的任务拖到周三勾保持周二维形；
// - 展示复原：勾掉后划掉状态持续到下一次发生日的 0 点，跨 0 点由日期比较自然翻转，
//   不存在任何需要后台/启动器刷新的状态（「0 点自动复原」是推导出来的，不是写出来的）；
// - monthly 的“第 N 日”在大小月钳制（1月31日 → 2月28/29日），推算按规则逐月枚举，
//   不能做日期加减（从 2月28日 反推上一期必须得到 1月31日 而不是 1月28日）。
//
// 全部函数支持注入 today，无隐藏全局状态，可测试。

import type { RepeatRule, Task } from "./models";
import { addDays, parseDate, toDateStr, todayStr } from "./dates";

/** doneLog 封顶：只服务「当期打卡」展示与今日计数，50 条历史绰绰有余 */
export const DONE_LOG_CAP = 50;

function daysInMonth(year: number, monthIdx: number): number {
  // monthIdx: 0=一月 … 11=十二月（JS Date 口径）；day=0 即上月末，自动处理闰年
  return new Date(year, monthIdx + 1, 0).getDate();
}

/** 某月里第 N 日的真实日期：N 超出月长时钳制到月末 */
function clampMonthDay(year: number, monthIdx: number, day: number): string {
  return toDateStr(new Date(year, monthIdx, Math.min(day, daysInMonth(year, monthIdx))));
}

/** 规则意义上严格晚于 after 的第一个发生日 */
export function nextOccurrence(rule: RepeatRule, after: string): string {
  switch (rule.kind) {
    case "daily":
      return addDays(after, 1);
    case "workday": {
      let d = addDays(after, 1);
      const dow = () => parseDate(d).getDay();
      while (dow() === 0 || dow() === 6) d = addDays(d, 1);
      return d;
    }
    case "weekly": {
      let d = addDays(after, 1);
      while (parseDate(d).getDay() !== rule.dow) d = addDays(d, 1);
      return d;
    }
    case "monthly": {
      const dt = parseDate(after);
      let y = dt.getFullYear();
      let m = dt.getMonth();
      for (;;) {
        m += 1;
        if (m > 11) {
          m = 0;
          y += 1;
        }
        const candidate = clampMonthDay(y, m, rule.day);
        if (candidate > after) return candidate;
      }
    }
  }
}

/** 规则意义上严格早于 before 的第一个发生日（完成滚动的逆操作） */
export function previousOccurrence(rule: RepeatRule, before: string): string {
  switch (rule.kind) {
    case "daily":
      return addDays(before, -1);
    case "workday": {
      let d = addDays(before, -1);
      const dow = () => parseDate(d).getDay();
      while (dow() === 0 || dow() === 6) d = addDays(d, -1);
      return d;
    }
    case "weekly": {
      let d = addDays(before, -1);
      while (parseDate(d).getDay() !== rule.dow) d = addDays(d, -1);
      return d;
    }
    case "monthly": {
      const dt = parseDate(before);
      let y = dt.getFullYear();
      let m = dt.getMonth();
      for (;;) {
        const candidate = clampMonthDay(y, m, rule.day);
        if (candidate < before) return candidate;
        m -= 1;
        if (m < 0) {
          m = 11;
          y -= 1;
        }
      }
    }
  }
}

/**
 * 当期发生日（展示与新建锚点用）：锚点仍是今天或未来 → 锚点原样；
 * 锚点已过期（拖了几天没打开）→ 规则意义上「今天或未来」的最近发生日。
 * 每天任务拖 3 天没打卡，打开直接按今天呈现，不倒贴 3 个逾期。
 */
export function currentOccurrence(
  rule: RepeatRule,
  today: string,
  anchor?: string,
): string {
  if (anchor && anchor >= today) return anchor;
  switch (rule.kind) {
    case "daily":
      return today;
    case "workday": {
      const dow = parseDate(today).getDay();
      return dow >= 1 && dow <= 5 ? today : nextOccurrence(rule, today);
    }
    case "weekly": {
      const dow = parseDate(today).getDay();
      return dow === rule.dow ? today : nextOccurrence(rule, today);
    }
    case "monthly": {
      const dt = parseDate(today);
      const cur = clampMonthDay(dt.getFullYear(), dt.getMonth(), rule.day);
      return cur >= today ? cur : nextOccurrence(rule, today);
    }
  }
}

/**
 * 今天（含）为止最近的一个发生日：补勾迟到任务时记录的「当期」。
 * 每天任务拖 3 天补勾记今天（不补 3 天）；每周二任务周三补勾记昨天（周二那期）。
 */
export function latestOccurrence(rule: RepeatRule, today: string): string {
  return previousOccurrence(rule, addDays(today, 1));
}

/**
 * 重复任务当前是否处于「已打卡（划掉）」状态。
 * 判定：今天还没到下一次发生日，且最近一次完成的就是当前这一期。
 * 不变量：完成动作保证 dueDate === nextOccurrence(rule, doneLog 最后一项)。
 */
export function recurringDone(task: Task, today: string = todayStr()): boolean {
  if (!task.repeat || !task.dueDate) return false;
  const log = task.doneLog;
  if (!log || log.length === 0) return false;
  const last = log[log.length - 1];
  return today < task.dueDate && last >= previousOccurrence(task.repeat, task.dueDate);
}

/** 重复任务的展示口径到期日（永不过去：锚点过期时取当期） */
export function effectiveDue(task: Task, today: string = todayStr()): string {
  if (!task.repeat) return task.dueDate ?? today;
  return currentOccurrence(task.repeat, today, task.dueDate);
}

/** 规则的人话描述（行内角标 / 快速输入预览共用） */
export function formatRepeat(rule: RepeatRule): string {
  switch (rule.kind) {
    case "daily":
      return "每天";
    case "workday":
      return "工作日";
    case "weekly":
      return `每周${"日一二三四五六"[rule.dow] ?? "?"}`;
    case "monthly":
      return `每月${rule.day}日`;
  }
}

/** 旧数据/外部数据的规则字段校验：不合法一律视为无规则（不得抛错） */
export function normalizeRepeat(raw: unknown): RepeatRule | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { kind?: unknown; dow?: unknown; day?: unknown };
  switch (r.kind) {
    case "daily":
      return { kind: "daily" };
    case "workday":
      return { kind: "workday" };
    case "weekly":
      return typeof r.dow === "number" && Number.isInteger(r.dow) && r.dow >= 0 && r.dow <= 6
        ? { kind: "weekly", dow: r.dow }
        : undefined;
    case "monthly":
      return typeof r.day === "number" && Number.isInteger(r.day) && r.day >= 1 && r.day <= 31
        ? { kind: "monthly", day: r.day }
        : undefined;
    default:
      return undefined;
  }
}

/** doneLog 清洗：只留合法日期串、去重保序、封顶最近 N 条 */
export function normalizeDoneLog(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of raw) {
    if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  const capped = out.slice(-DONE_LOG_CAP);
  return capped.length ? capped : undefined;
}
