// 存储端口：领域层与 UI 只依赖此接口。
// 当前实现：Tauri 文件存储（三端一致）；浏览器 dev 回退 localStorage。
// 未来同步/云后端只需提供新的 StoragePort 实现。

import type { Database } from "./models";

export interface StoragePort {
  load(): Promise<Database | null>;
  save(db: Database): Promise<void>;
}

export const memoryStorage: StoragePort = (() => {
  let data: Database | null = null;
  return {
    async load() {
      return data;
    },
    async save(db) {
      data = db;
    },
  };
})();
