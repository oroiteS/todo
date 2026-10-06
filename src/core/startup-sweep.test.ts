// 启动清扫端到端测试：复现 data.init 的真实序列
//   JSON 加载 -> normalizeDatabase -> purgeOldTombstones -> ensureInbox -> JSON 往返，
//   再与「30 天前的旧远端快照」合并，验证回收站 30 天清理：
//   1) 到期任务被硬删除并记入 purged 账本；
//   2) 旧远端快照里的残影合并不复活；
//   3) 反向（远端有账本、本地有残影）同样丢弃；
//   4) 未到期任务不受影响。
// 时间通过构造"过去的数据"穿越，无需真实等待。
import { describe, expect, it } from "vitest";
import { emptyDatabase, normalizeDatabase, purgeOldTombstones, ensureInbox } from "@/core/operations";
import { mergeDatabases } from "@/core/merge";
import type { Database } from "@/core/models";

const NOW = new Date("2026-01-14T08:00:00.000Z");
const DAYS = (n: number) => new Date(NOW.getTime() + n * 86400000).toISOString();

function rawDb(tasks: unknown[]): unknown {
  return {
    schemaVersion: 1,
    tasks,
    lists: [
      {
        id: "l1",
        name: "收集箱",
        color: "#000000",
        emoji: "📥",
        sortOrder: 0,
        createdAt: DAYS(-100),
        updatedAt: DAYS(-100),
        deletedAt: null,
      },
    ],
    settings: {},
  };
}

function trashedTask(id: string, deletedDaysAgo: number): unknown {
  return {
    id,
    listId: "l1",
    title: `回收站任务-${id}`,
    sortOrder: 0,
    priority: 0,
    completedAt: null,
    createdAt: DAYS(-100),
    updatedAt: DAYS(-deletedDaysAgo), // 删除时刻 = 最后修改时刻
    deletedAt: DAYS(-deletedDaysAgo),
  };
}

function activeTask(id: string): unknown {
  return {
    id,
    listId: "l1",
    title: `进行中-${id}`,
    sortOrder: 1,
    priority: 0,
    completedAt: null,
    createdAt: DAYS(-1),
    updatedAt: DAYS(-1),
    deletedAt: null,
  };
}

/** 应用启动序列（与 stores/data.ts init 相同的组合；时钟注入便于穿越 30 天） */
function startup(raw: unknown): Database {
  let db = normalizeDatabase(raw);
  db = purgeOldTombstones(db, 30, NOW);
  db = ensureInbox(db);
  // JSON 往返（persist -> 下次 load），保证 purged 字段在序列化中存活
  return normalizeDatabase(JSON.parse(JSON.stringify(db)));
}

describe("回收站 30 天清理——启动清扫端到端", () => {
  it("到期(31天前删除)任务被硬删除并记入账本；未到期任务保留", () => {
    const db = startup(
      rawDb([trashedTask("expired", 31), trashedTask("recent", 5), activeTask("live")]),
    );
    const ids = db.tasks.map((t) => t.id);
    expect(ids).not.toContain("expired"); // 31 天 → 清掉
    expect(ids).toContain("recent"); // 5 天 → 留着
    expect(ids).toContain("live");
    expect(db.purged["expired"]).toBe(NOW.toISOString());
    expect(db.purged["recent"]).toBeUndefined();
  });

  it("清理后与 30 天前的旧远端快照合并：残影不复活", () => {
    const local = startup(rawDb([trashedTask("expired", 31), activeTask("live")]));
    // 远端还是清理前的旧快照（比如另一台设备离线许久没同步）
    const remote = normalizeDatabase(rawDb([trashedTask("expired", 31), activeTask("live")]));
    const { merged } = mergeDatabases(local, remote, NOW);
    expect(merged.tasks.map((t) => t.id)).not.toContain("expired");
    expect(merged.tasks.map((t) => t.id)).toContain("live");
  });

  it("反向：远端已记账、本地有残影 → 同样丢弃（交换律）", () => {
    const swept = startup(rawDb([trashedTask("expired", 31)]));
    const stale = normalizeDatabase(rawDb([trashedTask("expired", 31)]));
    const ab = mergeDatabases(swept, stale, NOW).merged;
    const ba = mergeDatabases(stale, swept, NOW).merged;
    expect(ab.tasks.map((t) => t.id)).not.toContain("expired");
    expect(ba.tasks.map((t) => t.id)).not.toContain("expired");
    expect(ab.purged["expired"]).toBe(ba.purged["expired"]);
  });

  it("空回收站 + 无账本：启动清扫零改动（不触发无意义同步）", () => {
    const before = normalizeDatabase(rawDb([activeTask("live")]));
    const db = purgeOldTombstones(before, 30, NOW);
    expect(db).toBe(before); // 原引用返回
  });
});
