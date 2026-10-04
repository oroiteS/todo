import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  CircleHelp,
  Loader2,
  Menu,
  Moon,
  RefreshCw,
  Search,
  Settings,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { systemPrefersDark } from "@/lib/theme";
import { useDataStore } from "@/stores/data";
import { useSyncStore } from "@/stores/sync";
import { useUiStore } from "@/stores/ui";

const iconBtn =
  "flex h-8 w-8 items-center justify-center rounded-lg text-ink2 transition-colors hover:bg-panel2 hover:text-ink";

/** 行内记号样式（语法教程里的按键帽） */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-line bg-panel2/70 px-1 py-px text-[11px] text-ink">
      {children}
    </code>
  );
}

/**
 * 快速输入语法教程：? 按钮点击弹出（移动端无 hover，必须点按）。
 * Portal 到 body：标题栏带 backdrop-blur（对 fixed 后代是包含块），不 Portal 会被主区盖住。
 */
function HelpPopover() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // 定位：按钮左下方、视口内钳制（老 WebView 可用，无 floating-ui）
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
        className={cn(iconBtn, "shrink-0", open && "bg-panel2 text-ink")}
        onClick={() => setOpen((v) => !v)}
      >
        <CircleHelp size={15} />
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
              在「添加任务」输入框里混写这些记号，回车自动解析（记号会从标题中剔除，
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
                  <Kbd>10月8日</Kbd> 或 <Kbd>10/8</Kbd>，已过自动顺延一年
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
                <li>10/8 体检</li>
              </ul>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** 主区工具栏（品牌与红绿灯在侧栏列） */
export function TitleBar() {
  const searchQuery = useUiStore((s) => s.searchQuery);
  const setSearch = useUiStore((s) => s.setSearch);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);

  const theme = useDataStore((s) => s.db.settings.theme);
  const updateSettings = useDataStore((s) => s.updateSettings);
  const syncConfigured = useDataStore((s) =>
    (s.db.settings.webdavEnabled && !!s.db.settings.webdav) ||
    (s.db.settings.githubEnabled && !!s.db.settings.github),
  );
  const triggerSync = useDataStore((s) => s.triggerSync);

  const { status, message, lastSyncAt } = useSyncStore();
  const isDark =
    theme === "dark" || (theme === "system" && systemPrefersDark());

  return (
    <header
      data-tauri-drag-region
      className="z-20 flex h-12 shrink-0 items-center gap-1.5 border-b border-line/70 bg-bg/85 px-2.5 backdrop-blur-md"
    >
      <button
        type="button"
        aria-label="打开菜单"
        className={cn(iconBtn, "md:hidden")}
        onClick={() => setSidebarOpen(true)}
      >
        <Menu size={17} />
      </button>

      <div className="flex min-w-0 flex-1 justify-center px-1">
        <div className="relative w-full max-w-md">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 [transform:translateY(-50%)] text-ink3"
          />
          <input
            id="global-search"
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索任务"
            className="h-8 w-full rounded-lg border border-transparent bg-panel2/70 pl-8.5 pr-12 text-[13px] outline-none transition-colors placeholder:text-ink3 focus:border-accent/40 focus:bg-panel"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden [transform:translateY(-50%)] rounded border border-line px-1 py-px text-[10px] leading-none text-ink3 md:block">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* 快速输入语法教程（点击弹出，安卓可点） */}
      <HelpPopover />

      {syncConfigured && (
        <button
          type="button"
          title={
            status === "error" && message
              ? message
              : lastSyncAt
                ? `上次同步：${formatRelativeTime(lastSyncAt)}`
                : "点击立即同步"
          }
          onClick={() => void triggerSync()}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 text-[11px] text-ink2 transition-colors hover:border-accent/40 hover:text-ink"
        >
          {status === "syncing" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : status === "error" ? (
            <TriangleAlert size={12} className="text-danger" />
          ) : status === "ok" ? (
            <Check size={12} className="text-ok" strokeWidth={3} />
          ) : (
            <RefreshCw size={12} />
          )}
          <span className="max-w-24 truncate">
            {status === "syncing"
              ? "同步中"
              : status === "error"
                ? "同步失败"
                : lastSyncAt
                  ? formatRelativeTime(lastSyncAt)
                  : "未同步"}
          </span>
        </button>
      )}

      <button
        type="button"
        aria-label="切换深浅色"
        className={cn(iconBtn, "shrink-0")}
        onClick={() => updateSettings({ theme: isDark ? "light" : "dark" })}
      >
        {isDark ? <Sun size={15} /> : <Moon size={15} />}
      </button>

      <button
        type="button"
        aria-label="设置"
        className={cn(iconBtn, "shrink-0 md:hidden")}
        onClick={() => setSettingsOpen(true)}
      >
        <Settings size={15} />
      </button>
    </header>
  );
}
