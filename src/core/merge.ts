// 同步合并算法：任务/列表按 id 并集 + 对象级 LWW（updatedAt 新者胜），
// 删除通过墓碑传播；设置以本地为准（本地用户体验优先），仅 lastSyncAt 取新。
// 纯函数、可交换验证的关键性质：merge(a, b) 逐任务确定、幂等。

import type { Database, Task, TaskList } from "./models";

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
): { merged: Database; changed: boolean } {
  const tasks: Task[] = mergeById(local.tasks, remote.tasks);
  const lists: TaskList[] = mergeById(local.lists, remote.lists);

  const localKeys = new Set(local.tasks.map((t) => t.id));
  const remoteKeys = new Set(remote.tasks.map((t) => t.id));

  const merged: Database = {
    schemaVersion: 1,
    tasks,
    lists,
    settings: {
      ...local.settings,
      lastSyncAt: maxIso(local.settings.lastSyncAt, remote.settings.lastSyncAt),
    },
  };

  const changed =
    remoteKeys.size !== tasks.length ||
    tasks.some((t) => {
      const r = remote.tasks.find((x) => x.id === t.id);
      return !r || JSON.stringify(r) !== JSON.stringify(t);
    }) ||
    [...remoteKeys].some((k) => !localKeys.has(k));

  return { merged, changed };
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
