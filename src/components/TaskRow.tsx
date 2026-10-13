import { FileText, Flag, GripVertical, Repeat, Undo2, X } from "lucide-react";
import type { Task, TaskList } from "@/core/models";
import { formatDue, isOverdue, isToday, todayStr } from "@/core/dates";
import { effectiveDue, formatRepeat, recurringDone } from "@/core/repeat";
import { cn } from "@/lib/cn";
import { Checkbox } from "./Checkbox";

interface Props {
  task: Task;
  list?: TaskList;
  showList?: boolean;
  selected?: boolean;
  dragging?: boolean;
  onToggle(): void;
  onSelect(): void;
  /** 回收站操作 */
  trashMode?: boolean;
  onRestore?(): void;
  onPurge?(): void;
  /** 拖拽 */
  dragHandleProps?: {
    onPointerDown(e: React.PointerEvent): void;
  };
}

export function TaskRow(p: Props) {
  const { task } = p;
  // 重复任务的「打卡完成」态：completedAt 恒空，由 doneLog + dueDate 推导
  // （勾掉后划掉到下一次发生日的 0 点，跨天自动复原，无需任何刷新）
  const today = todayStr();
  const recurringFinished = task.repeat ? recurringDone(task, today) : false;
  const done = !!task.completedAt || recurringFinished;

  return (
    <div
      data-task-row
      onClick={p.onSelect}
      className={cn(
        "group relative flex cursor-default items-start gap-3 rounded-xl px-3 py-2.5 transition-colors",
        p.selected ? "bg-accent-soft" : "hover:bg-panel2",
        p.dragging && "opacity-30",
      )}
    >
      {p.trashMode ? (
        <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center">
          <TrashBadge />
        </span>
      ) : (
        <div className="pt-px">
          <Checkbox done={done} onChange={p.onToggle} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "strike truncate text-sm leading-5",
            done ? "on text-ink3" : "text-ink",
          )}
        >
          {task.title}
        </div>
        <RowChips task={task} list={p.list} showList={p.showList} />
      </div>

      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        {p.trashMode ? (
          <>
            <RowAction label="恢复" onClick={p.onRestore}>
              <Undo2 size={14} />
            </RowAction>
            <RowAction label="彻底删除" danger onClick={p.onPurge}>
              <X size={14} />
            </RowAction>
          </>
        ) : (
          <>
            {!done && !!task.priority && task.priority > 0 && (
              <Flag
                size={13}
                className={cn(
                  task.priority === 3 && "fill-current text-danger",
                  task.priority === 2 && "text-warn",
                  task.priority === 1 && "text-ink3",
                )}
              />
            )}
            {p.dragHandleProps && (
              <button
                type="button"
                aria-label="拖动排序"
                onPointerDown={p.dragHandleProps.onPointerDown}
                className="hidden h-6 w-5 cursor-grab items-center justify-center rounded text-ink3 opacity-0 transition-opacity hover:text-ink2 active:cursor-grabbing group-hover:opacity-100 md:flex"
              >
                <GripVertical size={14} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TrashBadge() {
  return <span className="text-[13px] opacity-60">🗑️</span>;
}

function RowAction({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick?(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md text-ink3 opacity-0 transition-all hover:bg-panel2 group-hover:opacity-100",
        danger ? "hover:text-danger" : "hover:text-ok",
      )}
    >
      {children}
    </button>
  );
}

function RowChips({
  task,
  list,
  showList,
}: {
  task: Task;
  list?: TaskList;
  showList?: boolean;
}) {
  const today = todayStr();
  const recurringFinished = task.repeat ? recurringDone(task, today) : false;
  const done = !!task.completedAt || recurringFinished;
  // 重复任务按当期发生日口径展示（拖了没打卡显示今天/未来，不显示逾期）；
  // 打卡态下隐藏日期角标，只留重复角标（划掉行更干净）
  const due = task.repeat
    ? recurringFinished
      ? undefined
      : effectiveDue(task, today)
    : task.dueDate;
  const hasNotes = !!task.notes?.trim();
  if ((!showList || !list) && !due && !hasNotes && !task.repeat) return null;

  const overdue = !done && !!due && !task.repeat && isOverdue(due, today);
  const todayDue = !done && !!due && isToday(due, today);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {task.repeat && (
        <span
          className={cn(
            "flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
            recurringFinished ? "bg-ok/10 text-ok" : "bg-accent-soft text-accent",
          )}
        >
          <Repeat size={10} />
          {formatRepeat(task.repeat)}
        </span>
      )}
      {showList && list && (
        <span className="flex items-center gap-1 text-[11px] text-ink2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: list.color }}
          />
          {list.emoji} {list.name}
        </span>
      )}
      {due && (
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
            overdue
              ? "bg-danger/10 text-danger"
              : todayDue
                ? "bg-warn/10 text-warn"
                : "bg-ink3/10 text-ink2",
          )}
        >
          {formatDue(due, today)}
        </span>
      )}
      {hasNotes && (
        <span className="flex items-center text-ink3">
          <FileText size={11} />
        </span>
      )}
    </div>
  );
}
