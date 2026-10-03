// 同步后端抽象：WebDAV 与 GitHub 是两个可插拔实现，
// 同步引擎只依赖此接口（pull / push / prepare）。

import type { Database } from "@/core/models";

/** 远端文档：text 为 JSON 序列化内容，version 为乐观锁凭证（ETag / 文件 sha） */
export interface RemoteDoc {
  text: string;
  version: string | null;
}

export interface SyncBackend {
  /** 拉取远端；null 表示远端尚无数据（首次同步） */
  pull(): Promise<RemoteDoc | null>;
  /**
   * 推送内容。version 必须与 pull 时一致，否则抛 ConflictError（由引擎
   * 重拉重合并后重试）。
   */
  push(text: string, version: string | null): Promise<{ version: string | null }>;
  /** 首次推送前的准备（WebDAV 建目录等），可选 */
  prepare?(): Promise<void>;
}

/** push 时 version 冲突 —— 引擎捕获后重试 */
export class ConflictError extends Error {
  constructor(message = "远端已被其他设备修改") {
    super(message);
    this.name = "ConflictError";
  }
}

/** 带状态码的同步错误（用于向用户展示可读信息） */
export class HttpSyncError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "HttpSyncError";
    this.status = status;
  }
}

export interface SyncParams {
  backend: SyncBackend;
  local: Database;
  applyMerged: (db: Database) => void;
}
