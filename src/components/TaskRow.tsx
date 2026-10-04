import { FileText, Flag, GripVertical, Undo2, X } from "lucide-react";
import type { Task, TaskList } from "@/core/models";
import { formatDue, isOverdue, isToday, todayStr } from "@/core/dates";
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
  /** 右键 / 移动端长按（坐标为光标位置） */
  onContextMenu?(x: number, y: number): void;
  /** 拖拽 */
  dragHandleProps?: {
    onPointerDown(e: React.PointerEvent): void;
  };
}

export function TaskRow(p: Props) {
  const { task } = p;
  const done = !!task.completedAt;

  return (
    <div
      data-task-row
      onClick={p.onSelect}
      onContextMenu={(e) => {
        if (!p.onContextMenu) return;
        e.preventDefault();
        p.onContextMenu(e.clientX, e.clientY);
      }}
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
  const done = !!task.completedAt;
  const due = task.dueDate;
  const hasNotes = !!task.notes?.trim();
  if ((!showList || !list) && !due && !hasNotes) return null;

  const overdue = !done && !!due && isOverdue(due);
  const today = !done && !!due && isToday(due, todayStr());

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
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
              : today
                ? "bg-warn/10 text-warn"
                : "bg-ink3/10 text-ink2",
          )}
        >
          {formatDue(due)}
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
