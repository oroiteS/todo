// 重复任务在 operations 层的核心行为：完成滚动、取消回滚、补勾不堆逾期、
// 跨 0 点自然复原、normalize 透传兼容。全部注入固定 today，纯函数可复现。

import { describe, expect, it } from "vitest";
import type { Database, Task } from "./models";
import {
  completedTodayCount,
  createTask,
  normalizeDatabase,
  todayTasks,
  toggleTask,
  upcomingTasks,
  updateTask,
} from "./operations";
import { recurringDone } from "./repeat";

// 固定“今天”：2026-01-14（周三）
const NOW = new Date(2026, 0, 14, 12, 0);
const TODAY = "2026-01-14";

function dbWith(tasks: Partial<Task>[]): Database {
  return {
    schemaVersion: 1,
    tasks: tasks.map((t, i) => ({
      id: t.id ?? `t${i}`,
      listId: "l1",
      title: t.title ?? "任务",
      sortOrder: t.sortOrder ?? i,
      completedAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
      ...t,
    })) as Task[],
    lists: [],
    purged: {},
    settings: {} as Database["settings"],
  };
}

const dailyDueToday = dbWith([
  { id: "w", title: "背单词", dueDate: TODAY, repeat: { kind: "daily" } },
]);

describe("toggleTask 重复任务", () => {
  it("勾选：记当期打卡 + 锚点滚到明天，completedAt 保持空（永远留在列表）", () => {
    const db = toggleTask(dailyDueToday, "w", NOW);
    const t = db.tasks[0];
    expect(t.dueDate).toBe("2026-01-15");
    expect(t.doneLog).toEqual([TODAY]);
    expect(t.completedAt).toBeNull();
    // 划掉态：今天算完成，明天不算
    expect(recurringDone(t, TODAY)).toBe(true);
    expect(recurringDone(t, "2026-01-15")).toBe(false);
  });

  it("取消勾选：精确逆向回滚到今天", () => {
    const done = toggleTask(dailyDueToday, "w", NOW);
    const restored = toggleTask(done, "w", NOW);
    const t = restored.tasks[0];
    expect(t.dueDate).toBe(TODAY);
    expect(t.doneLog).toBeUndefined();
    expect(recurringDone(t, TODAY)).toBe(false);
  });

  it("补勾不堆逾期：拖 3 天没打卡，勾一次直接滚到明天", () => {
    const db = dbWith([
      { id: "w", title: "背单词", dueDate: "2026-01-11", repeat: { kind: "daily" } },
    ]);
    const t = toggleTask(db, "w", NOW).tasks[0];
    expect(t.dueDate).toBe("2026-01-15"); // 明天，而不是 01-12
    expect(t.doneLog).toEqual([TODAY]); // 记的是当期（今天），不是 3 天前
  });

  it("每周任务保持周网格：周三勾掉周二的会，滚到下周二", () => {
    const db = dbWith([
      { id: "m", title: "组会", dueDate: "2026-01-13", repeat: { kind: "weekly", dow: 2 } },
    ]);
    const t = toggleTask(db, "m", NOW).tasks[0]; // 01-14 周三勾
    expect(t.dueDate).toBe("2026-01-20"); // 下周二，网格不漂移
    expect(t.doneLog).toEqual(["2026-01-13"]); // 记的是发生日（周二）
  });

  it("提前勾：锚点在未来时按锚点记当期", () => {
    const db = dbWith([
      { id: "m", title: "组会", dueDate: "2026-01-20", repeat: { kind: "weekly", dow: 2 } },
    ]);
    const t = toggleTask(db, "m", NOW).tasks[0]; // 周三提前勾下周二的
    expect(t.doneLog).toEqual(["2026-01-20"]);
    expect(t.dueDate).toBe("2026-01-27");
  });

  it("跨 0 点复原：勾选次日重新出现在今天视图（纯推导，无状态刷新）", () => {
    const done = toggleTask(dailyDueToday, "w", NOW); // 01-14 勾 → due 01-15
    // 当天：划掉、留在今天视图
    expect(recurringDone(done.tasks[0], TODAY)).toBe(true);
    expect(todayTasks(done, TODAY).map((t) => t.id)).toContain("w");
    // 次日视角：复原为未完成，仍然是今天视图的待办
    const next = "2026-01-15";
    expect(recurringDone(done.tasks[0], next)).toBe(false);
    expect(todayTasks(done, next).map((t) => t.id)).toContain("w");
  });
});

describe("重复任务的视图口径", () => {
  it("今天视图：当期到期或打卡态都可见；锚点过期的每天任务按今天呈现", () => {
    const db = dbWith([
      { id: "stale", dueDate: "2026-01-11", repeat: { kind: "daily" } },
      { id: "future", dueDate: "2026-01-20", repeat: { kind: "weekly", dow: 2 } },
    ]);
    const ids = todayTasks(db, TODAY).map((t) => t.id);
    expect(ids).toContain("stale"); // 拖了没打开 → 今天
    expect(ids).not.toContain("future"); // 下周二的 → 计划视图
    expect(upcomingTasks(db, TODAY).map((t) => t.id)).toContain("future");
  });

  it("已完成计数：打卡日志计入今日完成", () => {
    const done = toggleTask(dailyDueToday, "w", NOW);
    expect(completedTodayCount(done, TODAY)).toBe(1);
    expect(completedTodayCount(done, "2026-01-15")).toBe(0);
  });

  it("createTask：重复任务无日期自动锚定当期", () => {
    const { task } = createTask(dailyDueToday, { title: "背单词", repeat: { kind: "daily" } }, NOW);
    expect(task.dueDate).toBe(TODAY);
    const { task: weekly } = createTask(
      dailyDueToday,
      { title: "组会", repeat: { kind: "weekly", dow: 5 } },
      NOW,
    );
    expect(weekly.dueDate).toBe("2026-01-16"); // 最近一个周五
  });

  it("updateTask：清除规则清掉打卡日志；过期锚点换新规则自动重锚", () => {
    const done = toggleTask(dailyDueToday, "w", NOW);
    const plain = updateTask(done, "w", { repeat: undefined }, NOW);
    expect(plain.tasks[0].repeat).toBeUndefined();
    expect(plain.tasks[0].doneLog).toBeUndefined();

    const db = dbWith([
      { id: "m", title: "旧任务", dueDate: "2026-01-05", repeat: { kind: "daily" } },
    ]);
    const moved = updateTask(db, "m", { repeat: { kind: "weekly", dow: 5 } }, NOW);
    expect(moved.tasks[0].dueDate).toBe("2026-01-16"); // 过期锚点 → 最近周五
    const movedTue = updateTask(db, "m", { repeat: { kind: "weekly", dow: 2 } }, NOW);
    expect(movedTue.tasks[0].dueDate).toBe("2026-01-20"); // 过期锚点 → 下一个周二
    // 锚点仍在未来的保留原锚点，作为新规则第一个截止日
    const future = dbWith([
      { id: "m", title: "旧任务", dueDate: "2026-01-20", repeat: { kind: "daily" } },
    ]);
    expect(
      updateTask(future, "m", { repeat: { kind: "weekly", dow: 2 } }, NOW).tasks[0].dueDate,
    ).toBe("2026-01-20");
  });
});

describe("normalizeDatabase 兼容", () => {
  it("repeat/doneLog 清洗：非法输入不炸、合法输入保留", () => {
    const db = normalizeDatabase({
      tasks: [
        {
          id: "a",
          listId: "l1",
          title: "背单词",
          sortOrder: 0,
          repeat: { kind: "daily" },
          doneLog: ["2026-01-14", "bad", "2026-01-14"],
        },
        {
          id: "b",
          listId: "l1",
          title: "坏的",
          sortOrder: 1,
          repeat: { kind: "weekly", dow: 9 },
          doneLog: "not-array",
        },
      ],
    });
    expect(db.tasks[0].repeat).toEqual({ kind: "daily" });
    expect(db.tasks[0].doneLog).toEqual(["2026-01-14"]);
    expect(db.tasks[1].repeat).toBeUndefined();
    expect(db.tasks[1].doneLog).toBeUndefined();
  });

  it("未知字段透传：新版本字段经旧版本 normalize 不丢失（防同步绞杀）", () => {
    const raw = {
      tasks: [
        {
          id: "a",
          listId: "l1",
          title: "任务",
          sortOrder: 0,
          // 模拟未来版本新增字段
          someFutureField: { nested: [1, 2, 3] },
          anotherOne: "keep-me",
        },
      ],
    };
    const out = normalizeDatabase(raw) as unknown as {
      tasks: Array<Record<string, unknown>>;
    };
    expect(out.tasks[0].someFutureField).toEqual({ nested: [1, 2, 3] });
    expect(out.tasks[0].anotherOne).toBe("keep-me");
  });
});
