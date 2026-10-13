import { useEffect, useRef, type ComponentProps } from "react";
import { Check, Trash2, X } from "lucide-react";
import type { Priority, RepeatRule, Task } from "@/core/models";
import { addDays, mondayBasedDow, todayStr } from "@/core/dates";
import { formatRepeat, recurringDone } from "@/core/repeat";
import { listById, visibleLists } from "@/core/operations";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { Checkbox } from "./Checkbox";
import { DatePicker } from "./DatePicker";

const PRIORITY_META: Array<{ value: Priority; label: string; cls: string }> = [
  { value: 0, label: "无", cls: "text-ink2" },
  { value: 1, label: "低", cls: "text-ink2" },
  { value: 2, label: "中", cls: "text-warn" },
  { value: 3, label: "高", cls: "text-danger" },
];

function AutoTextarea({ value, className, ...rest }: ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(resize, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      onInput={resize}
      value={value}
      {...rest}
      className={cn("w-full resize-none bg-transparent outline-none", className)}
    />
  );
}

const fieldCls =
  "w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none transition-colors focus:border-accent/60";
const labelCls = "mb-1.5 block text-[11px] font-semibold tracking-widest text-ink3";

export function DetailPane() {
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const selectTask = useUiStore((s) => s.selectTask);
  const db = useDataStore((s) => s.db);
  const updateTask = useDataStore((s) => s.updateTask);
  const toggleTask = useDataStore((s) => s.toggleTask);
  const deleteTask = useDataStore((s) => s.deleteTask);

  const task = db.tasks.find((t) => t.id === selectedTaskId) ?? null;
  if (!task) return null;

  const lists = visibleLists(db);
  const list = listById(db, task.listId);
  const today = todayStr();
  const nextMonday = addDays(today, ((7 - mondayBasedDow(new Date())) % 7) || 7);

  const patch = (
    p: Partial<Pick<Task, "title" | "notes" | "dueDate" | "priority" | "listId" | "repeat">>,
  ) => updateTask(task.id, p);

  const repeatDone = task.repeat ? recurringDone(task, today) : false;

  const createdAt = new Date(task.createdAt);
  const createdLabel = `${createdAt.getMonth() + 1}月${createdAt.getDate()}日 ${String(createdAt.getHours()).padStart(2, "0")}:${String(createdAt.getMinutes()).padStart(2, "0")}`;

  return (
    <div className="row-in fixed inset-0 z-40 flex-col gap-5 overflow-y-auto bg-bg p-5 md:static md:z-auto md:flex md:w-[340px] md:shrink-0 md:border-l md:border-line md:bg-panel">
      {/* 顶部操作 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-widest text-ink3">
          任务详情
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={
              task.completedAt || repeatDone ? "标记为未完成" : "标记为完成"
            }
            onClick={() => toggleTask(task.id)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
              task.completedAt || repeatDone
                ? "text-ok hover:bg-ok/10"
                : "text-ink3 hover:bg-panel2 hover:text-ok",
            )}
          >
            <Check size={16} />
          </button>
          <button
            type="button"
            title="移入回收站"
            onClick={() => {
              deleteTask(task.id);
              selectTask(null);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 size={15} />
          </button>
          <button
            type="button"
            title="关闭"
            aria-label="关闭"
            onClick={() => selectTask(null)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-panel2 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 标题 */}
      <AutoTextarea
        value={task.title}
        onChange={(e) => patch({ title: e.target.value })}
        placeholder="任务标题"
        className="border-l-2 border-transparent pl-1.5 text-[17px] font-semibold leading-relaxed transition-colors placeholder:text-ink3 hover:border-line focus:border-accent"
      />

      {/* 到期日 */}
      <section className="rounded-2xl bg-panel2/50 p-3.5">
        <span className={labelCls}>到期时间</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { label: "今天", value: today },
            { label: "明天", value: addDays(today, 1) },
            { label: "下周一", value: nextMonday },
          ].map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => patch({ dueDate: q.value })}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs transition-colors",
                task.dueDate === q.value
                  ? "bg-accent-soft font-medium text-accent"
                  : "bg-bg text-ink2 hover:text-ink",
              )}
            >
              {q.label}
            </button>
          ))}
        </div>
        <div className="mt-2">
          <DatePicker value={task.dueDate} onChange={(v) => patch({ dueDate: v })} />
        </div>
        {task.repeat && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink3">
            {formatRepeat(task.repeat)}重复 · 勾选完成后自动滚到下一次，划掉状态持续到当期结束
          </p>
        )}
      </section>

      {/* 重复 */}
      <section className="rounded-2xl bg-panel2/50 p-3.5">
        <span className={labelCls}>重复</span>
        <div className="flex gap-1.5">
          {(
            [
              { label: "不重复", active: !task.repeat, rule: undefined },
              { label: "每天", active: task.repeat?.kind === "daily", rule: { kind: "daily" as const } },
              {
                label: "工作日",
                active: task.repeat?.kind === "workday",
                rule: { kind: "workday" as const },
              },
            ] as Array<{ label: string; active: boolean; rule: RepeatRule | undefined }>
          ).map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => patch({ repeat: q.rule })}
              className={cn(
                "flex h-7 flex-1 items-center justify-center rounded-lg text-xs transition-colors",
                q.active
                  ? "bg-panel2 font-semibold shadow-sm text-accent"
                  : "text-ink3 hover:bg-panel2/60",
              )}
            >
              {q.label}
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1">
          {Array.from("日一二三四五六").map((ch, dow) => {
            const active =
              task.repeat?.kind === "weekly" && task.repeat.dow === dow;
            return (
              <button
                key={dow}
                type="button"
                onClick={() => patch({ repeat: { kind: "weekly", dow } })}
                className={cn(
                  "h-7 flex-1 rounded-lg text-xs transition-colors",
                  active
                    ? "bg-panel2 font-semibold shadow-sm text-accent"
                    : "text-ink3 hover:bg-panel2/60",
                )}
              >
                {ch}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span
            className={cn(
              "rounded-lg px-2 py-1 text-xs transition-colors",
              task.repeat?.kind === "monthly"
                ? "bg-panel2 font-semibold text-accent"
                : "text-ink3",
            )}
          >
            每月
          </span>
          <select
            value={task.repeat?.kind === "monthly" ? task.repeat.day : ""}
            onChange={(e) => {
              const day = Number(e.target.value);
              if (day >= 1) patch({ repeat: { kind: "monthly", day } });
            }}
            aria-label="每月重复日"
            className={cn(fieldCls, "w-24 py-1")}
          >
            <option value="">选择日…</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d} 日
              </option>
            ))}
          </select>
          {task.repeat?.kind === "monthly" && (
            <span className="text-[11px] text-ink3">大月无该日自动落到月末</span>
          )}
        </div>
      </section>

      {/* 优先级 */}
      <section className="rounded-2xl bg-panel2/50 p-3.5">
        <span className={labelCls}>优先级</span>
        <div className="flex gap-1.5">
          {PRIORITY_META.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => patch({ priority: p.value })}
              className={cn(
                "flex h-7 flex-1 items-center justify-center gap-1 rounded-lg text-xs transition-colors",
                (task.priority ?? 0) === p.value
                  ? cn("bg-panel2 font-semibold shadow-sm", p.cls)
                  : "text-ink3 hover:bg-panel2/60",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {/* 所属列表 */}
      <section className="rounded-2xl bg-panel2/50 p-3.5">
        <span className={labelCls}>所属列表</span>
        <div className="flex items-center gap-2">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[13px]"
            style={{
              background: `${list?.color ?? "#57534e"}22`,
              boxShadow: `inset 0 0 0 1px ${list?.color ?? "#57534e"}55`,
            }}
          >
            {list?.emoji ?? "❔"}
          </span>
          <select
            value={task.listId}
            onChange={(e) => patch({ listId: e.target.value })}
            className={cn(fieldCls, "py-1")}
          >
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.emoji} {l.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* 备注 */}
      <section className="flex min-h-24 flex-1 flex-col rounded-2xl bg-panel2/50 p-3.5">
        <span className={labelCls}>备注</span>
        <AutoTextarea
          value={task.notes ?? ""}
          onChange={(e) => patch({ notes: e.target.value || undefined })}
          placeholder="补充说明…"
          className="min-h-20 flex-1 rounded-lg border border-line bg-bg px-2.5 py-2 text-[13px] leading-relaxed transition-colors placeholder:text-ink3 focus:border-accent/60"
        />
      </section>

      {/* 元信息 */}
      <div className="space-y-1 text-[11px] leading-relaxed text-ink3">
        <p>创建于 {createdLabel}</p>
        <p>更新于 {formatRelativeTime(task.updatedAt)}</p>
        {task.completedAt && (
          <p className="text-ok">完成于 {formatRelativeTime(task.completedAt)}</p>
        )}
      </div>
    </div>
  );
}
