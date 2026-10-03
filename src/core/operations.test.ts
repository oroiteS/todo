import { describe, expect, it } from "vitest";
import type { Database, Task } from "./models";
import {
  completedTodayCount,
  createList,
  createTask,
  emptyDatabase,
  emptyTrash,
  ensureInbox,
  normalizeDatabase,
  purgeOldTombstones,
  restoreTask,
  reorderTask,
  searchTasks,
  softDeleteList,
  softDeleteTask,
  sortTasks,
  tasksInList,
  todayTasks,
  toggleTask,
  trashTasks,
  updateTask,
  upcomingTasks,
} from "./operations";

const T0 = new Date(2026, 0, 14, 10, 0);
const TODAY = "2026-01-14";

function seed(): Database {
  let db = emptyDatabase(T0);
  ({ db } = createList(db, "收集箱", "#000000", "📥", T0));
  ({ db } = createList(db, "工作", "#111111", "💼", T0));
  return db;
}

function task(db: Database, id: string): Task {
  const t = db.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`task ${id} not found`);
  return t;
}

describe("tasks CRUD", () => {
  it("createTask 放入指定列表并置顶", () => {
    let db = seed();
    const inbox = db.lists[0];
    const a = createTask(db, { title: "A", listId: inbox.id }, T0);
    db = a.db;
    const b = createTask(db, { title: "B", listId: inbox.id }, T0);
    db = b.db;
    // b 创建更晚 -> sortOrder 更小 -> 排在最前
    expect(sortTasks(db.tasks.filter((t) => !t.deletedAt)).map((t) => t.title)).toEqual([
      "B",
      "A",
    ]);
  });

  it("toggleTask 完成/取消", () => {
    let db = seed();
    const inbox = db.lists[0];
    let r = createTask(db, { title: "A", listId: inbox.id }, T0);
    db = r.db;
    const id = r.task.id;
    db = toggleTask(db, id, T0);
    expect(task(db, id).completedAt).toBeTruthy();
    db = toggleTask(db, id, T0);
    expect(task(db, id).completedAt).toBeNull();
  });

  it("updateTask 合并 patch 且刷新 updatedAt", () => {
    let db = seed();
    const inbox = db.lists[0];
    let r = createTask(db, { title: "A", listId: inbox.id }, T0);
    db = r.db;
    const later = new Date(T0.getTime() + 60000);
    db = updateTask(db, r.task.id, { title: "A2", dueDate: TODAY }, later);
    const t = task(db, r.task.id);
    expect(t.title).toBe("A2");
    expect(t.dueDate).toBe(TODAY);
    expect(t.updatedAt).toBe(later.toISOString());
  });

  it("软删除 -> 回收站 -> 恢复 / 清空", () => {
    let db = seed();
    const inbox = db.lists[0];
    let r = createTask(db, { title: "A", listId: inbox.id }, T0);
    db = r.db;
    db = softDeleteTask(db, r.task.id, T0);
    expect(trashTasks(db)).toHaveLength(1);
    expect(tasksInList(db, inbox.id)).toHaveLength(0);
    db = restoreTask(db, r.task.id, T0);
    expect(trashTasks(db)).toHaveLength(0);
    db = softDeleteTask(db, r.task.id, T0);
    db = emptyTrash(db);
    expect(db.tasks).toHaveLength(0);
  });

  it("purgeOldTombstones 清理过期墓碑", () => {
    let db = seed();
    const inbox = db.lists[0];
    let r = createTask(db, { title: "A", listId: inbox.id }, T0);
    db = r.db;
    const old = new Date(T0.getTime() - 40 * 86400000);
    db = softDeleteTask(db, r.task.id, old);
    db = purgeOldTombstones(db, 30, T0);
    expect(db.tasks).toHaveLength(0);

    let db2 = seed();
    const r2 = createTask(db2, { title: "B", listId: db2.lists[0].id }, T0);
    db2 = r2.db;
    db2 = softDeleteTask(db2, r2.task.id, T0); // 新墓碑保留
    db2 = purgeOldTombstones(db2, 30, T0);
    expect(db2.tasks).toHaveLength(1);
  });

  it("reorderTask 移动到指定位置", () => {
    let db = seed();
    const inbox = db.lists[0];
    const ids: string[] = [];
    for (const title of ["A", "B", "C"]) {
      const r = createTask(db, { title, listId: inbox.id }, T0);
      db = r.db;
      ids.push(r.task.id);
    }
    // 创建顺序 A,B,C；sortOrder 递减 => 视图顺序 [C, B, A]
    const visible = ["C", "B", "A"].map(
      (title) => db.tasks.find((t) => t.title === title)!.id,
    );
    // 把 C 移到最后
    const db2 = reorderTask(db, visible[0], visible, 2);
    expect(
      sortTasks(db2.tasks.filter((t) => !t.deletedAt)).map((t) => t.title),
    ).toEqual(["B", "A", "C"]);
  });

  it("reorderTask 中点退化时归一化", () => {
    let db = seed();
    const inbox = db.lists[0];
    // 手工构造 sortOrder 相同的任务
    db = {
      ...db,
      tasks: [
        { ...mk("x", inbox.id, 5), title: "X" },
        { ...mk("y", inbox.id, 5), title: "Y" },
        { ...mk("z", inbox.id, 5), title: "Z" },
      ],
    };
    const visible = ["x", "y", "z"];
    const db2 = reorderTask(db, "z", visible, 1); // Z 移到 X 后
    const sorts = db2.tasks.map((t) => t.sortOrder);
    expect(new Set(sorts).size).toBe(sorts.length); // 全部唯一
    expect(
      sortTasks(db2.tasks.filter((t) => !t.deletedAt)).map((t) => t.title),
    ).toEqual(["X", "Z", "Y"]);
  });

  function mk(id: string, listId: string, sortOrder: number): Task {
    return {
      id,
      listId,
      title: id,
      sortOrder,
      completedAt: null,
      createdAt: T0.toISOString(),
      updatedAt: T0.toISOString(),
      deletedAt: null,
    };
  }
});

describe("smart queries", () => {
  it("todayTasks 含今天与逾期", () => {
    let db = seed();
    const inbox = db.lists[0];
    for (const [title, due] of [
      ["今天的事", TODAY],
      ["昨天的事", "2026-01-13"],
      ["下周的事", "2026-01-20"],
    ] as const) {
      const r = createTask(db, { title, listId: inbox.id, dueDate: due }, T0);
      db = r.db;
    }
    const titles = todayTasks(db, TODAY).map((t) => t.title);
    expect(titles).toContain("今天的事");
    expect(titles).toContain("昨天的事");
    expect(titles).not.toContain("下周的事");
    expect(upcomingTasks(db, TODAY).map((t) => t.title)).toEqual(["下周的事"]);
  });

  it("searchTasks 大小写不敏感且排除已完成/已删除", () => {
    let db = seed();
    const inbox = db.lists[0];
    const r1 = createTask(db, { title: "Buy Milk", listId: inbox.id }, T0);
    db = r1.db;
    const r2 = createTask(db, { title: "Other", listId: inbox.id, notes: "has MILK inside" }, T0);
    db = r2.db;
    const r3 = createTask(db, { title: "milk done", listId: inbox.id }, T0);
    db = r3.db;
    db = toggleTask(db, r3.task.id, T0);
    const hits = searchTasks(db, "milk").map((t) => t.title);
    // 排序为新创建在前（Other 比 Buy Milk 晚创建）
    expect(hits).toEqual(["Other", "Buy Milk"]);
  });

  it("completedTodayCount 统计今天完成", () => {
    let db = seed();
    const inbox = db.lists[0];
    const r = createTask(db, { title: "A", listId: inbox.id }, T0);
    db = r.db;
    expect(completedTodayCount(db, TODAY)).toBe(0);
    db = toggleTask(db, r.task.id, T0);
    expect(completedTodayCount(db, TODAY)).toBe(1);
  });
});

describe("lists", () => {
  it("softDeleteList 连带任务进入回收站", () => {
    let db = seed();
    const work = db.lists[1];
    const r = createTask(db, { title: "A", listId: work.id }, T0);
    db = r.db;
    db = softDeleteList(db, work.id, T0);
    expect(trashTasks(db)).toHaveLength(1);
    expect(db.lists.find((l) => l.id === work.id)!.deletedAt).toBeTruthy();
  });
});

describe("normalizeDatabase / ensureInbox", () => {
  it("垃圾输入返回空库", () => {
    expect(normalizeDatabase(null).tasks).toHaveLength(0);
    expect(normalizeDatabase("oops").lists).toHaveLength(0);
    expect(normalizeDatabase({ tasks: [{ id: 1 }] }).tasks).toHaveLength(0);
  });

  it("ensureInbox 幂等", () => {
    let db = ensureInbox(emptyDatabase(T0), T0);
    expect(db.lists.map((l) => l.name)).toEqual(["收集箱"]);
    db = ensureInbox(db, T0);
    expect(db.lists).toHaveLength(1);
  });
});
