import { describe, expect, it } from "vitest";
import type { Database, Task, TaskList } from "@/core/models";
import { emptyDatabase } from "@/core/operations";
import { buildSnapshot } from "./widget";

// 固定"今天"：2026-01-14（本地时区）
const NOW = new Date(2026, 0, 14, 8, 0, 0);
const TODAY = "2026-01-14";

let seq = 0;
function task(extra: Partial<Task> = {}): Task {
  seq += 1;
  const t = `2026-01-14T08:0${seq % 10}:00.000Z`;
  return {
    id: `t${seq}`,
    listId: "l1",
    title: `task-${seq}`,
    sortOrder: seq,
    completedAt: null,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    priority: 0,
    ...extra,
  };
}

const INBOX: TaskList = {
  id: "l1",
  name: "收集箱",
  color: "#000000",
  emoji: "📥",
  sortOrder: 0,
  createdAt: "2026-01-14T08:00:00.000Z",
  updatedAt: "2026-01-14T08:00:00.000Z",
  deletedAt: null,
};

function db(tasks: Task[]): Database {
  return { ...emptyDatabase(NOW), tasks, lists: [INBOX] };
}

describe("buildSnapshot", () => {
  it("今天到期的任务进入 today，并携带列表名与优先级", () => {
    const snap = buildSnapshot(
      db([task({ title: "交周报", dueDate: TODAY, priority: 3 })]),
      NOW,
    );
    expect(snap.today).toHaveLength(1);
    expect(snap.today[0]).toMatchObject({
      title: "交周报",
      listName: "收集箱",
      dueDate: TODAY,
      priority: 3,
    });
    expect(snap.counts.today).toBe(1);
  });

  it("高优先级任务即使没有到期日也进入 highPriority", () => {
    const snap = buildSnapshot(db([task({ title: "救火", priority: 3 })]), NOW);
    expect(snap.highPriority).toHaveLength(1);
    expect(snap.highPriority[0]?.title).toBe("救火");
    expect(snap.today).toHaveLength(0);
    expect(snap.counts.highPriority).toBe(1);
  });

  it("中/低/无优先级不进入 highPriority", () => {
    const snap = buildSnapshot(
      db([
        task({ priority: 2 }),
        task({ priority: 1 }),
        task({ priority: 0 }),
      ]),
      NOW,
    );
    expect(snap.highPriority).toHaveLength(0);
    expect(snap.counts.highPriority).toBe(0);
  });

  it("已过期任务进入 overdue 而非 today；逾期的高优任务两处都有", () => {
    const snap = buildSnapshot(
      db([
        task({ title: "旧账", dueDate: "2026-01-10", priority: 0 }),
        task({ title: "急旧账", dueDate: "2026-01-12", priority: 3 }),
      ]),
      NOW,
    );
    expect(snap.overdue.map((t) => t.title)).toEqual(["旧账", "急旧账"]);
    expect(snap.today).toHaveLength(0);
    expect(snap.highPriority.map((t) => t.title)).toEqual(["急旧账"]);
  });

  it("已完成与回收站中的任务不出现在任何列表", () => {
    const snap = buildSnapshot(
      db([
        task({ dueDate: TODAY, completedAt: "2026-01-14T09:00:00.000Z" }),
        task({ priority: 3, deletedAt: "2026-01-13T00:00:00.000Z" }),
      ]),
      NOW,
    );
    expect(snap.today).toHaveLength(0);
    expect(snap.highPriority).toHaveLength(0);
  });

  it("超过 10 条时截断列表但保留完整计数", () => {
    const tasks = Array.from({ length: 13 }, () => task({ priority: 3 }));
    const snap = buildSnapshot(db(tasks), NOW);
    expect(snap.highPriority).toHaveLength(10);
    expect(snap.counts.highPriority).toBe(13);
  });

  it("generatedAt 为 ISO 字符串", () => {
    const snap = buildSnapshot(db([]), NOW);
    expect(snap.generatedAt).toBe(NOW.toISOString());
  });
});
