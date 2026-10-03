// 同步引擎：后端无关（WebDAV / GitHub 均实现 SyncBackend）。
// 流程：拉取远端 -> 任务级 LWW + 墙碑合并 -> 带乐观锁推回。
// 设计要点：
//  - applyMerged 回调由数据仓库提供，仓库会把「合并结果」再与「当前活数据」
//    做一次合并，保证同步期间用户的本地编辑不丢失；
//  - 单飞行（single-flight）+ 结束后按需重跑；
//  - ConflictError（ETag/sha 冲突）自动重拉重试（最多 3 轮）。

import { normalizeDatabase } from "@/core/operations";
import { mergeDatabases } from "@/core/merge";
import type { Database } from "@/core/models";
import { ConflictError, type SyncParams } from "./backend";

const MAX_ATTEMPTS = 3;

export type SyncOutcome = "ok" | "error" | "skipped";

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
    return syncNow(params);
  }
  return outcome;
}

async function runOnce(params: SyncParams): Promise<SyncOutcome> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let remote: { text: string; version: string | null } | null;
    try {
      remote = await params.backend.pull();
    } catch (e) {
      hooks.onStatus("error", describeError(e));
      return "error";
    }

    // 首次同步：远端不存在，准备后直接推送本地
    if (remote === null) {
      try {
        await params.backend.prepare?.();
        await params.backend.push(serialize(params.local), null);
      } catch (e) {
        if (e instanceof ConflictError) continue;
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
        await params.backend.push(mergedText, remote.version);
      } catch (e) {
        if (e instanceof ConflictError) continue; // 冲突：重拉重试
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
  if (e instanceof Error) {
    const status = (e as Error & { status?: number }).status;
    if (status === 401) return `认证失败（401）：${e.message}`;
    if (status === 403) return `权限不足（403）：${e.message}`;
    if (status === 404) return `资源不存在（404）：${e.message}`;
    return e.message || `同步失败：${String(e)}`;
  }
  return `同步失败：${String(e)}`;
}
