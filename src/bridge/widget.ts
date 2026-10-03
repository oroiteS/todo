// ★ 小组件预留接口（前端侧）
//
// v1 只实现「快照推送」：数据变更后把精简摘要写到平台共享位置。
// 后续任务在此基础上实现：
//   - macOS: WidgetKit Extension（SwiftUI）读取快照渲染小组件
//   - Android: AppWidget Provider（RemoteViews 或 Glance）读取快照渲染小组件
// 快照 schema 与平台路径详见 docs/widget-adaptation.md。

import { invoke } from "@tauri-apps/api/core";
import type { Database, Task } from "@/core/models";
import {
  activeTasks,
  completedTodayCount,
  listById,
  todayTasks,
  upcomingTasks,
} from "@/core/operations";
import { isOverdue, isToday, todayStr } from "@/core/dates";
import { isTauri } from "@/lib/tauri";

export interface WidgetTaskRef {
  id: string;
  title: string;
  listName: string;
  dueDate: string | null;
}

export interface WidgetSnapshot {
  generatedAt: string;
  today: WidgetTaskRef[];
  overdue: WidgetTaskRef[];
  counts: {
    today: number;
    upcoming: number;
    all: number;
    completedToday: number;
  };
}

/** 快照条目上限：小组件展示空间有限，计数用完整值 */
const SNAPSHOT_CAP = 10;

function toRef(db: Database, t: Task): WidgetTaskRef {
  return {
    id: t.id,
    title: t.title,
    listName: listById(db, t.listId)?.name ?? "",
    dueDate: t.dueDate ?? null,
  };
}

export function buildSnapshot(db: Database, now: Date = new Date()): WidgetSnapshot {
  const today = todayStr(now);
  const dueTodayOrOverdue = todayTasks(db, today);
  const todays = dueTodayOrOverdue.filter(
    (t) => t.dueDate && isToday(t.dueDate, today),
  );
  const overdue = dueTodayOrOverdue.filter(
    (t) => t.dueDate && isOverdue(t.dueDate, today),
  );
  return {
    generatedAt: now.toISOString(),
    today: todays.slice(0, SNAPSHOT_CAP).map((t) => toRef(db, t)),
    overdue: overdue.slice(0, SNAPSHOT_CAP).map((t) => toRef(db, t)),
    counts: {
      today: todays.length,
      upcoming: upcomingTasks(db, today).length,
      all: activeTasks(db).length,
      completedToday: completedTodayCount(db, today),
    },
  };
}

export interface WidgetBridge {
  /** 数据变更后调用；返回是否成功写入平台快照 */
  pushSnapshot(db: Database): Promise<boolean>;
}

const tauriWidgetBridge: WidgetBridge = {
  async pushSnapshot(db) {
    try {
      return await invoke<boolean>("write_widget_snapshot", {
        snapshot: buildSnapshot(db),
      });
    } catch (err) {
      console.warn("[widget] snapshot push failed:", err);
      return false;
    }
  },
};

const noopWidgetBridge: WidgetBridge = {
  async pushSnapshot() {
    return false;
  },
};

export const widgetBridge: WidgetBridge = isTauri()
  ? tauriWidgetBridge
  : noopWidgetBridge;
