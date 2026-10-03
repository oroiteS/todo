import { describe, expect, it } from "vitest";
import {
  addDays,
  diffDays,
  formatDue,
  getMonthGrid,
  isOverdue,
  isWithinNext7Days,
  mondayBasedDow,
  todayStr,
} from "./dates";

// 2026-01-14 是周三
const NOW = new Date(2026, 0, 14, 12, 0);
const TODAY = "2026-01-14";

describe("dates", () => {
  it("todayStr 使用本地时区", () => {
    expect(todayStr(NOW)).toBe(TODAY);
  });

  it("addDays / diffDays", () => {
    expect(addDays(TODAY, 1)).toBe("2026-01-15");
    expect(addDays(TODAY, -1)).toBe("2026-01-13");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(diffDays("2026-01-16", TODAY)).toBe(2);
    expect(diffDays(TODAY, "2026-01-16")).toBe(-2);
  });

  it("isOverdue / isWithinNext7Days", () => {
    expect(isOverdue("2026-01-13", TODAY)).toBe(true);
    expect(isOverdue(TODAY, TODAY)).toBe(false);
    expect(isWithinNext7Days("2026-01-21", TODAY)).toBe(true);
    expect(isWithinNext7Days("2026-01-22", TODAY)).toBe(false);
    expect(isWithinNext7Days(TODAY, TODAY)).toBe(false);
  });

  it("mondayBasedDow 周一为 0", () => {
    expect(mondayBasedDow(NOW)).toBe(2); // 周三
    expect(mondayBasedDow(new Date(2026, 0, 12))).toBe(0); // 周一
    expect(mondayBasedDow(new Date(2026, 0, 18))).toBe(6); // 周日
  });

  it("formatDue 人性化描述", () => {
    expect(formatDue(TODAY, TODAY)).toBe("今天");
    expect(formatDue("2026-01-15", TODAY)).toBe("明天");
    expect(formatDue("2026-01-16", TODAY)).toBe("后天");
    expect(formatDue("2026-01-17", TODAY)).toBe("周六");
    expect(formatDue("2026-01-20", TODAY)).toBe("周二"); // 6 天内显示周X
    expect(formatDue("2026-01-21", TODAY)).toBe("1月21日"); // 一周以上显示日期
    expect(formatDue("2027-03-01", TODAY)).toBe("2027年3月1日");
    expect(formatDue("2026-01-13", TODAY)).toBe("昨天到期");
    expect(formatDue("2026-01-10", TODAY)).toBe("逾期 4 天");
  });

  it("getMonthGrid 生成 6×7 网格、周日开头、前后月补位", () => {
    const grid = getMonthGrid(2026, 0); // 2026年1月：1月1日周四
    expect(grid).toHaveLength(6);
    expect(grid[0]).toHaveLength(7);
    // 首格回填到上一年的 12月28日（周日）
    expect(grid[0][0].date).toBe("2025-12-28");
    expect(grid[0][0].inMonth).toBe(false);
    // 周四位置是 1月1日
    expect(grid[0][4].date).toBe("2026-01-01");
    expect(grid[0][4].inMonth).toBe(true);
    // 当月 31 天完整出现且仅出现一次
    const inMonth = grid.flat().filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(new Set(inMonth.map((c) => c.date)).size).toBe(31);
  });
});
