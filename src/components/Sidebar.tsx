import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  Check,
  Layers,
  ListTodo,
  Palette,
  Pencil,
  Plus,
  Settings,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { isMacLike } from "@/lib/tauri";
import { LIST_COLORS, LIST_EMOJIS, type TaskList } from "@/core/models";
import {
  activeTasks,
  countByList,
  trashTasks,
  todayTasks,
  upcomingTasks,
  visibleLists,
} from "@/core/operations";
import { useDataStore } from "@/stores/data";
import { useUiStore, type SmartViewId, type View } from "@/stores/ui";
import { Dropdown, MenuItem } from "./Dropdown";

interface SmartItemProps {
  icon: typeof Sun;
  label: string;
  count: number;
  active: boolean;
  /** 该视图的主题色（hex），用于图标芯片 */
  tint: string;
  onClick: () => void;
}

function SmartItem({ icon: Icon, label, count, active, tint, onClick }: SmartItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-xl px-2 py-[7px] text-sm transition-all duration-150",
        active
          ? "bg-panel font-medium text-ink shadow-sm ring-1 ring-line/70"
          : "text-ink2 hover:bg-panel2/60 hover:text-ink",
      )}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors"
        style={{ background: active ? tint : `${tint}24` }}
      >
        <Icon
          size={13}
          style={{ color: active ? "#ffffff" : tint }}
          strokeWidth={2.4}
        />
      </span>
      <span className="flex-1 truncate text-left">{label}</span>
      {count > 0 && (
        <span
          className={cn(
            "rounded-md px-1.5 py-px text-[11px] tabular-nums",
            active ? "bg-panel2 text-ink2" : "text-ink3 group-hover:text-ink2",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function Sidebar() {
  const db = useDataStore((s) => s.db);
  const addList = useDataStore((s) => s.addList);
  const updateList = useDataStore((s) => s.updateList);
  const deleteList = useDataStore((s) => s.deleteList);
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [appearanceId, setAppearanceId] = useState<string | null>(null);

  const counts = useMemo(() => countByList(db), [db]);
  const lists = useMemo(() => visibleLists(db), [db]);
  const todayCount = useMemo(() => todayTasks(db).length, [db]);
  const upcomingCount = useMemo(() => upcomingTasks(db).length, [db]);
  const allCount = useMemo(() => activeTasks(db).length, [db]);
  const trashCount = useMemo(() => trashTasks(db).length, [db]);

  const isSmart = (id: SmartViewId) => view.kind === "smart" && view.id === id;
  const isList = (id: string) => view.kind === "list" && view.id === id;
  const go = (v: View) => () => setView(v);

  const submitNew = () => {
    const name = newName.trim();
    if (name) addList(name);
    setNewName("");
    setAdding(false);
  };

  const submitRename = () => {
    if (renamingId && renameText.trim()) {
      updateList(renamingId, { name: renameText.trim() });
    }
    setRenamingId(null);
  };

  return (
    <>
      {sidebarOpen && (
        <div
          className="fade-in fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px] md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={cn(
          // 抽屉显隐用原生 transform:translateX 而非 TW 的 translate-x-* 工具类：
          // Tailwind v4 会把后者编译成独立的 CSS translate 属性（Chromium 104+ 才支持），
          // 老 WebView（如 BlueStacks）不认识 → 抽屉永远显示且"关不掉"。
          "fixed bottom-0 left-0 top-0 z-40 flex w-72 shrink-0 flex-col border-r border-line/60 bg-panel/95 backdrop-blur-2xl transition-transform duration-200 md:static md:z-auto md:flex md:bg-[var(--sidebar)] md:[transform:translateX(0)]",
          sidebarOpen
            ? "[transform:translateX(0)]"
            : "[transform:translateX(-100%)]",
        )}
      >
        {/* 品牌区（macOS 红绿灯落在此处上方） */}
        <div
          data-tauri-drag-region
          className={cn(
            "flex h-12 shrink-0 items-center px-4",
            isMacLike() && "pl-20",
          )}
        >
          <span
            className="text-[15px] font-extrabold tracking-tight"
            style={{
              backgroundImage: "linear-gradient(120deg,#f97316,var(--accent))",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            TodoLite
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 pt-2">
          {/* 智能视图 */}
          <nav className="flex flex-col gap-1">
            <SmartItem
              icon={Sun}
              label="今天"
              count={todayCount}
              active={isSmart("today")}
              tint="#f59e0b"
              onClick={go({ kind: "smart", id: "today" })}
            />
            <SmartItem
              icon={CalendarDays}
              label="计划"
              count={upcomingCount}
              active={isSmart("upcoming")}
              tint="#0ea5e9"
              onClick={go({ kind: "smart", id: "upcoming" })}
            />
            <SmartItem
              icon={Layers}
              label="全部"
              count={allCount}
              active={isSmart("all")}
              tint="#8b5cf6"
              onClick={go({ kind: "smart", id: "all" })}
            />
            <SmartItem
              icon={Trash2}
              label="回收站"
              count={trashCount}
              active={view.kind === "trash"}
              tint="#78716c"
              onClick={go({ kind: "trash" })}
            />
          </nav>

          {/* 列表 */}
          <div className="mt-6 mb-1 flex items-center justify-between px-2.5">
            <span className="text-[11px] font-semibold tracking-widest text-ink3">
              我的列表
            </span>
            <button
              type="button"
              aria-label="新建列表"
              className="flex h-5 w-5 items-center justify-center rounded-md text-ink3 transition-colors hover:bg-panel2 hover:text-ink"
              onClick={() => setAdding(true)}
            >
              <Plus size={13} />
            </button>
          </div>
          <div className="flex flex-col gap-0.5">
            {lists.map((l) => (
              <ListRow
                key={l.id}
                list={l}
                count={counts.get(l.id) ?? 0}
                active={isList(l.id)}
                renaming={renamingId === l.id}
                renameText={renameText}
                onRenameText={setRenameText}
                onStartRename={() => {
                  setRenamingId(l.id);
                  setRenameText(l.name);
                }}
                onSubmitRename={submitRename}
                onCancelRename={() => setRenamingId(null)}
                confirmDelete={confirmDeleteId === l.id}
                onRequestDelete={() => {
                  setConfirmDeleteId(l.id);
                  // 原位切换为「确认删除？」后留 5s 确认窗口（触屏上重开菜单不现实）
                  setTimeout(() => setConfirmDeleteId((v) => (v === l.id ? null : v)), 5000);
                }}
                onConfirmDelete={() => {
                  deleteList(l.id);
                  setConfirmDeleteId(null);
                  if (isList(l.id)) setView({ kind: "smart", id: "all" });
                }}
                appearanceOpen={appearanceId === l.id}
                onAppearanceOpenChange={(open) =>
                  setAppearanceId(open ? l.id : null)
                }
                onPickEmoji={(emoji) => updateList(l.id, { emoji })}
                onPickColor={(color) => updateList(l.id, { color })}
              />
            ))}
            {adding && (
              // form 隐式提交：安卓输入法的回车/完成键不会总发 keydown Enter，
              // 由 submit 事件兜底（桌面回车同样触发）
              <form
                className="flex items-center gap-2 rounded-lg bg-panel2 px-2.5 py-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitNew();
                }}
              >
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setAdding(false);
                  }}
                  onBlur={submitNew}
                  enterKeyHint="done"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="列表名称，回车保存"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-ink3"
                />
              </form>
            )}
            {!lists.length && !adding && (
              <p className="px-2.5 py-1 text-[12px] leading-relaxed text-ink3">
                还没有列表，点右上角 + 创建
              </p>
            )}
          </div>
        </div>

        {/* 底部：设置 */}
        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink2 transition-colors hover:bg-panel2 hover:text-ink"
          >
            <Settings size={15} className="text-ink3" />
            设置
          </button>
        </div>
      </aside>
    </>
  );
}

// ---------- 列表行 ----------

interface ListRowProps {
  list: TaskList;
  count: number;
  active: boolean;
  renaming: boolean;
  renameText: string;
  onRenameText(t: string): void;
  onStartRename(): void;
  onSubmitRename(): void;
  onCancelRename(): void;
  confirmDelete: boolean;
  onRequestDelete(): void;
  onConfirmDelete(): void;
  appearanceOpen: boolean;
  onAppearanceOpenChange(open: boolean): void;
  onPickEmoji(emoji: string): void;
  onPickColor(color: string): void;
}

function ListRow(p: ListRowProps) {
  const setView = useUiStore((s) => s.setView);
  // 外观弹层的定位锚点：弹层需贴着此行弹出（而非写死坐标）
  const rowRef = useRef<HTMLDivElement>(null);
  if (p.renaming) {
    return (
      // form 隐式提交：兼容安卓输入法（同「新建列表」）
      <form
        className="flex items-center gap-2 rounded-lg bg-panel2 px-2.5 py-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          p.onSubmitRename();
        }}
      >
        <span className="text-[13px]">{p.list.emoji}</span>
        <input
          autoFocus
          value={p.renameText}
          onChange={(e) => p.onRenameText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") p.onCancelRename();
          }}
          onBlur={p.onSubmitRename}
          enterKeyHint="done"
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-transparent text-sm outline-none"
        />
      </form>
    );
  }

  return (
    <div
      ref={rowRef}
      className={cn(
        "group flex items-center gap-2.5 rounded-xl px-2 py-[7px] text-sm transition-all duration-150",
        p.active
          ? "bg-panel font-medium text-ink shadow-sm ring-1 ring-line/70"
          : "text-ink2 hover:bg-panel2/60 hover:text-ink",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        onClick={() => setView({ kind: "list", id: p.list.id })}
      >
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[13px]"
          style={{
            background: `${p.list.color}22`,
            boxShadow: `inset 0 0 0 1px ${p.list.color}55`, // 同色描边：让外观里选的颜色看得出来
          }}
        >
          {p.list.emoji}
        </span>
        <span className="flex-1 truncate">{p.list.name}</span>
        {p.count > 0 && (
          <span className="text-xs tabular-nums text-ink3">{p.count}</span>
        )}
      </button>

      <Dropdown
        align="right"
        trigger={({ toggle }) => (
          <button
            type="button"
            aria-label="列表操作"
            className="flex h-5 w-5 items-center justify-center rounded text-ink3 transition-opacity hover:text-ink focus-visible:opacity-100 opacity-100 md:opacity-0 md:group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
          >
            <ListTodo size={13} />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuItem
              icon={<Pencil size={13} />}
              label="重命名"
              onClick={() => {
                close();
                p.onStartRename();
              }}
            />
            <MenuItem
              icon={<Palette size={13} />}
              label="外观"
              onClick={() => {
                p.onAppearanceOpenChange(!p.appearanceOpen);
                close();
              }}
            />
            {p.confirmDelete ? (
              <MenuItem
                icon={<Check size={13} />}
                label="确认删除？"
                danger
                onClick={() => {
                  close();
                  p.onConfirmDelete();
                }}
              />
            ) : (
              // 不 close()：菜单内原位切换为「确认删除？」（触屏上重开菜单不现实）
              <MenuItem
                icon={<Trash2 size={13} />}
                label="移入回收站"
                danger
                onClick={() => {
                  p.onRequestDelete();
                }}
              />
            )}
          </>
        )}
      </Dropdown>

      {p.appearanceOpen && (
        <AppearancePicker
          anchorRef={rowRef}
          list={p.list}
          onClose={() => p.onAppearanceOpenChange(false)}
          onPickEmoji={p.onPickEmoji}
          onPickColor={p.onPickColor}
        />
      )}
    </div>
  );
}

/** 视口最小边距 / 弹层与锚点的间距 */
const PICKER_MARGIN = 8;
const PICKER_GAP = 8;

/**
 * 计算外观弹层在视口内的落点（纯函数，便于单测防回归：任何屏宽都不得溢出视口）。
 * 首选贴在锚点右侧、顶对齐；右侧放不下翻到锚点左侧；下方放不下底对齐锚点；
 * 最后钳制在视口内。
 */
export function pickerPos(
  anchor: { left: number; top: number; right: number; bottom: number } | null,
  pw: number,
  ph: number,
  vw: number,
  vh: number,
): { left: number; top: number } {
  const M = PICKER_MARGIN;
  const G = PICKER_GAP;
  let left = anchor ? anchor.right + G : (vw - pw) / 2;
  let top = anchor ? anchor.top : (vh - ph) / 2;
  if (left + pw > vw - M) left = (anchor?.left ?? 0) - pw - G;
  if (top + ph > vh - M) top = (anchor?.bottom ?? vh) - ph;
  left = Math.min(Math.max(M, left), Math.max(M, vw - pw - M));
  top = Math.min(Math.max(M, top), Math.max(M, vh - ph - M));
  return { left, top };
}

function AppearancePicker({
  anchorRef,
  list,
  onClose,
  onPickEmoji,
  onPickColor,
}: {
  /** 触发行（定位锚点） */
  anchorRef: RefObject<HTMLDivElement | null>;
  list: TaskList;
  onClose(): void;
  onPickEmoji(emoji: string): void;
  onPickColor(color: string): void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 视口内定位（老 WebView 可用，无需 floating-ui）：见 pickerPos
  const place = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const anchor = anchorRef.current?.getBoundingClientRect() ?? null;
    setPos(
      pickerPos(
        anchor,
        panel.offsetWidth,
        panel.offsetHeight,
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }, [anchorRef]);

  useLayoutEffect(() => {
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [place]);

  // 焦点管理：打开时聚焦面板（Esc 生效的前提），关闭后归还焦点
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      const back =
        prev && prev.isConnected ? prev : anchorRef.current;
      back?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⚠️ 必须 Portal 到 body：桌面端 <aside> 常驻 transform:translateX(0)（抽屉兼容
  // 老 WebView 的写法），CSS 规定 transform 祖先会成为后代 fixed 的包含块——
  // 不 Portal 的话遮罩只盖住侧栏、面板被主区待办行盖住且点外部关不掉。
  return createPortal(
    // 半透明遮罩：点任意空白处关闭；桌面端保持通透不挡视线
    <div
      className="fade-in fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px] md:bg-transparent md:backdrop-blur-none"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="列表外观"
        tabIndex={-1}
        className="pop-in absolute w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-line bg-panel p-3 shadow-xl shadow-black/10 outline-none md:w-60"
        style={{
          left: pos?.left ?? 0,
          top: pos?.top ?? 0,
          visibility: pos ? undefined : "hidden", // 首帧测量前不可见，避免闪跳
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-widest text-ink3">
            图标
          </span>
          <button
            type="button"
            aria-label="关闭"
            className="-m-1 flex h-7 w-7 items-center justify-center rounded-md text-ink3 transition-colors hover:bg-panel2 hover:text-ink"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
        <div className="grid grid-cols-6 gap-1">
          {LIST_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              aria-label={`图标 ${e}`}
              aria-pressed={list.emoji === e}
              onClick={() => onPickEmoji(e)}
              className={cn(
                // 触屏 40px 起步，桌面收窄到 32px
                "flex h-10 w-10 items-center justify-center rounded-lg text-lg transition-colors hover:bg-panel2 md:h-8 md:w-8 md:text-base",
                list.emoji === e && "bg-accent-soft ring-1 ring-accent/40",
              )}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="mb-2 mt-3 text-[11px] font-semibold tracking-widest text-ink3">
          颜色
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LIST_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`颜色 ${c}`}
              aria-pressed={list.color === c}
              onClick={() => onPickColor(c)}
              className={cn(
                "h-8 w-8 rounded-full transition-transform hover:[transform:scale(1.1)] md:h-6 md:w-6",
                list.color === c &&
                  "ring-2 ring-ink/40 ring-offset-2 ring-offset-panel",
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
