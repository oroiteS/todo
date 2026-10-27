// TaskRow 行内角标回归测试：已完成任务的日期角标只显示完成时间，
// 不得出现「逾期 N 天」，且文案不随今天推移而增长。

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Task } from "@/core/models";
import { TaskRow } from "./TaskRow";

function task(p: Partial<Task> = {}): Task {
  return {
    id: "t1",
    listId: "l1",
    title: "打印练习册",
    sortOrder: 0,
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

/** 渲染一行，剥掉标签只留可见文本 */
function rowText(t: Task): string {
  return renderToStaticMarkup(
    <TaskRow task={t} onToggle={() => {}} onSelect={() => {}} />,
  ).replace(/<[^>]+>/g, " ");
}

/** vitest 里可注入的「今天」：用真实今天构造相对日期，避免依赖系统时钟 */
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function dateDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

describe("TaskRow 已完成任务的日期角标", () => {
  it("逾期 10 天后才完成 → 显示完成时间，不显示「逾期」", () => {
    const text = rowText(
      task({ dueDate: dateDaysAgo(10), completedAt: isoDaysAgo(10) }),
    );
    expect(text).not.toContain("逾期");
    expect(text).toMatch(/完成/);
  });

  it("完成后隔了 20 天再看：文案不变、仍不含「逾期」", () => {
    const completedAt = isoDaysAgo(20);
    const text = rowText(task({ dueDate: dateDaysAgo(20), completedAt }));
    expect(text).not.toContain("逾期");
    expect(text).toContain("完成");
  });

  it("未完成的逾期任务仍然要显示「逾期 N 天」", () => {
    const text = rowText(task({ dueDate: dateDaysAgo(4), completedAt: null }));
    expect(text).toContain("逾期 4 天");
  });
});
