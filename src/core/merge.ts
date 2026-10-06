// 同步合并算法：任务/列表按 id 并集 + 对象级 LWW（updatedAt 新者胜），
// 软删除通过 deletedAt 墓碑传播；硬删除（彻底删除/清空回收站）通过 purged
// 墓碑账本传播（并集 + 与任务 updatedAt 比时序）；设置以本地为准
// （本地用户体验优先），仅 lastSyncAt 取新。
// 纯函数、可交换验证的关键性质：merge(a, b) 逐任务确定、幂等。

import type { Database, ID, Task, TaskList } from "./models";
import { dedupeInboxes } from "./operations";

function newer<T extends { updatedAt: string }>(a: T, b: T): T {
  return a.updatedAt >= b.updatedAt ? a : b;
}

function mergeById<T extends { id: string; updatedAt: string }>(
  local: T[],
  remote: T[],
): T[] {
  const map = new Map<string, T>();
  for (const item of local) map.set(item.id, item);
  for (const item of remote) {
    const exist = map.get(item.id);
    map.set(item.id, exist ? newer(exist, item) : item);
  }
  return [...map.values()];
}

export function mergeDatabases(
  local: Database,
  remote: Database,
  now: Date = new Date(),
): { merged: Database; changed: boolean } {
  // 永久删除墓碑账本：两侧并集，同 id 取较新时间
  const purged: Record<ID, string> = {};
  for (const [id, at] of Object.entries(local.purged)) purged[id] = at;
  for (const [id, at] of Object.entries(remote.purged)) {
    if (!purged[id] || at > purged[id]) purged[id] = at;
  }

  const tasks: Task[] = mergeById(local.tasks, remote.tasks).filter((t) => {
    const at = purged[t.id];
    if (at === undefined) return true;
    if (t.updatedAt > at) {
      // 墓碑之后任务又被修改/恢复 → 任务生效，撤销墓碑（事件新者赢，收敛不摆）
      delete purged[t.id];
      return true;
    }
    // 墓碑生效：丢弃远端（或本地）残影，否则清空的回收站会在同步后复活
    return false;
  });
  const lists: TaskList[] = mergeById(local.lists, remote.lists).filter((l) => {
    const at = purged[l.id];
    if (at === undefined) return true;
    if (l.updatedAt > at) {
      delete purged[l.id];
      return true;
    }
    // 列表被 30 天清扫/彻底删除后，丢弃远端残影
    return false;
  });

  const localKeys = new Set(local.tasks.map((t) => t.id));
  const remoteKeys = new Set(remote.tasks.map((t) => t.id));

  // 多设备各自首启会创建不同 id 的同名收集箱，合并后统一去重
  // （确定性：保留最早创建者，各设备算出同一结果，保持交换律/幂等）
  const merged = dedupeInboxes(
    {
      schemaVersion: 1,
      tasks,
      lists,
      purged,
      settings: {
        ...local.settings,
        lastSyncAt: maxIso(local.settings.lastSyncAt, remote.settings.lastSyncAt),
      },
    },
    now,
  );

  const remotePurged = remote.purged;
  const purgedChanged =
    Object.keys(purged).length !== Object.keys(remotePurged).length ||
    Object.entries(purged).some(([id, at]) => remotePurged[id] !== at);

  const changed =
    remoteKeys.size !== tasks.length ||
    tasks.some((t) => {
      const r = remote.tasks.find((x) => x.id === t.id);
      return !r || JSON.stringify(r) !== JSON.stringify(t);
    }) ||
    [...remoteKeys].some((k) => !localKeys.has(k)) ||
    purgedChanged;

  return { merged, changed };
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
