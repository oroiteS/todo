// 展示格式化（相对时间 / 完成时间角标 / 行内日期角标）

import { diffDays, formatDue, parseDate, todayStr, toDateStr } from "@/core/dates";

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = now.getTime() - t;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 2 * day) return "昨天";
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 完成时间（ISO datetime）→ 本地日期 "yyyy-MM-dd"。
 * 必须用本地时区取日：completedAt 是 ISO（常含 Z），直接 slice(0,10) 在
 * 东八区会得到前一天的 UTC 日期。
 */
export function completionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return toDateStr(d);
}

/**
 * 完成标语：今天完成 / 昨天完成 / 已于 1月4日 完成（跨年补年份）。
 * 脏数据返回空串，由调用方决定回退显示，绝不编造时间。
 */
export function formatCompletedLabel(
  iso: string,
  today: string = todayStr(),
): string {
  const day = completionDate(iso);
  if (!day) return "";
  const d = diffDays(day, today);
  if (d === 0) return "今天完成";
  if (d === -1) return "昨天完成";
  const dt = parseDate(day);
  const label = `${dt.getMonth() + 1}月${dt.getDate()}日`;
  if (dt.getFullYear() !== parseDate(today).getFullYear()) {
    return `已于 ${dt.getFullYear()}年${label} 完成`;
  }
  return `已于 ${label} 完成`;
}

export type ChipTone = "ok" | "danger" | "warn" | "muted";

export interface DateChip {
  tone: ChipTone;
  text: string;
}

/**
 * 行内日期角标的唯一口径。
 *
 * 已完成任务只显示完成时间——到期日的「逾期 N 天」是未完成语义，
 * 完成后再按今天算差值会让文案随日期无限增长（历史 bug）。
 */
export function rowDateChip(
  due: string | undefined,
  completedAt: string | null | undefined,
  today: string = todayStr(),
): DateChip | null {
  if (completedAt) {
    const text = formatCompletedLabel(completedAt, today);
    // 脏 completedAt：退回到期日角标，不显示假的完成时间
    if (text) return { tone: "ok", text };
  }
  if (!due) return null;
  const d = diffDays(due, today);
  const tone: ChipTone = d < 0 ? "danger" : d === 0 ? "warn" : "muted";
  return { tone, text: formatDue(due, today) };
}
