// 同步引擎：拉取远端 -> 任务级 LWW + 墓碑合并 -> 带 ETag 乐观锁推回。
// 设计要点：
//  - applyMerged 回调由数据仓库提供，仓库会把「合并结果」再与「当前活数据」
//    做一次合并，保证同步期间用户的本地编辑不丢失；
//  - 单飞行（single-flight）+ 结束后按需重跑；
//  - 412 冲突自动重拉重试（最多 3 轮）。

import type { Database, WebDAVConfig } from "@/core/models";
import { mergeDatabases } from "@/core/merge";
import { normalizeDatabase } from "@/core/operations";
import { getSecret } from "@/lib/secrets";
import {
  DavError,
  davEnsureDirectory,
  davGet,
  davPut,
  type DavConfig,
} from "./webdav";

const DATA_FILE = "todolite-data.json";
const SECRET_KEY = "webdav";
const MAX_ATTEMPTS = 3;

export type SyncOutcome = "ok" | "error" | "skipped";

export interface SyncParams {
  cfg: WebDAVConfig;
  local: Database;
  applyMerged: (db: Database) => void;
}

export interface SyncHooks {
  onStatus(status: "syncing" | "ok" | "error", message: string | null): void;
  onLastSyncAt(iso: string): void;
}

let hooks: SyncHooks = {
  onStatus: () => {},
  onLastSyncAt: () => {},
};

export function setSyncHooks(h: Partial<SyncHooks>): void {
  hooks = { ...hooks, ...h };
}

let running = false;
let rerunRequested = false;

export function isSyncRunning(): boolean {
  return running;
}

export async function syncNow(params: SyncParams): Promise<SyncOutcome> {
  if (!params.cfg?.url) {
    hooks.onStatus("ok", null);
    return "skipped";
  }
  if (running) {
    rerunRequested = true;
    return "skipped";
  }
  running = true;
  hooks.onStatus("syncing", null);
  let outcome: SyncOutcome = "error";
  try {
    outcome = await runOnce(params);
  } finally {
    running = false;
  }
  if (rerunRequested) {
    rerunRequested = false;
    // 数据在同步期间又变了，再跑一轮
    return syncNow(params);
  }
  return outcome;
}

async function runOnce(params: SyncParams): Promise<SyncOutcome> {
  const password = (await getSecret(SECRET_KEY)) ?? "";
  const cfg: DavConfig = { ...params.cfg, password };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let remote: { text: string; etag: string | null } | null;
    try {
      remote = await davGet(cfg, DATA_FILE);
    } catch (e) {
      hooks.onStatus("error", describeError(e));
      return "error";
    }

    // 首次同步：远端不存在，直接推送本地
    if (remote === null) {
      try {
        await davEnsureDirectory(cfg);
        await davPut(cfg, DATA_FILE, serialize(params.local));
      } catch (e) {
        hooks.onStatus("error", describeError(e));
        return "error";
      }
      finishOk();
      params.applyMerged(params.local);
      return "ok";
    }

    let remoteDb: Database;
    try {
      remoteDb = normalizeDatabase(JSON.parse(remote.text));
    } catch {
      const msg = "远端数据损坏（不是有效的 TodoLite 数据）";
      hooks.onStatus("error", msg);
      return "error";
    }

    const { merged } = mergeDatabases(params.local, remoteDb);
    const mergedText = serialize(merged);

    if (mergedText !== remote.text) {
      try {
        await davPut(cfg, DATA_FILE, mergedText, remote.etag);
      } catch (e) {
        if (e instanceof DavError && e.status === 412) {
          continue; // 冲突：重拉重试
        }
        hooks.onStatus("error", describeError(e));
        return "error";
      }
    }

    params.applyMerged(merged);
    finishOk();
    return "ok";
  }

  const msg = "多次尝试后仍存在冲突，请稍后重试";
  hooks.onStatus("error", msg);
  return "error";
}

function serialize(db: Database): string {
  return JSON.stringify(db, null, 2);
}

function finishOk(): void {
  const now = new Date().toISOString();
  hooks.onStatus("ok", null);
  hooks.onLastSyncAt(now);
}

export function describeError(e: unknown): string {
  if (e instanceof DavError) {
    if (e.status === 401) return "账号或密码错误（401）";
    if (e.status === 403) return "没有访问权限（403）";
    if (e.status === 413) return "数据过大，服务器拒绝（413）";
    if (e.status === 507) return "网盘空间不足（507）";
    return e.message;
  }
  if (e instanceof Error) return `网络错误：${e.message}`;
  return `同步失败：${String(e)}`;
}
