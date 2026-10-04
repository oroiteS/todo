// 智能快速输入解析：
//   "明天 交报告 #工作 !高"      -> 明天到期、高优先级、工作列表
//   "周五 开会"                  -> 本周五到期
//   "3月8日 给妈妈打电话 !!"     -> 日期 + 中优先级
//   "下周三 复盘"                -> 下周三
// 日期词支持紧跟中文（"明天交报告"）也可空格分隔；#列表 需匹配已有列表。
// 优先级/列表记号兼容全角：「！高」「！！」「＃工作」与半角等价（中文输入法免切换）。

import type { Priority } from "./models";
import {
  addDays,
  mondayBasedDow,
  parseDate,
  toDateStr,
  todayStr,
} from "./dates";

export interface ParsedQuickAdd {
  title: string;
  dueDate?: string;
  priority?: Priority;
  listQuery?: string;
}

const DAY_CN: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  末: 0,
  天: 0,
};

// 从字符串开头起匹配的日期词（允许后跟中文或空白）。
// 数值日期两种形态（含年份）：[年]月日 / 年月日（2026/10/8、2026-10-8、2026.10.8、2026年10月8日），
// 以及不带年份的 月日（10/8、10-8，按当前年，已过自动顺延一年）。
const DATE_PREFIX_RE =
  /^(今天|今日|明天|明日|后天|大后天|(?:下?周|下?星期|下?礼拜)([一二三四五六日末天])|(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]|(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})|(\d{1,2})[\/\-](\d{1,2}))(?=[\s\u4e00-\u9fff]|$)/;

export function parseQuickAdd(
  input: string,
  now: Date = new Date(),
): ParsedQuickAdd {
  const today = todayStr(now);
  let rest = input.trim();
  let dueDate: string | undefined;
  let priority: Priority | undefined;
  let listQuery: string | undefined;

  // 1) 连续吃掉开头的日期词（如 "明天 周五 …" 取最后一个）
  for (;;) {
    const m = DATE_PREFIX_RE.exec(rest);
    if (!m) break;
    const resolved = resolveDateMatch(m, today, now);
    if (resolved === null) break; // 不存在的日期（2月30日）：不消费，保留原词
    dueDate = resolved;
    rest = rest.slice(m[0].length).replace(/^\s+/, "");
  }

  // 2) 拆 token：优先级 与 #列表（记号兼容全角：！ ＃，中文输入法免切换）
  const kept: string[] = [];
  for (const token of rest.split(/\s+/)) {
    if (!token) continue;
    if (!priority && /^[!！]{1,3}$/.test(token)) {
      priority = token.length === 3 ? 3 : token.length === 2 ? 2 : 1;
      continue;
    }
    if (!priority && /^[!！][低中高]$/.test(token)) {
      const level = token[1];
      priority = level === "高" ? 3 : level === "中" ? 2 : 1;
      continue;
    }
    if (!listQuery && /^[#＃]/.test(token) && token.length > 1) {
      listQuery = token.slice(1);
      continue;
    }
    kept.push(token);
  }

  const title = kept.join(" ").trim();
  return {
    title: title || input.trim(),
    dueDate,
    priority,
    listQuery,
  };
}

function resolveDateMatch(
  m: RegExpExecArray,
  today: string,
  now: Date,
): string | null {
  if (m[1] === "今天" || m[1] === "今日") return today;
  if (m[1] === "明天" || m[1] === "明日") return addDays(today, 1);
  if (m[1] === "后天") return addDays(today, 2);
  if (m[1] === "大后天") return addDays(today, 3);

  if (m[2]) {
    // 周X / 下周X
    const target = DAY_CN[m[2]] ?? 1;
    const isNext = /^(下)/.test(m[0].match(/^(下?)/)![1]);
    if (isNext) {
      // 下一个自然周（周一起）的目标日
      const todayPos = mondayBasedDow(now);
      const daysToNextMonday = ((7 - todayPos) % 7) || 7;
      const weekPos = (target + 6) % 7; // 一=0 … 日=6
      return addDays(today, daysToNextMonday + weekPos);
    }
    const todayPos = mondayBasedDow(now);
    const weekPos = (target + 6) % 7;
    const diff = (weekPos - todayPos + 7) % 7; // 0 表示就是今天
    return addDays(today, diff);
  }

  // [2026年]10月8日 / 2026/10/8 / 2026-10-8 / 2026.10.8 / 10/8
  // 捕获组：3=年(年月日) 4=月 5=日；6=年(数值) 7=月 8=日；9=月 10=日(无年份)
  const yearStr = m[3] ?? m[6];
  const month = Number(m[4] ?? m[7] ?? m[9]);
  const day = Number(m[5] ?? m[8] ?? m[10]);
  if (!month || !day || month > 12 || day > 31) return null;

  const curYear = parseDate(today).getFullYear();
  const dt = new Date(yearStr ? Number(yearStr) : curYear, month - 1, day);
  // 拒绝不存在的日期（如 2月30日 会被 Date 滚到 3 月，月日对不上）
  if (dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;

  const candidate = toDateStr(dt);
  // 未写年份且已过 → 顺延一年；显式写了年份就按所写年份，不顺延
  if (!yearStr && candidate < today) {
    return toDateStr(new Date(curYear + 1, month - 1, day));
  }
  return candidate;
}
