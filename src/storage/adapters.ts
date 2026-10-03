// StoragePort 实现：Tauri 文件存储 / 浏览器 localStorage（dev 用）

import { invoke } from "@tauri-apps/api/core";
import type { Database } from "@/core/models";
import { memoryStorage, type StoragePort } from "@/core/storage-port";
import { isTauri } from "@/lib/tauri";

const LS_KEY = "todolite-data";

export const browserStorage: StoragePort = {
  async load() {
    const text = localStorage.getItem(LS_KEY);
    if (!text) return null;
    try {
      return JSON.parse(text) as Database;
    } catch {
      return null;
    }
  },
  async save(db) {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  },
};

export const tauriStorage: StoragePort = {
  async load() {
    return invoke<Database | null>("read_database");
  },
  async save(db) {
    await invoke("write_database", { data: db });
  },
};

export function getStorage(): StoragePort {
  if (isTauri()) return tauriStorage;
  if (typeof localStorage !== "undefined") return browserStorage;
  return memoryStorage;
}
