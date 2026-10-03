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
