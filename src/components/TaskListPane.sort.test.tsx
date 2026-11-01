import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskListPane } from "./TaskListPane";
import { useDataStore } from "@/stores/data";
import { useUiStore, type View } from "@/stores/ui";
import type { Task } from "@/core/models";

// React server rendering otherwise reads Zustand's initial server snapshot, not setState.
vi.mock("@/stores/data", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/stores/data")>();
  const actual = original.useDataStore;
  return { useDataStore: Object.assign((select: (s: ReturnType<typeof actual.getState>) => unknown) => select(actual.getState()), actual) };
});
vi.mock("@/stores/ui", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/stores/ui")>();
  const actual = original.useUiStore;
  return { ...original, useUiStore: Object.assign((select: (s: ReturnType<typeof actual.getState>) => unknown) => select(actual.getState()), actual) };
});

const originalDb = useDataStore.getState().db;
function task(id: string, patch: Partial<Task> = {}): Task {
  return { id, listId: "inbox", title: id, sortOrder: 0, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...patch };
}
function render(view: View, tasks: Task[], query = "", taskSort: "dueDate" | "priority" | "title" = "dueDate") {
  useDataStore.setState({ db: { ...originalDb, tasks, lists: [{ id: "inbox", name: "Inbox", emoji: "📋", color: "#000000", sortOrder: 0, createdAt: "2026-01-01", updatedAt: "2026-01-01" }] } });
  useUiStore.setState({ view, searchQuery: query, taskSort, showCompleted: true });
  return renderToStaticMarkup(<TaskListPane />);
}
function ordered(html: string, a: string, b: string) {
  expect(html.indexOf(a)).toBeGreaterThan(-1);
  expect(html.indexOf(b)).toBeGreaterThan(html.indexOf(a));
}
afterEach(() => { vi.useRealTimers(); useDataStore.setState({ db: originalDb }); });

describe("task sorting in views", () => {
  it("sorts all, custom, search and trash without changing completed grouping", () => {
    const items = [task("LateTask", {dueDate:"2026-11-03"}), task("EarlyTask", {dueDate:"2026-11-01"}), task("DoneTask", {dueDate:"2026-10-01", completedAt:"2026-10-20T00:00:00Z"})];
    for (const view of [{kind:"smart",id:"all"}, {kind:"list",id:"inbox"}] as View[]) {
      const html = render(view, items);
      ordered(html, "EarlyTask", "LateTask");
      ordered(html, "LateTask", "DoneTask");
      expect(html).toContain('aria-label="排序"');
      expect(html).not.toContain('aria-label="拖动排序"');
    }
    ordered(render({kind:"smart",id:"all"}, items, "Task"), "EarlyTask", "LateTask");
    const trash = render({kind:"trash"}, items.map(t => ({...t, deletedAt:"2026-11-01T00:00:00Z"})));
    ordered(trash, "EarlyTask", "LateTask");
    expect(trash).not.toContain('aria-label="排序"');
  });
  it("applies selected priority and title sort in the rendered view", () => {
    const items = [task("Zebra", {priority:3}), task("Apple", {priority:1})];
    const priority = render({kind:"smart", id:"all"}, items, "", "priority");
    ordered(priority, "Zebra", "Apple");
    expect(priority).toContain('value="priority" selected=""');
    const title = render({kind:"smart", id:"all"}, items, "", "title");
    ordered(title, "Apple", "Zebra");
    expect(title).toContain('value="title" selected=""');
  });
  it("sorts today and upcoming by due dates", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 1, 12));
    const today = [task("TodayLate", {dueDate:"2026-11-01"}), task("TodayEarly", {dueDate:"2026-10-31"})];
    ordered(render({kind:"smart",id:"today"}, today), "TodayEarly", "TodayLate");
    const next = [task("NextLate", {dueDate:"2026-11-04"}), task("NextEarly", {dueDate:"2026-11-02"})];
    ordered(render({kind:"smart",id:"upcoming"}, next), "NextEarly", "NextLate");
  });
});
