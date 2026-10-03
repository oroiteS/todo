import { Fragment, useRef, useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import type { Task } from "@/core/models";
import {
  listById,
  searchTasks,
  tasksInList,
  todayTasks,
  trashTasks,
  upcomingTasks,
} from "@/core/operations";
import { todayStr } from "@/core/dates";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";
import { cn } from "@/lib/cn";
import { QuickAdd } from "./QuickAdd";
import { TaskRow } from "./TaskRow";
import { EmptyState } from "./EmptyState";

const WEEKDAY = "日一二三四五六";

export function TaskListPane() {
  const db = useDataStore((s) => s.db);
  const view = useUiStore((s) => s.view);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const showCompleted = useUiStore((s) => s.showCompleted);
  const toggleShowCompleted = useUiStore((s) => s.toggleShowCompleted);
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const selectTask = useUiStore((s) => s.selectTask);
  const toggleTask = useDataStore((s) => s.toggleTask);
  const deleteTask = useDataStore((s) => s.deleteTask);
  const restoreTask = useDataStore((s) => s.restoreTask);
  const purgeTask = useDataStore((s) => s.purgeTask);
  const emptyTrash = useDataStore((s) => s.emptyTrash);
  const reorderTask = useDataStore((s) => s.reorderTask);

  const listRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ id: string; startIndex: number; target: number } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const today = todayStr();
  const searching = searchQuery.trim().length > 0;

  // ---------- 视图数据解析 ----------
  let tasks: Task[] = [];
  let title = "";
  let mode: "normal" | "trash" | "search" = "normal";
  let currentListId: string | undefined;
  let overdueCount = 0;
  let viewExists = true;

  if (searching) {
    mode = "search";
    tasks = searchTasks(db, searchQuery);
    title = "搜索结果";
  } else if (view.kind === "trash") {
    mode = "trash";
    tasks = trashTasks(db);
    title = "回收站";
  } else if (view.kind === "smart") {
    if (view.id === "today") {
      tasks = todayTasks(db, today);
      title = "今天";
      overdueCount = tasks.filter((t) => t.dueDate && t.dueDate < today).length;
    } else if (view.id === "upcoming") {
      tasks = upcomingTasks(db, today);
      title = "计划";
    } else {
      // 全部视图：所有未删除任务
      tasks = db.tasks
        .filter((t) => !t.deletedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
      title = "全部";
    }
  } else {
    const list = listById(db, view.id);
    if (!list || list.deletedAt) {
      viewExists = false;
      title = "列表不存在";
    } else {
      currentListId = list.id;
      tasks = tasksInList(db, list.id);
      title = `${list.emoji} ${list.name}`;
    }
  }

  const active = tasks.filter((t) => !t.completedAt);
  const done = tasks.filter((t) => t.completedAt);
  const activeIds = active.map((t) => t.id);
  const allowDrag = mode === "normal" && view.kind === "list" && viewExists;
  const showListChips = mode === "search" || view.kind === "smart";

  // ---------- 拖拽排序 ----------
  const beginDrag = (task: Task) => (e: React.PointerEvent) => {
    if (!allowDrag) return;
    e.preventDefault();
    const startIndex = activeIds.indexOf(task.id);
    if (startIndex < 0) return;
    dragState.current = { id: task.id, startIndex, target: startIndex };
    setDragId(task.id);
    setOverIndex(startIndex);

    const onMove = (ev: PointerEvent) => {
      const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-task-row]");
      if (!rows || !dragState.current) return;
      let idx = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          idx = i;
          break;
        }
      }
      dragState.current.target = idx;
      setOverIndex(idx);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const st = dragState.current;
      dragState.current = null;
      setDragId(null);
      setOverIndex(null);
      if (!st) return;
      let target = st.target;
      if (target > st.startIndex) target -= 1; // 移除自身后的下标
      if (target !== st.startIndex) {
        reorderTask(st.id, activeIds, target);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ---------- 头部 ----------
  const now = new Date();
  const headerRight =
    mode === "trash" && tasks.length > 0 ? (
      <button
        type="button"
        onClick={emptyTrash}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] text-ink3 transition-colors hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 size={13} />
        清空回收站
      </button>
    ) : null;

  const subtitle =
    mode === "search" ? (
      <span>{`${tasks.length} 个结果`}</span>
    ) : mode === "trash" ? (
      <span>{`${tasks.length} 个项目 · 保留 30 天后自动清理`}</span>
    ) : view.kind === "smart" && view.id === "today" ? (
      <span>
        {`${now.getMonth() + 1}月${now.getDate()}日 周${WEEKDAY[now.getDay()]} · ${active.length} 个待办`}
        {overdueCount > 0 && (
          <span className="text-danger">{` · ${overdueCount} 个已逾期`}</span>
        )}
      </span>
    ) : view.kind === "smart" && view.id === "upcoming" ? (
      <span>{`未来 7 天 · ${active.length} 个待办`}</span>
    ) : (
      <span>{`${active.length} 个待办`}</span>
    );

  const emptyState = (() => {
    if (mode === "search") {
      return <EmptyState emoji="🔍" title="没有找到相关任务" hint="换个关键词试试" />;
    }
    if (mode === "trash") {
      return <EmptyState emoji="🗑️" title="回收站是空的" hint="删除的任务会在这里保留 30 天" />;
    }
    if (!viewExists) {
      return <EmptyState emoji="🧭" title="列表不存在或已删除" />;
    }
    if (view.kind === "smart" && view.id === "today") {
      return active.length + done.length === 0 ? (
        <EmptyState emoji="☀️" title="今天没有安排" hint="享受当下，或在上方添加一个新任务" />
      ) : null;
    }
    if (view.kind === "smart" && view.id === "upcoming") {
      return <EmptyState emoji="🗓️" title="未来 7 天没有安排" hint="给未来一点计划吧" />;
    }
    if (view.kind === "smart") {
      return active.length + done.length === 0 ? (
        <EmptyState emoji="🌱" title="一切清零" hint="所有任务都处理完了" />
      ) : null;
    }
    return active.length + done.length === 0 ? (
      <EmptyState emoji="📝" title="列表还是空的" hint="在上方输入框添加第一个任务" />
    ) : null;
  })();

  const rowCommon = (t: Task) => ({
    task: t,
    list: listById(db, t.listId),
    selected: selectedTaskId === t.id && mode === "normal",
    onSelect: () =>
      selectTask(selectedTaskId === t.id ? null : t.id),
  });

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-end justify-between px-6 pb-3 pt-5">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
          <p className="mt-0.5 text-[13px] text-ink2">{subtitle}</p>
        </div>
        {headerRight}
      </header>

      {mode === "normal" && viewExists && <QuickAdd currentListId={currentListId} />}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-28">
        {active.length === 0 && done.length === 0 && emptyState}

        <div className="flex flex-col gap-0.5">
          {active.map((t, i) => (
            <Fragment key={t.id}>
              {mode === "normal" && dragId && overIndex === i && <Indicator />}
              <TaskRow
                {...rowCommon(t)}
                trashMode={mode === "trash"}
                onRestore={() => restoreTask(t.id)}
                onPurge={() => purgeTask(t.id)}
                dragging={mode === "normal" && dragId === t.id}
                dragHandleProps={
                  mode === "normal" && allowDrag
                    ? { onPointerDown: beginDrag(t) }
                    : undefined
                }
                onToggle={() => toggleTask(t.id)}
              />
            </Fragment>
          ))}
          {mode === "normal" && dragId && overIndex === active.length && <Indicator />}
        </div>

        {done.length > 0 && (
          <div className="mt-5">
            <button
              type="button"
              onClick={toggleShowCompleted}
              className="flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium text-ink3 transition-colors hover:bg-panel2 hover:text-ink2"
            >
              <ChevronDown
                size={13}
                className={cn("transition-transform duration-150", !showCompleted && "-rotate-90")}
              />
              已完成 · {done.length}
            </button>
            {showCompleted && (
              <div className="mt-1 flex flex-col gap-0.5">
                {done.map((t) => (
                  <TaskRow
                    key={t.id}
                    {...rowCommon(t)}
                    trashMode={mode === "trash"}
                    onRestore={() => restoreTask(t.id)}
                    onPurge={() => purgeTask(t.id)}
                    onToggle={() => toggleTask(t.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function Indicator() {
  return <div className="mx-3 h-[2px] shrink-0 rounded-full bg-accent/70" />;
}
