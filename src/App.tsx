import { useEffect } from "react";
import { useDataStore } from "@/stores/data";
import { useUiStore } from "@/stores/ui";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import { DetailPane } from "@/components/DetailPane";
import { SettingsModal } from "@/components/SettingsModal";
import { Sidebar } from "@/components/Sidebar";
import { TaskListPane } from "@/components/TaskListPane";
import { TitleBar } from "@/components/TitleBar";

let initStarted = false;

export default function App() {
  const loaded = useDataStore((s) => s.loaded);
  const init = useDataStore((s) => s.init);
  const theme = useDataStore((s) => s.db.settings.theme);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  useEffect(() => {
    if (!initStarted) {
      initStarted = true;
      void init();
    }
  }, [init]);

  // 跟随系统主题变化
  useEffect(
    () =>
      watchSystemTheme(() => {
        if (useDataStore.getState().db.settings.theme === "system") {
          applyTheme(useDataStore.getState().db.settings);
        }
      }),
    [],
  );

  // 屏蔽 WebView 默认右键菜单（只有「重新加载」，纯误导）；
  // 输入框/文本域保留系统菜单（复制/粘贴/查询）。
  // 任务行与列表行有自己的右键菜单（移动端长按等同）。
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, []);

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "k") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      } else if (mod && key === "n") {
        e.preventDefault();
        document.getElementById("quick-add")?.focus();
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === "Escape") {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSettingsOpen]);

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <div
          className="h-9 w-9 animate-pulse rounded-xl shadow-md"
          style={{ background: "linear-gradient(135deg,#f97316,var(--accent))" }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      {/* 主区：不透明纯黑，与玻璃侧栏形成层次 */}
      <div className="flex min-w-0 flex-1 flex-col bg-bg">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <TaskListPane />
          <DetailPane />
        </div>
      </div>
      <SettingsModal />
    </div>
  );
}
