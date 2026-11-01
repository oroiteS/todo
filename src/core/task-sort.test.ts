import { describe, expect, it } from "vitest";
import type { Task } from "./models";
import { sortDisplayTasks } from "./task-sort";

function task(id: string, patch: Partial<Task> = {}): Task {
  return { id, listId: "l", title: id, sortOrder: 0, createdAt: "2026-01-01", updatedAt: "2026-01-01", ...patch };
}
const ids = (tasks: Task[]) => tasks.map((t) => t.id);
const today = "2026-11-01";

describe("display task sorting", () => {
  it("sorts dates first, priority second and Chinese names third, leaving missing dates last", () => {
    const tasks = [task("none"), task("b", {title:"张", dueDate:"2026-11-01", priority:2}), task("a", {title:"李", dueDate:"2026-11-01", priority:2}), task("high", {dueDate:"2026-11-01", priority:3}), task("early", {dueDate:"2026-10-30"})];
    expect(ids(sortDisplayTasks(tasks, "dueDate", today))).toEqual(["early", "high", "a", "b", "none"]);
    expect(ids(tasks)).toEqual(["none", "b", "a", "high", "early"]);
  });
  it("sorts priority first then date then name, treating omitted priority as zero", () => {
    const tasks = [task("zero"), task("b", {title:"乙", priority:3, dueDate:"2026-11-02"}), task("a", {title:"甲", priority:3, dueDate:"2026-11-02"}), task("early", {priority:3, dueDate:"2026-11-01"}), task("low", {priority:1})];
    expect(ids(sortDisplayTasks(tasks, "priority", today))).toEqual(["early", "a", "b", "low", "zero"]);
  });
  it("sorts title first then date then priority and preserves ties", () => {
    const tasks = [task("z", {title:"张"}), task("low", {title:"李", dueDate:"2026-11-01", priority:1}), task("high", {title:"李", dueDate:"2026-11-01", priority:3}), task("earlier", {title:"李", dueDate:"2026-10-30"}), task("tie1", {title:"王"}), task("tie2", {title:"王"})];
    expect(ids(sortDisplayTasks(tasks, "title", today))).toEqual(["earlier", "high", "low", "tie1", "tie2", "z"]);
  });
  it("uses current occurrence of recurring tasks rather than stale anchors", () => {
    const tasks = [task("daily", {dueDate:"2026-01-01", repeat:{kind:"daily"}}), task("normal", {dueDate:"2026-10-31"})];
    expect(ids(sortDisplayTasks(tasks, "dueDate", today))).toEqual(["normal", "daily"]);
  });
});
