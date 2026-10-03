// 敏感信息（WebDAV 密码）存取：
// Tauri 端走系统凭据管理器（macOS Keychain / Windows 凭据管理器 / Linux secret-service；
// Android 为应用私有目录文件）；浏览器 dev 回退内存。

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./tauri";

const memory = new Map<string, string>();

export async function setSecret(key: string, value: string): Promise<void> {
  if (!isTauri()) {
    memory.set(key, value);
    return;
  }
  await invoke("set_secret", { key, value });
}

export async function getSecret(key: string): Promise<string | null> {
  if (!isTauri()) return memory.get(key) ?? null;
  try {
    return await invoke<string | null>("get_secret", { key });
  } catch {
    return null;
  }
}

export async function deleteSecret(key: string): Promise<void> {
  if (!isTauri()) {
    memory.delete(key);
    return;
  }
  try {
    await invoke("delete_secret", { key });
  } catch {
    // 忽略：可能本就不存在
  }
}
