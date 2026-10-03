// 同步状态（全局 UI 可订阅）

import { create } from "zustand";

export type SyncStatusKind = "idle" | "syncing" | "ok" | "error";

interface SyncState {
  status: SyncStatusKind;
  message: string | null;
  lastSyncAt: string | null;
  update(p: Partial<Omit<SyncState, "update">>): void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: "idle",
  message: null,
  lastSyncAt: null,
  update: (p) => set(p),
}));
