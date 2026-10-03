import { Check, Loader2, Menu, Moon, RefreshCw, Search, Settings, Sun, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { systemPrefersDark } from "@/lib/theme";
import { useDataStore } from "@/stores/data";
import { useSyncStore } from "@/stores/sync";
import { useUiStore } from "@/stores/ui";

const iconBtn =
  "flex h-8 w-8 items-center justify-center rounded-lg text-ink2 transition-colors hover:bg-panel2 hover:text-ink";

/** 主区工具栏（品牌与红绿灯在侧栏列） */
export function TitleBar() {
  const searchQuery = useUiStore((s) => s.searchQuery);
  const setSearch = useUiStore((s) => s.setSearch);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);

  const theme = useDataStore((s) => s.db.settings.theme);
  const updateSettings = useDataStore((s) => s.updateSettings);
  const syncConfigured = useDataStore((s) =>
    s.db.settings.syncBackend === "github"
      ? !!s.db.settings.github
      : !!s.db.settings.webdav,
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
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3"
          />
          <input
            id="global-search"
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索任务"
            className="h-8 w-full rounded-lg border border-transparent bg-panel2/70 pl-8.5 pr-12 text-[13px] outline-none transition-colors placeholder:text-ink3 focus:border-accent/40 focus:bg-panel"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1 py-px text-[10px] leading-none text-ink3 md:block">
            ⌘K
          </kbd>
        </div>
      </div>

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
