import { useMemo, useRef, useState } from "react";
import { ArrowUp, Plus } from "lucide-react";
import { parseQuickAdd } from "@/core/quickparse";
import { formatDue } from "@/core/dates";
import { visibleLists } from "@/core/operations";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";
import { cn } from "@/lib/cn";

/**
 * 智能快速输入：
 *   明天 交报告 #工作 !高    周五 开会    3月8日 回家 !!
 * 支持日期词（今天/明天/后天/周X/下周X/M月D日/M/D）、!优先级、#已有列表；
 * 优先级与列表记号兼容全角（！高 / ！！ / ＃列表），中文输入法无需切换。
 *
 * ★ Android 适配：不要只依赖 keydown「Enter」提交。安卓输入法按回车/完成键时
 * 常常只发 keyCode 229（key 为 "Process"/"Unidentified"）甚至只发 keyup，
 * keydown 永远匹配不上 → 任务加不出去。可靠路径有三层：
 *   1) 外层 <form> 的隐式提交（onSubmit）：WebView 把单行 input 的 IME 动作键
 *      可靠地转成 submit 事件，这是移动端 Web 的标准做法；
 *   2) keydown Enter 作为桌面快捷路径，但守卫输入法组词（isComposing/229），
 *      并 preventDefault 避免与 form 隐式提交重复触发；
 *   3) 右侧常驻提交按钮：触摸设备上任何输入法、任何情况下都能点按添加。
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

  const canSubmit = text.trim().length > 0;

  // 实时解析预览：让「明天 / 周五 / !高 / #列表」这些记号的效果所见即所得
  const parsed = useMemo(
    () => (text.trim() ? parseQuickAdd(text) : null),
    [text],
  );
  const listHit = useMemo(() => {
    if (!parsed?.listQuery) return null;
    const q = parsed.listQuery.toLowerCase();
    return (
      lists.find((l) => l.name.toLowerCase() === q) ??
      lists.find((l) => l.name.toLowerCase().startsWith(q)) ??
      null
    );
  }, [parsed, lists]);
  const showPreview =
    !!parsed && (!!parsed.dueDate || !!parsed.priority || !!parsed.listQuery);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mx-5 mb-2 shrink-0 rounded-xl border border-line bg-panel px-3.5 py-2.5 shadow-sm transition-all focus-within:border-accent/40 focus-within:shadow-[0_0_0_4px_var(--accent-soft)]"
    >
      <div className="flex items-center gap-2.5">
        <Plus size={15} className="shrink-0 text-ink3" />
        <input
          ref={inputRef}
          id="quick-add"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 输入法组词中的 Enter 是「确认候选词」，不是提交（安卓与桌面中文输入法皆是）
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          enterKeyHint="send"
          autoComplete="off"
          spellCheck={false}
          placeholder="添加任务，回车保存（例：明天 交作业 !高 #英语）"
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink3/80"
        />
        <button
          type="submit"
          aria-label="添加任务"
          disabled={!canSubmit}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all",
            canSubmit
              ? "bg-accent text-white shadow-sm hover:brightness-110 active:[transform:scale(0.9)]"
              : "bg-panel2 text-ink3",
          )}
        >
          <ArrowUp size={14} strokeWidth={2.5} />
        </button>
      </div>
      {showPreview && parsed && (
        // 语法速查：日期词在开头（今天/明天/后天/周X/下周X/M月D日/M/D），
        // !低/!中/!高（或 !/!!/!!!）= 优先级，#列表名 = 加入已有列表
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[25px] text-[11px]">
          {parsed.dueDate && (
            <span className="rounded-md bg-panel2/70 px-1.5 py-0.5 text-ink2">
              到期 {formatDue(parsed.dueDate)}
            </span>
          )}
          {parsed.priority != null && (
            <span
              className={cn(
                "rounded-md bg-panel2/70 px-1.5 py-0.5",
                parsed.priority === 3
                  ? "text-danger"
                  : parsed.priority === 2
                    ? "text-warn"
                    : "text-ink2",
              )}
            >
              {parsed.priority === 3
                ? "高优先级"
                : parsed.priority === 2
                  ? "中优先级"
                  : "低优先级"}
            </span>
          )}
          {parsed.listQuery && (
            <span
              className={cn(
                "rounded-md bg-panel2/70 px-1.5 py-0.5",
                listHit ? "text-ink2" : "text-ink3",
              )}
            >
              {listHit
                ? `加入「${listHit.name}」`
                : `没有列表「${parsed.listQuery}」，将加入当前列表`}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
