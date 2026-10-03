import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { parseQuickAdd } from "@/core/quickparse";
import { visibleLists } from "@/core/operations";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";

/**
 * 智能快速输入：
 *   明天 交报告 #工作 !高    周五 开会    3月8日 回家 !!
 * 支持日期词（今天/明天/后天/周X/下周X/M月D日/M/D）、!优先级、#已有列表。
 */
export function QuickAdd({ currentListId }: { currentListId?: string }) {
  const [text, setText] = useState("");
  const addTask = useDataStore((s) => s.addTask);
  const db = useDataStore((s) => s.db);
  const lists = useMemo(() => visibleLists(db), [db]);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const raw = text.trim();
    if (!raw) return;
    const parsed = parseQuickAdd(raw);
    if (!parsed.title) return;

    // 列表解析：#列表名 匹配已有列表（精确 -> 前缀），否则落在当前列表
    let listId = currentListId ?? lists[0]?.id;
    if (parsed.listQuery) {
      const q = parsed.listQuery.toLowerCase();
      const hit =
        lists.find((l) => l.name.toLowerCase() === q) ??
        lists.find((l) => l.name.toLowerCase().startsWith(q));
      if (hit) listId = hit.id;
    }
    if (!listId) return;

    addTask({
      title: parsed.title,
      dueDate: parsed.dueDate,
      priority: parsed.priority,
      listId,
    });
    setText("");
    inputRef.current?.focus();
  };

  return (
    <div className="mx-5 mb-2 flex shrink-0 items-center gap-2.5 rounded-xl border border-line bg-panel px-3.5 py-2.5 shadow-sm transition-all focus-within:border-accent/40 focus-within:shadow-[0_0_0_4px_var(--accent-soft)]">
      <Plus size={15} className="shrink-0 text-ink3" />
      <input
        ref={inputRef}
        id="quick-add"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="添加任务，回车保存（试试：明天 / 周五 / !高 / #列表）"
        className="w-full bg-transparent text-sm outline-none placeholder:text-ink3/80"
      />
    </div>
  );
}
