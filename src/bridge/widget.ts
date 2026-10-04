// ★ 小组件预留接口（前端侧）
//
// v1 只实现「快照推送」：数据变更后把精简摘要写到平台共享位置。
// 后续任务在此基础上实现：
//   - macOS: WidgetKit Extension（SwiftUI）读取快照渲染小组件
//   - Android: AppWidget Provider（RemoteViews 或 Glance）读取快照渲染小组件
// 快照 schema 与平台路径详见 docs/widget-adaptation.md。

import { invoke } from "@tauri-apps/api/core";
import type { Database, Priority, Task } from "@/core/models";
import {
  activeTasks,
  completedTodayCount,
  listById,
  sortTasks,
  todayTasks,
  upcomingTasks,
} from "@/core/operations";
import { isOverdue, isToday, todayStr } from "@/core/dates";
import { isTauri } from "@/lib/tauri";

/** 优先级：0 无 / 1 低 / 2 中 / 3 高（与 core/models 的 Priority 一致） */
const HIGH_PRIORITY: Priority = 3;

export interface WidgetTaskRef {
  id: string;
  title: string;
  listName: string;
  dueDate: string | null;
  /** 0 无 / 1 低 / 2 中 / 3 高，供小组件渲染角标 */
  priority: Priority;
}

export interface WidgetSnapshot {
  generatedAt: string;
  today: WidgetTaskRef[];
  overdue: WidgetTaskRef[];
  /** 高优先级（priority=3）未完成任务，与到期日无关 */
  highPriority: WidgetTaskRef[];
  /**
   * 离今天最近的未完成任务，小组件主展示源（v1.2 新增）：
   * 有到期日按日期升序（逾期 → 今天 → 未来），同日保持手动排序，无日期任务垫底。
   */
  nearest: WidgetTaskRef[];
  counts: {
    today: number;
    upcoming: number;
    all: number;
    completedToday: number;
    highPriority: number;
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
    priority: (t.priority ?? 0) as Priority,
  };
}

/**
 * 小组件展示列表：离今天最近的任务。
 * activeTasks 已按 sortOrder 稳定排序，这里只做「有日期在前、按日期升序」：
 * ISO "yyyy-MM-dd" 字符串可直接字典序比较，逾期 → 今天 → 未来自然有序，
 * 且与渲染时的「今天」无关——跨天无需重新推送快照顺序也不出错；无日期垫底。
 */
function nearestTasks(db: Database): Task[] {
  const dated: Task[] = [];
  const undated: Task[] = [];
  for (const t of activeTasks(db)) {
    if (t.dueDate) dated.push(t);
    else undated.push(t);
  }
  dated.sort((a, b) =>
    a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0,
  );
  return [...dated, ...undated];
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
  const highPriority = sortTasks(
    activeTasks(db).filter((t) => (t.priority ?? 0) === HIGH_PRIORITY),
  );
  return {
    generatedAt: now.toISOString(),
    today: todays.slice(0, SNAPSHOT_CAP).map((t) => toRef(db, t)),
    overdue: overdue.slice(0, SNAPSHOT_CAP).map((t) => toRef(db, t)),
    highPriority: highPriority.slice(0, SNAPSHOT_CAP).map((t) => toRef(db, t)),
    nearest: nearestTasks(db).slice(0, SNAPSHOT_CAP).map((t) => toRef(db, t)),
    counts: {
      today: todays.length,
      upcoming: upcomingTasks(db, today).length,
      all: activeTasks(db).length,
      completedToday: completedTodayCount(db, today),
      highPriority: highPriority.length,
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
