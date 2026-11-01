import type { Task } from "./models";
import { effectiveDue } from "./repeat";

export type TaskSort = "dueDate" | "priority" | "title";

const collator = new Intl.Collator("zh-CN");

export function sortDisplayTasks(tasks: Task[], sort: TaskSort, today: string): Task[] {
  const date = (t: Task) => t.repeat ? effectiveDue(t, today) : t.dueDate;
  const byDate = (a: Task, b: Task) => {
    const left = date(a), right = date(b);
    if (!left) return right ? 1 : 0;
    if (!right) return -1;
    return left.localeCompare(right);
  };
  const byPriority = (a: Task, b: Task) => (b.priority ?? 0) - (a.priority ?? 0);
  const byTitle = (a: Task, b: Task) => collator.compare(a.title, b.title);
  const criteria = sort === "priority" ? [byPriority, byDate, byTitle]
    : sort === "title" ? [byTitle, byDate, byPriority]
    : [byDate, byPriority, byTitle];
  return [...tasks].sort((a, b) => criteria[0](a, b) || criteria[1](a, b) || criteria[2](a, b));
}
