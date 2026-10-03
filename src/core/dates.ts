// 本地日期工具。约定：日期一律使用 "yyyy-MM-dd" 本地时区字符串，
// 全部函数支持注入 now/today，保证可测试、无隐藏全局状态。

export function todayStr(now: Date = new Date()): string {
  return toDateStr(now);
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "yyyy-MM-dd" -> 本地时区当日 00:00 的 Date */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(dateStr: string, n: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function diffDays(a: string, b: string): number {
  // a - b（自然日差）
  const ms = parseDate(a).getTime() - parseDate(b).getTime();
  return Math.round(ms / 86400000);
}

export function isOverdue(due: string, today: string = todayStr()): boolean {
  return diffDays(due, today) < 0;
}

export function isToday(due: string, today: string = todayStr()): boolean {
  return due === today;
}

/** 未来 7 天内（不含今天） */
export function isWithinNext7Days(
  due: string,
  today: string = todayStr(),
): boolean {
  const d = diffDays(due, today);
  return d > 0 && d <= 7;
}

const WEEKDAYS_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 人性化到期描述：今天 / 明天 / 后天 / 周X / M月D日 / 逾期N天 */
export function formatDue(due: string, today: string = todayStr()): string {
  const d = diffDays(due, today);
  if (d < 0) return d === -1 ? "昨天到期" : `逾期 ${-d} 天`;
  if (d === 0) return "今天";
  if (d === 1) return "明天";
  if (d === 2) return "后天";
  if (d <= 6) return WEEKDAYS_CN[parseDate(due).getDay()];
  const dt = parseDate(due);
  const label = `${dt.getMonth() + 1}月${dt.getDate()}日`;
  if (dt.getFullYear() !== parseDate(today).getFullYear()) {
    return `${dt.getFullYear()}年${label}`;
  }
  return label;
}

/** 周一为一周开始：返回 (0=周一 … 6=周日) */
export function mondayBasedDow(d: Date): number {
  return (d.getDay() + 6) % 7;
}

// ---------- 日历网格 ----------

export interface CalendarCell {
  /** "yyyy-MM-dd" */
  date: string;
  /** 是否属于目标月份（前后月补位为 false） */
  inMonth: boolean;
}

/**
 * 生成某月日历网格：6 行 × 7 列，周日开头（与中文日历习惯一致），
 * 前后月日期补位。纯函数，供 DatePicker 渲染与单测。
 */
export function getMonthGrid(year: number, month: number): CalendarCell[][] {
  const firstDow = new Date(year, month, 1).getDay(); // 0=周日
  const start = new Date(year, month, 1 - firstDow);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ date: toDateStr(d), inMonth: d.getMonth() === month });
  }
  const rows: CalendarCell[][] = [];
  for (let r = 0; r < 6; r++) rows.push(cells.slice(r * 7, r * 7 + 7));
  return rows;
}
