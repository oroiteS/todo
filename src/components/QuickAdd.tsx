import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, CircleHelp, Plus } from "lucide-react";
import { parseQuickAdd } from "@/core/quickparse";
import { formatDue } from "@/core/dates";
import { visibleLists } from "@/core/operations";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";
import { cn } from "@/lib/cn";

/** 行内记号样式（语法教程里的按键帽） */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-line bg-panel2/70 px-1 py-px text-[11px] text-ink">
      {children}
    </code>
  );
}

/**
 * 快速输入语法教程：输入框右侧 ? 按钮点击弹出（移动端无 hover，必须点按）。
 * Portal 到 body：避免任何祖先的 transform/backdrop-filter 把 fixed 面板带偏。
 */
function HelpPopover() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 定位：按钮下方、右缘对齐输入框，视口内钳制（老 WebView 可用，无 floating-ui）
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const btn = btnRef.current;
      const panel = panelRef.current;
      if (!btn || !panel) return;
      const r = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const M = 8;
      const pw = panel.offsetWidth;
      const ph = panel.offsetHeight;
      let left = Math.min(Math.max(M, r.right - pw), Math.max(M, vw - pw - M));
      let top = r.bottom + 8;
      if (top + ph > vh - M) top = Math.max(M, r.top - ph - 8);
      setPos({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="快速输入教程"
        aria-expanded={open}
        title="输入格式帮助"
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink3 transition-colors hover:bg-panel2 hover:text-ink",
          open && "bg-panel2 text-ink",
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <CircleHelp size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="快速输入教程"
            className="pop-in fixed z-50 w-[min(21rem,calc(100vw-1rem))] rounded-xl border border-line bg-panel p-3.5 shadow-xl shadow-black/10"
            style={{
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              visibility: pos ? undefined : "hidden",
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          >
            <p className="text-[13px] font-semibold text-ink">快速输入语法</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink3">
              在输入框里混写这些记号，回车自动解析（记号会从标题中剔除，
              输入时下方会实时预览）。
            </p>

            <section className="mt-2.5">
              <p className="text-[11px] font-semibold tracking-widest text-ink3">
                到期日 · 写在开头
              </p>
              <ul className="mt-1 space-y-1 text-[12px] leading-relaxed text-ink2">
                <li>
                  <Kbd>今天</Kbd> <Kbd>明天</Kbd> <Kbd>后天</Kbd> <Kbd>大后天</Kbd>
                </li>
                <li>
                  <Kbd>周五</Kbd> 本周（已过顺延）· <Kbd>下周三</Kbd> 下个自然周
                </li>
                <li>
                  <Kbd>10月8日</Kbd> · <Kbd>10/8</Kbd>（无年份，已过自动顺延一年）
                </li>
                <li>
                  <Kbd>2026/10/8</Kbd> · <Kbd>2026-10-8</Kbd> ·{" "}
                  <Kbd>2026年10月8日</Kbd>（指定年份，不顺延）
                </li>
                <li>
                  可紧贴标题：<Kbd>明天交报告</Kbd>
                </li>
              </ul>
            </section>

            <section className="mt-2.5">
              <p className="text-[11px] font-semibold tracking-widest text-ink3">
                优先级
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink2">
                <Kbd>!低</Kbd> <Kbd>!中</Kbd> <Kbd>!高</Kbd> 或{" "}
                <Kbd>!</Kbd> <Kbd>!!</Kbd> <Kbd>!!!</Kbd>
                ；全角 <Kbd>！高</Kbd> <Kbd>！！</Kbd> 同样有效
              </p>
            </section>

            <section className="mt-2.5">
              <p className="text-[11px] font-semibold tracking-widest text-ink3">
                列表
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink2">
                <Kbd>#英语</Kbd>（全角 <Kbd>＃英语</Kbd> 也可）：精确/前缀匹配已有列表，
                匹配不到则加入当前列表
              </p>
            </section>

            <div className="mt-2.5 rounded-lg bg-panel2/60 p-2">
              <p className="text-[10px] font-semibold tracking-widest text-ink3">
                示例
              </p>
              <ul className="mt-1 space-y-0.5 text-[12px] text-ink">
                <li>明天 交作业 !高 #英语</li>
                <li>周五 组会 !!</li>
                <li>2026/10/8 体检</li>
              </ul>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * 智能快速输入：
 *   明天 交报告 #工作 !高    周五 开会    3月8日 回家 !!
 * 支持日期词（今天/明天/周X/下周X/M月D日/M/D/2026/10/8）、!优先级、#已有列表；
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
        {/* 输入格式帮助：放输入框与提交按钮之间，见即知是关于输入的 */}
        <HelpPopover />
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
