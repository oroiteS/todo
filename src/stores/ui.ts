// UI 状态：当前视图 / 选中任务 / 搜索 / 弹层

import { create } from "zustand";
import type { TaskSort } from "@/core/task-sort";

const SORT_KEY = "todolite.taskSort";
function loadTaskSort(): TaskSort {
  try {
    const value = localStorage.getItem(SORT_KEY);
    return value === "priority" || value === "title" ? value : "dueDate";
  } catch {
    return "dueDate";
  }
}

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
  taskSort: TaskSort;
  setTaskSort(sort: TaskSort): void;
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
  taskSort: loadTaskSort(),
  setTaskSort: (sort) => {
    try { localStorage.setItem(SORT_KEY, sort); } catch { /* session-only preference */ }
    set({ taskSort: sort });
  },
  setView: (v) =>
    set({ view: v, selectedTaskId: null, searchQuery: "", sidebarOpen: false }),
  selectTask: (id) => set({ selectedTaskId: id }),
  setSearch: (q) => set({ searchQuery: q }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleShowCompleted: () => set((s) => ({ showCompleted: !s.showCompleted })),
}));
