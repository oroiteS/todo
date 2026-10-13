// core/repeat 纯函数测试：发生日推算（含月末钳制/闰年/跨年）+ 打卡状态判定 + 数据清洗

import { describe, expect, it } from "vitest";
import type { RepeatRule, Task } from "./models";
import {
  currentOccurrence,
  effectiveDue,
  formatRepeat,
  nextOccurrence,
  normalizeDoneLog,
  normalizeRepeat,
  previousOccurrence,
  recurringDone,
} from "./repeat";

describe("nextOccurrence", () => {
  it("每天：严格 +1 天", () => {
    expect(nextOccurrence({ kind: "daily" }, "2026-10-13")).toBe("2026-10-14");
    // 跨月/跨年
    expect(nextOccurrence({ kind: "daily" }, "2026-10-31")).toBe("2026-11-01");
    expect(nextOccurrence({ kind: "daily" }, "2026-12-31")).toBe("2027-01-01");
  });

  it("每周X：严格晚于基准的下一个周X（基准当天也算过去）", () => {
    const tue: RepeatRule = { kind: "weekly", dow: 2 }; // 周二
    // 2026-10-13 是周二：严格晚于 → 下周二
    expect(nextOccurrence(tue, "2026-10-13")).toBe("2026-10-20");
    // 周三出发 → 下周二
    expect(nextOccurrence(tue, "2026-10-14")).toBe("2026-10-20");
    // 周六出发 → 下周二（跨周）
    expect(nextOccurrence(tue, "2026-10-17")).toBe("2026-10-20");
    // 周日(2026-10-18)出发 → 10-20
    expect(nextOccurrence(tue, "2026-10-18")).toBe("2026-10-20");
    // 周日规则跨年：2026-12-31(周四) → 2027-01-03(周日)
    expect(nextOccurrence({ kind: "weekly", dow: 0 }, "2026-12-31")).toBe("2027-01-03");
  });

  it("工作日：跳过周末", () => {
    const wd: RepeatRule = { kind: "workday" };
    // 2026-10-13 周二 → 周三
    expect(nextOccurrence(wd, "2026-10-13")).toBe("2026-10-14");
    // 周五 2026-10-16 → 下周一 10-19
    expect(nextOccurrence(wd, "2026-10-16")).toBe("2026-10-19");
    // 周六 → 周一
    expect(nextOccurrence(wd, "2026-10-17")).toBe("2026-10-19");
    // 周日 → 周一
    expect(nextOccurrence(wd, "2026-10-18")).toBe("2026-10-19");
  });

  it("每月N日：跨月 + 大小月钳制", () => {
    const d1: RepeatRule = { kind: "monthly", day: 1 };
    expect(nextOccurrence(d1, "2026-10-13")).toBe("2026-11-01");
    expect(nextOccurrence(d1, "2026-11-01")).toBe("2026-12-01");

    const d31: RepeatRule = { kind: "monthly", day: 31 };
    // 1月31日 → 2月没有31日，钳制到 2月28日（2026 平年）
    expect(nextOccurrence(d31, "2026-01-31")).toBe("2026-02-28");
    // 闰年钳制到 2月29日
    expect(nextOccurrence(d31, "2028-01-31")).toBe("2028-02-29");
    // 2月28日（已钳制）→ 3月31日
    expect(nextOccurrence(d31, "2026-02-28")).toBe("2026-03-31");
    // 3月31日 → 4月钳制 4月30日
    expect(nextOccurrence(d31, "2026-03-31")).toBe("2026-04-30");
  });
});

describe("previousOccurrence", () => {
  it("每天/每周X：严格早于基准", () => {
    expect(previousOccurrence({ kind: "daily" }, "2026-10-14")).toBe("2026-10-13");
    const tue: RepeatRule = { kind: "weekly", dow: 2 };
    expect(previousOccurrence(tue, "2026-10-20")).toBe("2026-10-13");
    expect(previousOccurrence(tue, "2026-10-14")).toBe("2026-10-13");
  });

  it("每月N日：反推必须按规则而非日期减法（钳制对称）", () => {
    const d31: RepeatRule = { kind: "monthly", day: 31 };
    // 从 2月28日（钳制产物）反推 → 1月31日，而不是 1月28日
    expect(previousOccurrence(d31, "2026-02-28")).toBe("2026-01-31");
    // 基准本身是真实发生日（3月31日）→ 上一期 2月28日
    expect(previousOccurrence(d31, "2026-03-31")).toBe("2026-02-28");
    const d1: RepeatRule = { kind: "monthly", day: 1 };
    expect(previousOccurrence(d1, "2026-03-01")).toBe("2026-02-01");
    expect(previousOccurrence(d1, "2026-01-01")).toBe("2025-12-01");
  });

  it("与 nextOccurrence 互逆：对真实发生日 x，next(previous(x)) === x", () => {
    const rules: RepeatRule[] = [
      { kind: "daily" },
      { kind: "workday" },
      { kind: "weekly", dow: 2 },
      { kind: "monthly", day: 1 },
      { kind: "monthly", day: 31 },
    ];
    for (const rule of rules) {
      // 不变量：任意发生日 x，previous → next 必须回到 x（往返封闭）
      const x = nextOccurrence(rule, "2026-10-13");
      expect(nextOccurrence(rule, previousOccurrence(rule, x))).toBe(x);
    }
  });
});

describe("currentOccurrence", () => {
  it("锚点仍是今天/未来 → 原样保留", () => {
    const tue: RepeatRule = { kind: "weekly", dow: 2 };
    expect(currentOccurrence(tue, "2026-10-12", "2026-10-13")).toBe("2026-10-13");
    expect(currentOccurrence({ kind: "daily" }, "2026-10-12", "2026-11-01")).toBe("2026-11-01");
  });

  it("锚点已过期 → 当期发生日（每天 = 今天，不倒贴逾期）", () => {
    expect(currentOccurrence({ kind: "daily" }, "2026-10-15", "2026-10-12")).toBe("2026-10-15");
  });

  it("每周：今天的周几命中 → 今天；否则下一个周几", () => {
    const tue: RepeatRule = { kind: "weekly", dow: 2 };
    // 2026-10-13 周二当天（锚点上周二已过期）→ 今天
    expect(currentOccurrence(tue, "2026-10-13", "2026-10-06")).toBe("2026-10-13");
    // 周三 → 下周二
    expect(currentOccurrence(tue, "2026-10-14", "2026-10-13")).toBe("2026-10-20");
  });

  it("工作日：工作日 → 今天；周末 → 下周一", () => {
    const wd: RepeatRule = { kind: "workday" };
    expect(currentOccurrence(wd, "2026-10-13", "2026-10-12")).toBe("2026-10-13");
    expect(currentOccurrence(wd, "2026-10-17", "2026-10-16")).toBe("2026-10-19");
  });

  it("每月：本月钳制日未过 → 本月；已过 → 下月", () => {
    const d15: RepeatRule = { kind: "monthly", day: 15 };
    expect(currentOccurrence(d15, "2026-10-13", "2026-09-15")).toBe("2026-10-15");
    expect(currentOccurrence(d15, "2026-10-16", "2026-10-15")).toBe("2026-11-15");
  });
});

// ---------- 打卡状态判定 ----------

const daily = (dueDate: string, doneLog?: string[]): Task => ({
  id: "t1",
  listId: "l1",
  title: "背单词",
  sortOrder: 0,
  completedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  repeat: { kind: "daily" },
  dueDate,
  doneLog,
});

describe("recurringDone", () => {
  it("未完成过 → 未打卡", () => {
    expect(recurringDone(daily("2026-10-13"), "2026-10-13")).toBe(false);
  });

  it("完成后划掉，跨 0 点自动复原（无任何状态刷新）", () => {
    const done = daily("2026-10-14", ["2026-10-13"]); // 10-13 勾掉，滚到 10-14
    expect(recurringDone(done, "2026-10-13")).toBe(true); // 当天 → 划掉
    expect(recurringDone(done, "2026-10-14")).toBe(false); // 次日 0 点后 → 复原
    expect(recurringDone(done, "2026-10-20")).toBe(false); // 拖了没打开也一样
  });

  it("早期完成（提前勾）也进入划掉态", () => {
    // 周二任务 10-13，周一 10-12 提前勾：dueDate 滚到 10-20，last=10-13
    const early: Task = {
      ...daily("2026-10-20", ["2026-10-13"]),
      repeat: { kind: "weekly", dow: 2 },
    };
    expect(recurringDone(early, "2026-10-12")).toBe(true);
    expect(recurringDone(early, "2026-10-19")).toBe(true);
    expect(recurringDone(early, "2026-10-20")).toBe(false);
  });

  it("陈旧日志自愈：日志落后于当前期 → 不算打卡", () => {
    // dueDate=10-14 的上一期是 10-13，日志里只有 10-12（异常数据）→ 未打卡
    expect(recurringDone(daily("2026-10-14", ["2026-10-12"]), "2026-10-13")).toBe(false);
  });

  it("普通任务不受影响", () => {
    const plain: Task = { ...daily("2026-10-14", ["2026-10-13"]), repeat: undefined };
    expect(recurringDone(plain, "2026-10-13")).toBe(false);
  });
});

describe("effectiveDue", () => {
  it("普通任务：原样返回（无日期回落今天）", () => {
    const plain: Task = { ...daily("2026-10-20"), repeat: undefined };
    expect(effectiveDue(plain, "2026-10-13")).toBe("2026-10-20");
    expect(effectiveDue({ ...plain, dueDate: undefined }, "2026-10-13")).toBe("2026-10-13");
  });

  it("重复任务：永不过去（拖了没打开 → 当期）", () => {
    expect(effectiveDue(daily("2026-10-10"), "2026-10-15")).toBe("2026-10-15");
    expect(effectiveDue(daily("2026-10-20"), "2026-10-15")).toBe("2026-10-20");
    const tue: Task = { ...daily("2026-10-13"), repeat: { kind: "weekly", dow: 2 } };
    expect(effectiveDue(tue, "2026-10-14")).toBe("2026-10-20"); // 周三看到的是下周二
  });
});

// ---------- 数据清洗 ----------

describe("normalizeRepeat / normalizeDoneLog", () => {
  it("合法规则保留，非法输入一律 undefined（不抛错）", () => {
    expect(normalizeRepeat({ kind: "daily" })).toEqual({ kind: "daily" });
    expect(normalizeRepeat({ kind: "weekly", dow: 2 })).toEqual({ kind: "weekly", dow: 2 });
    expect(normalizeRepeat({ kind: "weekly", dow: 7 })).toBeUndefined();
    expect(normalizeRepeat({ kind: "weekly" })).toBeUndefined();
    expect(normalizeRepeat({ kind: "monthly", day: 31 })).toEqual({ kind: "monthly", day: 31 });
    expect(normalizeRepeat({ kind: "monthly", day: 0 })).toBeUndefined();
    expect(normalizeRepeat({ kind: "monthly", day: 32 })).toBeUndefined();
    expect(normalizeRepeat({ kind: "yearly" })).toBeUndefined();
    expect(normalizeRepeat(null)).toBeUndefined();
    expect(normalizeRepeat("daily")).toBeUndefined();
  });

  it("doneLog：过滤非法、去重保序、封顶最近 50 条", () => {
    expect(normalizeDoneLog(["2026-10-13", "bad", "2026-10-13", "2026-10-14"])).toEqual([
      "2026-10-13",
      "2026-10-14",
    ]);
    expect(normalizeDoneLog([])).toBeUndefined();
    expect(normalizeDoneLog(["xx"])).toBeUndefined();
    // 60 条合法递增日期（跨 8/9 月）→ 保留最近 50 条
    const many: string[] = [];
    for (let i = 0; i < 60; i++) {
      const d = new Date(2026, 6, 1 + i); // 2026-07-01 起连续 60 天
      many.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
    const capped = normalizeDoneLog(many)!;
    expect(capped).toHaveLength(50);
    expect(capped[0]).toBe(many[10]);
    expect(capped[49]).toBe(many[59]);
  });
});

describe("formatRepeat", () => {
  it("人话描述", () => {
    expect(formatRepeat({ kind: "daily" })).toBe("每天");
    expect(formatRepeat({ kind: "workday" })).toBe("工作日");
    expect(formatRepeat({ kind: "weekly", dow: 2 })).toBe("每周二");
    expect(formatRepeat({ kind: "weekly", dow: 0 })).toBe("每周日");
    expect(formatRepeat({ kind: "monthly", day: 1 })).toBe("每月1日");
  });
});
