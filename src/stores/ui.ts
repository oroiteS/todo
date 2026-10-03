// UI 状态：当前视图 / 选中任务 / 搜索 / 弹层

import { create } from "zustand";

export type SmartViewId = "today" | "upcoming" | "all";

export type View =
  | { kind: "smart"; id: SmartViewId }
  | { kind: "list"; id: string }
  | { kind: "trash" };

export const smartViewTitles: Record<SmartViewId, string> = {
  today: "今天",
  upcoming: "计划",
  all: "全部",
};

interface UiStore {
  view: View;
  selectedTaskId: string | null;
  searchQuery: string;
  settingsOpen: boolean;
  sidebarOpen: boolean;
  showCompleted: boolean;
  setView(v: View): void;
  selectTask(id: string | null): void;
  setSearch(q: string): void;
  setSettingsOpen(open: boolean): void;
  setSidebarOpen(open: boolean): void;
  toggleShowCompleted(): void;
}

export const useUiStore = create<UiStore>((set) => ({
  view: { kind: "smart", id: "today" },
  selectedTaskId: null,
  searchQuery: "",
  settingsOpen: false,
  sidebarOpen: false,
  showCompleted: true,
  setView: (v) =>
    set({ view: v, selectedTaskId: null, searchQuery: "", sidebarOpen: false }),
  selectTask: (id) => set({ selectedTaskId: id }),
  setSearch: (q) => set({ searchQuery: q }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleShowCompleted: () => set((s) => ({ showCompleted: !s.showCompleted })),
}));
