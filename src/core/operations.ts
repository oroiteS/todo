// 领域操作：全部为 (db, ...) -> 新 db 的纯函数（不可变更新）。

import type { Database, ID, Priority, ProxyConfig, Task, TaskList } from "./models";
import { DEFAULT_INBOX_ID, DEFAULT_INBOX_NAME, DEFAULT_PROXY } from "./models";
import { newId } from "./ids";
import { todayStr, isToday, isOverdue, diffDays } from "./dates";

/** 永久删除墓碑账本的保留天数（超期条目必然已传播到所有设备，丢弃安全） */
const PURGE_LOG_RETENTION_DAYS = 90;

export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

export function emptyDatabase(now: Date = new Date()): Database {
  return {
    schemaVersion: 1,
    tasks: [],
    lists: [],
    purged: {},
    settings: {
      theme: "system",
      accent: "rose",
      proxy: { ...DEFAULT_PROXY },
      syncBackend: "webdav",
      webdavEnabled: true,
      githubEnabled: false,
      webdav: null,
      github: null,
      lastSyncAt: null,
    },
  };
}

/** 修复/补全外部或历史数据，保证字段完整（导入、迁移用） */
export function normalizeDatabase(raw: unknown, now: Date = new Date()): Database {
  const db = emptyDatabase(now);
  if (!raw || typeof raw !== "object") return db;
  const obj = raw as Partial<Database>;
  if (Array.isArray(obj.lists)) {
    db.lists = obj.lists
      .filter((l) => l && typeof l.id === "string" && typeof l.name === "string")
      .map((l) => ({
        id: l.id,
        name: l.name,
        color: typeof l.color === "string" ? l.color : "#57534e",
        emoji: typeof l.emoji === "string" ? l.emoji : "📋",
        sortOrder: typeof l.sortOrder === "number" ? l.sortOrder : 0,
        createdAt: l.createdAt ?? nowIso(now),
        updatedAt: l.updatedAt ?? nowIso(now),
        deletedAt: l.deletedAt ?? null,
      }));
  }
  if (Array.isArray(obj.tasks)) {
    db.tasks = obj.tasks
      .filter(
        (t) =>
          t &&
          typeof t.id === "string" &&
          typeof t.listId === "string" &&
          typeof t.title === "string",
      )
      .map((t) => ({
        id: t.id,
        listId: t.listId,
        title: t.title,
        notes: typeof t.notes === "string" ? t.notes : undefined,
        dueDate: typeof t.dueDate === "string" ? t.dueDate : undefined,
        priority: (t.priority ?? 0) as Priority,
        sortOrder: typeof t.sortOrder === "number" ? t.sortOrder : 0,
        completedAt: t.completedAt ?? null,
        createdAt: t.createdAt ?? nowIso(now),
        updatedAt: t.updatedAt ?? nowIso(now),
        deletedAt: t.deletedAt ?? null,
      }));
  }
  if (obj.settings && typeof obj.settings === "object") {
    db.settings = {
      theme: obj.settings.theme ?? "system",
      accent: obj.settings.accent ?? "rose",
      proxy: normalizeProxy(obj.settings.proxy),
      syncBackend: obj.settings.syncBackend ?? "webdav",
      // 独立通道开关：旧数据由单选 syncBackend 迁移；显式开关优先
      webdavEnabled:
        obj.settings.webdavEnabled ?? (obj.settings.syncBackend ?? "webdav") === "webdav",
      githubEnabled: obj.settings.githubEnabled ?? obj.settings.syncBackend === "github",
      webdav: obj.settings.webdav ?? null,
      github: obj.settings.github ?? null,
      lastSyncAt: obj.settings.lastSyncAt ?? null,
    };
  }
  // 永久删除墓碑账本（旧版本数据无此字段 → 空账本）
  if (obj.purged && typeof obj.purged === "object") {
    for (const [id, at] of Object.entries(obj.purged)) {
      if (typeof at === "string") db.purged[id] = at;
    }
  }
  return dedupeInboxes(db, now);
}

/** 兼容旧数据：proxy 字段缺失或不合法时回退默认（自动检测） */
export function normalizeProxy(raw: unknown): ProxyConfig {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<ProxyConfig>;
  return {
    mode: p.mode === "none" || p.mode === "manual" ? p.mode : "auto",
    url: typeof p.url === "string" ? p.url.trim() : "",
  };
}

/** 首次启动：确保存在收集箱。
 *  新库用固定 id（多台新设备首次同步天然并成同一个收集箱）；
 *  固定 id 已被墓碑占用时退回随机 id，避免同 id 冲突。 */
export function ensureInbox(db: Database, now: Date = new Date()): Database {
  if (db.lists.some((l) => l.name === DEFAULT_INBOX_NAME && !l.deletedAt)) {
    return db;
  }
  if (!db.lists.some((l) => l.id === DEFAULT_INBOX_ID)) {
    const maxSort = db.lists.length
      ? Math.max(...db.lists.map((l) => l.sortOrder))
      : 0;
    const inbox: TaskList = {
      id: DEFAULT_INBOX_ID,
      name: DEFAULT_INBOX_NAME,
      color: "#0d9488",
      emoji: "📋",
      sortOrder: maxSort + 1,
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
      deletedAt: null,
    };
    return { ...db, lists: [...db.lists, inbox] };
  }
  const { db: next } = createList(db, DEFAULT_INBOX_NAME, undefined, undefined, now);
  return next;
}

/** 去重「收集箱」：多设备各自首启会创建不同 id 的同名默认列表，按 id 并集合并
 *  后就会出现多个收集箱。保留最早创建的一个（并列取 id 字典序，保证各设备
 *  结论一致），任务全部并入，其余列表以墓碑标记（随同步传播删除）。
 *  在 normalizeDatabase（本地加载/导入）与 mergeDatabases（同步合并）后都会执行。 */
export function dedupeInboxes(db: Database, now: Date = new Date()): Database {
  const live = db.lists
    .filter((l) => !l.deletedAt && l.name === DEFAULT_INBOX_NAME)
    .sort((a, b) =>
      a.createdAt !== b.createdAt
        ? a.createdAt < b.createdAt
          ? -1
          : 1
        : a.id < b.id
          ? -1
          : 1,
    );
  if (live.length < 2) return db;
  const canonical = live[0];
  const dupIds = new Set(live.slice(1).map((l) => l.id));
  const ts = nowIso(now);
  return {
    ...db,
    tasks: db.tasks.map((t) =>
      dupIds.has(t.listId) ? { ...t, listId: canonical.id, updatedAt: ts } : t,
    ),
    lists: db.lists.map((l) =>
      dupIds.has(l.id) ? { ...l, deletedAt: l.deletedAt ?? ts, updatedAt: ts } : l,
    ),
  };
}

// ---------- 任务 ----------

export interface CreateTaskFields {
  title: string;
  listId?: ID;
  dueDate?: string;
  priority?: Priority;
  notes?: string;
}

export function createTask(
  db: Database,
  fields: CreateTaskFields,
  now: Date = new Date(),
): { db: Database; task: Task } {
  const listId = fields.listId ?? defaultListId(db);
  const active = db.tasks.filter((t) => !t.deletedAt && !t.completedAt);
  const minSort = active.length ? Math.min(...active.map((t) => t.sortOrder)) : 0;
  const task: Task = {
    id: newId(),
    listId,
    title: fields.title,
    notes: fields.notes,
    dueDate: fields.dueDate,
    priority: fields.priority ?? 0,
    sortOrder: minSort - 1,
    completedAt: null,
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
    deletedAt: null,
  };
  return { db: { ...db, tasks: [task, ...db.tasks] }, task };
}

function defaultListId(db: Database): ID {
  const inbox =
    db.lists.find((l) => !l.deletedAt && l.name === DEFAULT_INBOX_NAME) ??
    db.lists.find((l) => !l.deletedAt);
  if (inbox) return inbox.id;
  // 数据库没有列表（异常情况）时兜底建一个
  return "";
}

export function updateTask(
  db: Database,
  id: ID,
  patch: Partial<Pick<Task, "title" | "notes" | "dueDate" | "priority" | "listId">>,
  now: Date = new Date(),
): Database {
  const ts = nowIso(now);
  return {
    ...db,
    tasks: db.tasks.map((t) =>
      t.id === id ? { ...t, ...patch, updatedAt: ts } : t,
    ),
  };
}

export function toggleTask(
  db: Database,
  id: ID,
  now: Date = new Date(),
): Database {
  const ts = nowIso(now);
  return {
    ...db,
    tasks: db.tasks.map((t) =>
      t.id === id
        ? {
            ...t,
            completedAt: t.completedAt ? null : ts,
            updatedAt: ts,
          }
        : t,
    ),
  };
}

export function softDeleteTask(
  db: Database,
  id: ID,
  now: Date = new Date(),
): Database {
  const ts = nowIso(now);
  return {
    ...db,
    tasks: db.tasks.map((t) =>
      t.id === id ? { ...t, deletedAt: ts, updatedAt: ts } : t,
    ),
  };
}

export function restoreTask(
  db: Database,
  id: ID,
  now: Date = new Date(),
): Database {
  const ts = nowIso(now);
  return {
    ...db,
    tasks: db.tasks.map((t) =>
      t.id === id ? { ...t, deletedAt: null, updatedAt: ts } : t,
    ),
  };
}

export function purgeTask(db: Database, id: ID, now: Date = new Date()): Database {
  return {
    ...db,
    tasks: db.tasks.filter((t) => t.id !== id),
    purged: { ...db.purged, [id]: nowIso(now) },
  };
}

/** 清空回收站：硬删除所有软删除任务，并写入永久删除墓碑（同步据此丢弃远端残影） */
export function emptyTrash(db: Database, now: Date = new Date()): Database {
  const ts = nowIso(now);
  const purged = { ...db.purged };
  for (const t of db.tasks) {
    if (t.deletedAt) purged[t.id] = ts;
  }
  return { ...db, tasks: db.tasks.filter((t) => !t.deletedAt), purged };
}

/** 清理超过保留期的墓碑，防止数据无限膨胀 */
export function purgeOldTombstones(
  db: Database,
  keepDays = 30,
  now: Date = new Date(),
): Database {
  const cutoff = now.getTime() - keepDays * 86400000;
  // 永久删除账本保留更久（90 天）：账本条目在保留期内必然已传播到所有设备，
  // 过期后远端不可能再有该任务残影，丢弃才安全。
  const logCutoff = now.getTime() - PURGE_LOG_RETENTION_DAYS * 86400000;
  const purged: Database["purged"] = {};
  for (const [id, at] of Object.entries(db.purged)) {
    if (new Date(at).getTime() > logCutoff) purged[id] = at;
  }
  return {
    ...db,
    tasks: db.tasks.filter(
      (t) => !t.deletedAt || new Date(t.deletedAt).getTime() > cutoff,
    ),
    lists: db.lists.filter(
      (l) => !l.deletedAt || new Date(l.deletedAt).getTime() > cutoff,
    ),
    purged,
  };
}

/**
 * 重排序：visibleIds 是当前视图中的有序任务 id，targetIndex 为目标位置。
 * 取相邻 sortOrder 中点；若区间退化则整体归一化。
 */
export function reorderTask(
  db: Database,
  id: ID,
  visibleIds: ID[],
  targetIndex: number,
): Database {
  const idx = visibleIds.indexOf(id);
  if (idx < 0) return db;
  const next = [...visibleIds];
  next.splice(idx, 1);
  const clamped = Math.max(0, Math.min(targetIndex, next.length));
  const beforeId = clamped > 0 ? next[clamped - 1] : null;
  const afterId = clamped < next.length ? next[clamped] : null;
  const byId = new Map(db.tasks.map((t) => [t.id, t]));
  const before = beforeId ? byId.get(beforeId) : undefined;
  const after = afterId ? byId.get(afterId) : undefined;
  const ts = nowIso();

  let newSort: number;
  if (!before && after) newSort = after.sortOrder - 1;
  else if (before && !after) newSort = before.sortOrder + 1;
  else if (before && after) newSort = (before.sortOrder + after.sortOrder) / 2;
  else newSort = 0;

  // 中点退化（float 精度或重复值）时对同列表任务全量归一化
  const degenerate =
    (before && newSort === before.sortOrder) ||
    (after && newSort === after.sortOrder);
  if (!degenerate) {
    return {
      ...db,
      tasks: db.tasks.map((t) =>
        t.id === id ? { ...t, sortOrder: newSort, updatedAt: ts } : t,
      ),
    };
  }

  const listId = byId.get(id)?.listId;
  const siblings = db.tasks
    .filter((t) => t.listId === listId && !t.deletedAt)
    .sort(compareTasks);
  const ordered = siblings.filter((t) => t.id !== id);
  ordered.splice(clamped, 0, byId.get(id)!);
  const sorts = new Map(ordered.map((t, i) => [t.id, i]));
  return {
    ...db,
    tasks: db.tasks.map((t) =>
      sorts.has(t.id)
        ? { ...t, sortOrder: sorts.get(t.id)!, updatedAt: ts }
        : t,
    ),
  };
}

// ---------- 列表 ----------

export function createList(
  db: Database,
  name: string,
  color?: string,
  emoji?: string,
  now: Date = new Date(),
): { db: Database; list: TaskList } {
  const maxSort = db.lists.length
    ? Math.max(...db.lists.map((l) => l.sortOrder))
    : 0;
  const list: TaskList = {
    id: newId(),
    name,
    color: color ?? "#0d9488",
    emoji: emoji ?? "📋",
    sortOrder: maxSort + 1,
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
    deletedAt: null,
  };
  return { db: { ...db, lists: [...db.lists, list] }, list };
}

export function updateList(
  db: Database,
  id: ID,
  patch: Partial<Pick<TaskList, "name" | "color" | "emoji">>,
  now: Date = new Date(),
): Database {
  const ts = nowIso(now);
  return {
    ...db,
    lists: db.lists.map((l) =>
      l.id === id ? { ...l, ...patch, updatedAt: ts } : l,
    ),
  };
}

/** 删除列表：列表与其未完成任务一起进入回收站 */
export function softDeleteList(
  db: Database,
  id: ID,
  now: Date = new Date(),
): Database {
  const ts = nowIso(now);
  return {
    ...db,
    lists: db.lists.map((l) =>
      l.id === id ? { ...l, deletedAt: ts, updatedAt: ts } : l,
    ),
    tasks: db.tasks.map((t) =>
      t.listId === id && !t.deletedAt
        ? { ...t, deletedAt: ts, updatedAt: ts }
        : t,
    ),
  };
}

// ---------- 查询 ----------

export function compareTasks(a: Task, b: Task): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.createdAt < b.createdAt ? -1 : 1;
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(compareTasks);
}

export function isActive(t: Task): boolean {
  return !t.deletedAt && !t.completedAt;
}

export function activeTasks(db: Database): Task[] {
  return sortTasks(db.tasks.filter(isActive));
}

export function tasksInList(db: Database, listId: ID): Task[] {
  return sortTasks(db.tasks.filter((t) => t.listId === listId && !t.deletedAt));
}

/** 今天视图：所有到期日 <= 今天的未完成任务（逾期优先展示） */
export function todayTasks(db: Database, today: string = todayStr()): Task[] {
  return sortTasks(
    db.tasks.filter(
      (t) => isActive(t) && !!t.dueDate && diffDays(t.dueDate, today) <= 0,
    ),
  );
}

/** 计划视图：未来 7 天（不含今天） */
export function upcomingTasks(db: Database, today: string = todayStr()): Task[] {
  return sortTasks(
    db.tasks.filter(
      (t) =>
        isActive(t) &&
        !!t.dueDate &&
        diffDays(t.dueDate, today) > 0 &&
        diffDays(t.dueDate, today) <= 7,
    ),
  );
}

export function trashTasks(db: Database): Task[] {
  return sortTasks(db.tasks.filter((t) => !!t.deletedAt));
}

export function searchTasks(db: Database, query: string): Task[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return sortTasks(
    db.tasks.filter(
      (t) =>
        !t.deletedAt &&
        !t.completedAt &&
        (t.title.toLowerCase().includes(q) ||
          (t.notes ?? "").toLowerCase().includes(q)),
    ),
  );
}

export function listById(db: Database, id: ID): TaskList | undefined {
  return db.lists.find((l) => l.id === id);
}

export function visibleLists(db: Database): TaskList[] {
  return db.lists
    .filter((l) => !l.deletedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function countByList(db: Database): Map<ID, number> {
  const m = new Map<ID, number>();
  for (const t of db.tasks) {
    if (isActive(t)) m.set(t.listId, (m.get(t.listId) ?? 0) + 1);
  }
  return m;
}

/** 今天已完成数（今日视图的成就感小数字） */
export function completedTodayCount(
  db: Database,
  today: string = todayStr(),
): number {
  return db.tasks.filter(
    (t) => t.completedAt && isToday(t.completedAt.slice(0, 10), today),
  ).length;
}

export function overdueCount(db: Database, today: string = todayStr()): number {
  return db.tasks.filter(
    (t) => isActive(t) && !!t.dueDate && isOverdue(t.dueDate, today),
  ).length;
}
