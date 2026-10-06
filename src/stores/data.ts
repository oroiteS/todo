// 数据仓库：唯一的可变状态入口。
// 所有领域操作经由 core/operations 的纯函数完成，随后：
//   persistSoon   -> 400ms 防抖写盘（原子写 + 备份在 Rust 侧）
//   snapshotSoon  -> 600ms 防抖推送小组件快照
//   autoSyncSoon  -> 2.5s 防抖触发 WebDAV 自动同步（仅配置且开启时）

import { create } from "zustand";
import type {
  Database,
  GitHubSyncConfig,
  ID,
  Priority,
  Settings,
  Task,
  TaskList,
  WebDAVConfig,
} from "@/core/models";
import * as ops from "@/core/operations";
import { mergeDatabases } from "@/core/merge";
import { getStorage } from "@/storage/adapters";
import { widgetBridge } from "@/bridge/widget";
import { applyTheme } from "@/lib/theme";
import { setSyncHooks, syncNow } from "@/sync/engine";
import { setProxyProvider } from "@/sync/http";
import { githubBackend } from "@/sync/github";
import { webdavBackend } from "@/sync/webdav";
import { deleteSecret, getSecret } from "@/lib/secrets";
import { useSyncStore } from "./sync";

interface DataStore {
  db: Database;
  loaded: boolean;
  init(): Promise<void>;
  addTask(fields: {
    title: string;
    dueDate?: string;
    priority?: Priority;
    listId?: ID;
    notes?: string;
  }): Task | null;
  updateTask(
    id: ID,
    patch: Partial<Pick<Task, "title" | "notes" | "dueDate" | "priority" | "listId">>,
  ): void;
  toggleTask(id: ID): void;
  deleteTask(id: ID): void;
  restoreTask(id: ID): void;
  purgeTask(id: ID): void;
  emptyTrash(): void;
  reorderTask(id: ID, visibleIds: ID[], targetIndex: number): void;
  addList(name: string, color?: string, emoji?: string): TaskList | null;
  updateList(
    id: ID,
    patch: Partial<Pick<TaskList, "name" | "color" | "emoji">>,
  ): void;
  deleteList(id: ID): void;
  updateSettings(patch: Partial<Settings>): void;
  setWebDAV(cfg: WebDAVConfig | null): void;
  setGitHub(cfg: GitHubSyncConfig | null): void;
  /** 同步结果回写：与当前活数据再合并，绝不触发新一轮自动同步 */
  replaceDatabase(incoming: Database): void;
  importDatabase(raw: unknown): boolean;
  exportJson(): string;
  triggerSync(): Promise<void>;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

export const useDataStore = create<DataStore>((set, get) => {
  const schedule = (
    timer: ReturnType<typeof setTimeout> | null,
    ms: number,
    fn: () => void,
  ) => {
    if (timer) clearTimeout(timer);
    return setTimeout(fn, ms);
  };

  const persistNow = () => void getStorage().save(get().db);
  const schedulePersist = () => {
    persistTimer = schedule(persistTimer, 400, persistNow);
  };
  const scheduleSnapshot = () => {
    snapshotTimer = schedule(snapshotTimer, 600, () => {
      void widgetBridge.pushSnapshot(get().db);
    });
  };
  const scheduleAutoSync = () => {
    const s = get().db.settings;
    // 任一已启用通道开了自动同步，就触发一次全量同步（已启用通道依次执行）
    const anyAuto =
      (s.webdavEnabled && s.webdav?.autoSync) || (s.githubEnabled && s.github?.autoSync);
    if (!anyAuto) return;
    syncTimer = schedule(syncTimer, 2500, () => void get().triggerSync());
  };

  const mutate = (fn: (db: Database) => Database) => {
    const next = fn(get().db);
    set({ db: next });
    schedulePersist();
    scheduleSnapshot();
    scheduleAutoSync();
  };

  // 同步引擎回调接线
  setSyncHooks({
    onStatus: (status, message) =>
      useSyncStore.getState().update({ status, message }),
    onLastSyncAt: (iso) => {
      useSyncStore.getState().update({ lastSyncAt: iso });
      // lastSyncAt 持久化到 settings（不触发同步，避免循环）
      set({ db: { ...get().db, settings: { ...get().db.settings, lastSyncAt: iso } } });
      schedulePersist();
    },
  });

  // 统一网络出口的代理配置来自设置（webdav/github 的所有请求经此读取）
  setProxyProvider(() => get().db.settings.proxy);

  return {
    db: ops.emptyDatabase(),
    loaded: false,

    async init() {
      const storage = getStorage();
      let db: Database;
      try {
        const raw = await storage.load();
        db = raw ? ops.normalizeDatabase(raw) : ops.emptyDatabase();
      } catch (err) {
        console.error("[data] load failed:", err);
        db = ops.emptyDatabase();
      }
      // 启动清扫：回收站保留期满（30 天）的任务/列表硬删除并记入永久删除
      // 账本（同步据此丢弃远端残影），同时清理过期账本条目——「保留 30 天
      // 后自动清理」由此生效。
      db = ops.purgeOldTombstones(db);
      db = ops.ensureInbox(db);
      set({ db, loaded: true });
      applyTheme(db.settings);
      if (!db.lists.length) {
        mutate((d) => ops.ensureInbox(d));
      }
      persistNow();
      void widgetBridge.pushSnapshot(db);
    },

    addTask(fields) {
      const listId = fields.listId ?? fallbackListId(get().db);
      if (!listId) return null;
      let created: Task | null = null;
      mutate((db) => {
        const r = ops.createTask(db, { ...fields, listId });
        created = r.task;
        return r.db;
      });
      return created;
    },

    updateTask(id, patch) {
      mutate((db) => ops.updateTask(db, id, patch));
    },

    toggleTask(id) {
      mutate((db) => ops.toggleTask(db, id));
    },

    deleteTask(id) {
      mutate((db) => ops.softDeleteTask(db, id));
    },

    restoreTask(id) {
      mutate((db) => ops.restoreTask(db, id));
    },

    purgeTask(id) {
      mutate((db) => ops.purgeTask(db, id));
    },

    emptyTrash() {
      mutate((db) => ops.emptyTrash(db));
    },

    reorderTask(id, visibleIds, targetIndex) {
      mutate((db) => ops.reorderTask(db, id, visibleIds, targetIndex));
    },

    addList(name, color, emoji) {
      let created: TaskList | null = null;
      mutate((db) => {
        const r = ops.createList(db, name, color, emoji);
        created = r.list;
        return r.db;
      });
      return created;
    },

    updateList(id, patch) {
      mutate((db) => ops.updateList(db, id, patch));
    },

    deleteList(id) {
      mutate((db) => ops.softDeleteList(db, id));
    },

    updateSettings(patch) {
      mutate((db) => ({
        ...db,
        settings: { ...db.settings, ...patch },
      }));
      applyTheme(get().db.settings);
    },

    setWebDAV(cfg) {
      mutate((db) => ({
        ...db,
        settings: { ...db.settings, webdav: cfg },
      }));
    },

    setGitHub(cfg) {
      mutate((db) => ({
        ...db,
        settings: { ...db.settings, github: cfg },
      }));
      if (!cfg) void deleteSecret("github");
    },

    replaceDatabase(incoming) {
      // 防竞态：同步期间的本地新编辑 updatedAt 更新，合并后胜出
      const { merged } = mergeDatabases(get().db, incoming);
      set({ db: merged });
      schedulePersist();
      scheduleSnapshot();
    },

    importDatabase(raw) {
      try {
        let db = ops.normalizeDatabase(raw);
        if (!db.lists.length) {
          db = ops.ensureInbox(db);
        }
        set({ db });
        applyTheme(db.settings);
        persistNow();
        void widgetBridge.pushSnapshot(db);
        return true;
      } catch {
        return false;
      }
    },

    exportJson() {
      return JSON.stringify(get().db, null, 2);
    },

    async triggerSync() {
      const s = get().db.settings;
      const applyMerged = (db: Database) => get().replaceDatabase(db);

      // 收集已启用通道（按声明顺序依次执行）
      const channels: Array<{ name: string; run(): Promise<void> }> = [];
      if (s.webdavEnabled) {
        const cfg = s.webdav;
        channels.push({
          name: "WebDAV",
          run: async () => {
            if (!cfg?.url) throw new Error("已启用但未配置服务器地址");
            const password = (await getSecret("webdav")) ?? "";
            await syncNow({
              backend: webdavBackend({ ...cfg, password }),
              local: get().db,
              applyMerged,
            });
          },
        });
      }
      if (s.githubEnabled) {
        const cfg = s.github;
        channels.push({
          name: "GitHub",
          run: async () => {
            if (!cfg?.repo) throw new Error("已启用但未配置仓库");
            const token = (await getSecret("github")) ?? "";
            await syncNow({
              backend: githubBackend(cfg, token),
              local: get().db,
              applyMerged,
            });
          },
        });
      }

      if (!channels.length) {
        useSyncStore
          .getState()
          .update({ status: "error", message: "未启用任何同步通道（设置 → 同步）" });
        return;
      }

      // 依次执行，聚合结果：任一失败都进错误信息，并注明成功通道数
      const failures: string[] = [];
      for (const ch of channels) {
        useSyncStore.getState().update({ status: "syncing", message: `正在同步 ${ch.name}…` });
        try {
          await ch.run();
        } catch (e) {
          failures.push(`${ch.name}：${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        const st = useSyncStore.getState();
        if (st.status === "error") {
          failures.push(`${ch.name}：${st.message ?? "失败"}`);
        }
      }

      if (failures.length) {
        const okCount = channels.length - failures.length;
        const suffix = okCount > 0 ? `（${okCount} 个通道成功）` : "";
        useSyncStore
          .getState()
          .update({ status: "error", message: `${failures.join("；")}${suffix}` });
      } else {
        useSyncStore.getState().update({ status: "ok", message: null });
      }
    },
  };
});

function fallbackListId(db: Database): ID {
  const lists = ops.visibleLists(db);
  return lists[0]?.id ?? "";
}
