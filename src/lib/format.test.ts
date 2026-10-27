// 展示格式化测试：完成时间角标 + 行内日期角标口径
//
// 回归背景：行内角标文案曾无条件用 formatDue(due, today)，
// 已完成任务也会被打上「逾期 N 天」且天数随日期增长。

import { describe, expect, it } from "vitest";
import {
  completionDate,
  formatCompletedLabel,
  rowDateChip,
} from "./format";

const TODAY = "2026-01-14";

describe("completionDate", () => {
  it("按本地时区取日（不是 UTC 日期）", () => {
    // 本地 23:30 完成，UTC 可能已跨日；必须返回本地那一天
    expect(completionDate(new Date(2026, 0, 14, 23, 30).toISOString())).toBe(
      "2026-01-14",
    );
    // 本地 00:30 完成，UTC 可能还是前一天
    expect(completionDate(new Date(2026, 0, 15, 0, 30).toISOString())).toBe(
      "2026-01-15",
    );
  });
});

describe("formatCompletedLabel", () => {
  it("今天完成 / 昨天完成 / 更早按日期", () => {
    expect(
      formatCompletedLabel(new Date(2026, 0, 14, 9, 0).toISOString(), TODAY),
    ).toBe("今天完成");
    expect(
      formatCompletedLabel(new Date(2026, 0, 13, 9, 0).toISOString(), TODAY),
    ).toBe("昨天完成");
    expect(
      formatCompletedLabel(new Date(2026, 0, 4, 9, 0).toISOString(), TODAY),
    ).toBe("已于 1月4日 完成");
  });

  it("跨年补年份", () => {
    expect(
      formatCompletedLabel(new Date(2025, 11, 30, 9, 0).toISOString(), TODAY),
    ).toBe("已于 2025年12月30日 完成");
  });

  it("脏数据不崩、不编造时间", () => {
    expect(formatCompletedLabel("not-a-date", TODAY)).toBe("");
  });
});

describe("rowDateChip", () => {
  it("已完成任务：即使到期日已过，也只显示完成时间，永不显示逾期", () => {
    const completedAt = new Date(2026, 0, 4, 9, 0).toISOString();
    const chip = rowDateChip("2026-01-04", completedAt, TODAY);
    expect(chip).toEqual({ tone: "ok", text: "已于 1月4日 完成" });
  });

  it("已完成任务：到期日仍在未来也只显示完成时间", () => {
    const completedAt = new Date(2026, 0, 14, 9, 0).toISOString();
    expect(rowDateChip("2026-02-01", completedAt, TODAY)).toEqual({
      tone: "ok",
      text: "今天完成",
    });
  });

  it("逾期天数不随完成时间增长：完成日固定的任何一天都不出现「逾期」", () => {
    const completedAt = new Date(2026, 0, 4, 9, 0).toISOString();
    for (let i = 1; i <= 30; i++) {
      const today = `2026-01-${String(4 + i).padStart(2, "0")}`;
      const chip = rowDateChip("2026-01-04", completedAt, today);
      expect(chip?.text ?? "").not.toContain("逾期");
      expect(chip?.tone).toBe("ok");
    }
  });

  it("文案不随天数增长：相隔多日的两个今天显示同一条完成标语", () => {
    const completedAt = new Date(2026, 0, 4, 9, 0).toISOString();
    const a = rowDateChip("2026-01-04", completedAt, "2026-01-06");
    const b = rowDateChip("2026-01-04", completedAt, "2026-01-24");
    expect(a).toEqual(b);
    expect(a).toEqual({ tone: "ok", text: "已于 1月4日 完成" });
  });

  it("未完成任务：逾期 / 今天 / 未来 三档", () => {
    expect(rowDateChip("2026-01-10", null, TODAY)).toEqual({
      tone: "danger",
      text: "逾期 4 天",
    });
    expect(rowDateChip(TODAY, null, TODAY)).toEqual({ tone: "warn", text: "今天" });
    expect(rowDateChip("2026-01-21", null, TODAY)).toEqual({
      tone: "muted",
      text: "1月21日",
    });
  });

  it("无到期日且未完成 → 无角标", () => {
    expect(rowDateChip(undefined, null, TODAY)).toBeNull();
  });
});
