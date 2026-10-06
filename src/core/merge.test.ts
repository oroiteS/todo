import { describe, expect, it } from "vitest";
import type { Database, Task, TaskList } from "./models";
import { emptyDatabase } from "./operations";
import { mergeDatabases } from "./merge";

const T1 = "2026-01-14T08:00:00.000Z";
const T2 = "2026-01-14T09:00:00.000Z";
const T3 = "2026-01-14T10:00:00.000Z";

function task(id: string, updatedAt: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    listId: "l1",
    title: `task-${id}`,
    sortOrder: 0,
    completedAt: null,
    createdAt: T1,
    updatedAt,
    deletedAt: null,
    ...extra,
  };
}

function list(id: string, updatedAt: string, name?: string): TaskList {
  return {
    id,
    name: name ?? `list-${id}`,
    color: "#000000",
    emoji: "📋",
    sortOrder: 0,
    createdAt: T1,
    updatedAt,
    deletedAt: null,
  };
}

function db(tasks: Task[], lists: TaskList[] = [], lastSyncAt: string | null = null): Database {
  return { ...emptyDatabase(), tasks, lists, settings: { ...emptyDatabase().settings, lastSyncAt } };
}

describe("mergeDatabases", () => {
  it("并集：本地独有 + 远端独有都保留", () => {
    const local = db([task("a", T1)]);
    const remote = db([task("b", T1)]);
    const { merged } = mergeDatabases(local, remote);
    expect(merged.tasks.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("冲突：updatedAt 新者胜", () => {
    const local = db([task("a", T2, { title: "本地新标题" })]);
    const remote = db([task("a", T1, { title: "远端旧标题" })]);
    const { merged } = mergeDatabases(local, remote);
    expect(merged.tasks[0].title).toBe("本地新标题");

    const { merged: merged2 } = mergeDatabases(remote, local);
    expect(merged2.tasks[0].title).toBe("本地新标题");
  });

  it("墓碑传播：本地删除胜过远端旧修改", () => {
    const local = db([task("a", T3, { deletedAt: T3 })]);
    const remote = db([task("a", T2, { title: "远端修改" })]);
    const { merged } = mergeDatabases(local, remote);
    expect(merged.tasks[0].deletedAt).toBe(T3);
  });

  it("远端完成状态同步到本地", () => {
    const local = db([task("a", T1)]);
    const remote = db([task("a", T2, { completedAt: T2 })]);
    const { merged } = mergeDatabases(local, remote);
    expect(merged.tasks[0].completedAt).toBe(T2);
  });

  it("列表按相同规则合并", () => {
    const local = db([], [list("l1", T1), list("l2", T1)]);
    const remote = db([], [list("l1", T2, "改名了"), list("l3", T1)]);
    const { merged } = mergeDatabases(local, remote);
    expect(merged.lists.map((l) => l.id).sort()).toEqual(["l1", "l2", "l3"]);
    expect(merged.lists.find((l) => l.id === "l1")!.name).toBe("改名了");
  });

  it("settings 本地优先，lastSyncAt 取较新", () => {
    const local = db([], [], T1);
    local.settings.theme = "dark";
    const remote = db([], [], T2);
    remote.settings.theme = "light";
    const { merged } = mergeDatabases(local, remote);
    expect(merged.settings.theme).toBe("dark");
    expect(merged.settings.lastSyncAt).toBe(T2);
  });

  it("幂等：merge(a,b) 之后再与 b 合并不变", () => {
    const a = db([task("a", T2, { title: "本地" }), task("b", T1)]);
    const b = db([task("a", T1), task("c", T2, { completedAt: T2 })]);
    const once = mergeDatabases(a, b).merged;
    const twice = mergeDatabases(once, b).merged;
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

// ---------- 收集箱去重（多设备各首启一个的同名默认列表） ----------

function inboxList(id: string, createdAt: string): TaskList {
  return { ...list(id, createdAt, "收集箱"), createdAt };
}

describe("mergeDatabases / 收集箱去重", () => {
  const inboxA = inboxList("inbox-a", T1); // 最早创建 → 保留
  const inboxB = inboxList("inbox-b", T2);
  const inboxC = inboxList("inbox-c", T3);
  const taskOf = (id: string, listId: string) => task(id, T1, { listId });

  const a = db([taskOf("t1", "inbox-a")], [inboxA]);
  const b = db([taskOf("t2", "inbox-b")], [inboxB]);
  const c = db([taskOf("t3", "inbox-c")], [inboxC]);
  const NOW = new Date("2026-01-14T12:00:00.000Z");

  it("三设备合并后只保留一个收集箱，任务并入最早的", () => {
    const { merged } = mergeDatabases(mergeDatabases(a, b, NOW).merged, c, NOW);
    const live = merged.lists.filter((l) => !l.deletedAt && l.name === "收集箱");
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe("inbox-a");
    const dups = merged.lists.filter((l) => l.id !== "inbox-a");
    expect(dups).toHaveLength(2);
    expect(dups.every((l) => l.deletedAt !== null)).toBe(true);
    expect(merged.tasks.map((t) => t.listId)).toEqual(["inbox-a", "inbox-a", "inbox-a"]);
    expect(merged.tasks.map((t) => t.title)).toEqual(["task-t1", "task-t2", "task-t3"]);
  });

  it("合并满足交换律：merge(a,b) 与 merge(b,a) 结果一致（数组顺序无关）", () => {
    const byId = <T extends { id: string }>(xs: T[]) =>
      JSON.stringify([...xs].sort((x, y) => (x.id < y.id ? -1 : 1)));
    const ab = mergeDatabases(a, b, NOW).merged;
    const ba = mergeDatabases(b, a, NOW).merged;
    expect(byId(ab.lists)).toBe(byId(ba.lists));
    expect(byId(ab.tasks)).toBe(byId(ba.tasks));
  });

  it("同名但已改名的列表不受影响；单个收集箱不触发去重", () => {
    const renamed = { ...list("work", T2), name: "工作" };
    const single = db([], [inboxA, renamed]);
    const { merged } = mergeDatabases(single, db([], []), NOW);
    expect(merged.lists.filter((l) => !l.deletedAt)).toHaveLength(2);
    expect(merged.lists.find((l) => l.id === "inbox-a")?.deletedAt).toBeNull();
  });
});

describe("mergeDatabases — 永久删除墓碑（purged，清空回收站不复活）", () => {
  const NOW = new Date("2026-01-14T12:00:00.000Z");

  it("回归：本地清空回收站后，远端残影不复活", () => {
    // macOS 清空回收站（硬删 + 墓碑），Android 还在用旧快照（任务仍在）
    const local = { ...db([]), purged: { x: T2 } };
    const remote = db([task("x", T1, { deletedAt: T1 })]);
    const { merged, changed } = mergeDatabases(local, remote, NOW);
    expect(merged.tasks.map((t) => t.id)).not.toContain("x");
    expect(merged.purged).toEqual({ x: T2 });
    expect(changed).toBe(true); // 需要把墓碑推给远端
  });

  it("两侧各自硬删不同任务：墓碑并集，残影全丢", () => {
    const local = { ...db([task("b", T1, { deletedAt: T1 })]), purged: { a: T2 } };
    const remote = { ...db([task("a", T1, { deletedAt: T1 })]), purged: { b: T2 } };
    const { merged } = mergeDatabases(local, remote, NOW);
    expect(merged.tasks).toHaveLength(0);
    expect(merged.purged).toEqual({ a: T2, b: T2 });
  });

  it("墓碑之后任务又被修改/恢复 → 任务生效，墓碑撤销", () => {
    // Android 在墓碑时间之后恢复了任务（updatedAt 更新）→ 恢复赢，不摆
    const local = { ...db([]), purged: { x: T2 } };
    const remote = db([task("x", T3, { deletedAt: null, title: "改了" })]);
    const { merged } = mergeDatabases(local, remote, NOW);
    expect(merged.tasks.map((t) => t.id)).toEqual(["x"]);
    expect(merged.tasks[0]?.title).toBe("改了");
    expect(merged.purged).toEqual({});
  });

  it("墓碑与任务 updatedAt 相等也算删除生效", () => {
    const local = { ...db([]), purged: { x: T1 } };
    const remote = db([task("x", T1)]);
    const { merged } = mergeDatabases(local, remote, NOW);
    expect(merged.tasks).toHaveLength(0);
  });

  it("幂等：合并结果再与远端合并，结果不变", () => {
    const local = { ...db([]), purged: { x: T2 } };
    const remote = db([task("x", T1, { deletedAt: T1 })]);
    const once = mergeDatabases(local, remote, NOW).merged;
    const twice = mergeDatabases(once, remote, NOW).merged;
    expect(twice.tasks).toEqual(once.tasks);
    expect(twice.purged).toEqual(once.purged);
  });
});
