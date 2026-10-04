// WebDAV 同步后端：基于统一网络出口 sync/http（Tauri 命令，绕过 WebView CORS，
// 支持自定义方法与代理）。使用最小操作集：GET / PUT(If-Match) / MKCOL / PROPFIND。

import { bodySnippet, httpFetch } from "./http";
import { utf8ToBase64 } from "@/lib/base64";
import { ConflictError, type SyncBackend } from "./backend";

export const WEBDAV_DATA_FILE = "todolite-data.json";

export interface DavConfig {
  url: string;
  username: string;
  password: string;
  directory: string;
}

export class DavError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "DavError";
    this.status = status;
  }
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function normalizeDir(dir: string): string {
  return dir.trim().replace(/^\/+|\/+$/g, "");
}

export function fileUrl(cfg: DavConfig, rel: string): string {
  const dir = normalizeDir(cfg.directory);
  return `${normalizeBaseUrl(cfg.url)}/${dir ? `${dir}/` : ""}${rel}`;
}

function utf8ToBase64Auth(s: string): string {
  return utf8ToBase64(s);
}

function authHeaders(cfg: DavConfig): Record<string, string> {
  if (!cfg.username && !cfg.password) return {};
  return { Authorization: `Basic ${utf8ToBase64Auth(`${cfg.username}:${cfg.password}`)}` };
}

function davError(res: { status: number; text: string }, action: string): DavError {
  return new DavError(`${action}（HTTP ${res.status}）${bodySnippet(res.text)}`, res.status);
}

/** GET 文件；404 返回 null（首次同步） */
export async function davGet(
  cfg: DavConfig,
  rel: string,
): Promise<{ text: string; etag: string | null } | null> {
  let res = await httpFetch(fileUrl(cfg, rel), {
    method: "GET",
    headers: authHeaders(cfg),
    timeoutMs: 20000,
  });
  // 坚果云等对「父目录不存在」的 GET 返回 409 而非 404：
  // 先补建目录再重试一次，仍失败才按错误处理
  if (res.status === 409) {
    await davEnsureDirectory(cfg);
    res = await httpFetch(fileUrl(cfg, rel), {
      method: "GET",
      headers: authHeaders(cfg),
      timeoutMs: 20000,
    });
  }
  if (res.status === 404) return null;
  if (!res.ok) throw davError(res, "读取失败");
  return { text: res.text, etag: res.headers.etag ?? null };
}

/** PUT 文件；412 表示远端已被其他人修改（乐观锁冲突） */
export async function davPut(
  cfg: DavConfig,
  rel: string,
  body: string,
  ifMatch?: string | null,
): Promise<{ etag: string | null }> {
  const headers = {
    ...authHeaders(cfg),
    "Content-Type": "application/json; charset=utf-8",
    ...(ifMatch ? { "If-Match": ifMatch } : {}),
  };
  const res = await httpFetch(fileUrl(cfg, rel), {
    method: "PUT",
    headers,
    body,
    timeoutMs: 20000,
  });
  if (res.status === 412) {
    throw new DavError("远端数据已被其他设备修改，需要重新合并", 412);
  }
  if (!res.ok) throw davError(res, "上传失败");
  return { etag: res.headers.etag ?? null };
}

/** 逐级 MKCOL 创建远程目录；已存在（405）视为成功 */
export async function davEnsureDirectory(cfg: DavConfig): Promise<void> {
  const segments = normalizeDir(cfg.directory).split("/").filter(Boolean);
  let acc = normalizeBaseUrl(cfg.url);
  for (const seg of segments) {
    acc += `/${seg}`;
    try {
      const res = await httpFetch(`${acc}/`, {
        method: "MKCOL",
        headers: authHeaders(cfg),
        timeoutMs: 20000,
      });
      if (res.ok || res.status === 405 || res.status === 301 || res.status === 409) {
        continue;
      }
      if (res.status === 403) {
        throw new DavError("服务器拒绝创建目录（403），请检查权限", 403);
      }
      // 其他状态码容忍：部分服务器会在 PUT 时自动建目录
    } catch (e) {
      if (e instanceof DavError) throw e;
      // 网络层错误继续尝试下一级，最终由 PUT 验证
    }
  }
}

/** 设置页「测试连接」 */
export async function davTest(
  cfg: DavConfig,
): Promise<{ ok: boolean; message: string }> {
  const base = normalizeBaseUrl(cfg.url);
  try {
    const res = await httpFetch(`${base}/`, {
      method: "PROPFIND",
      headers: { ...authHeaders(cfg), Depth: "0" },
      timeoutMs: 12000,
    });
    if (res.ok || res.status === 207) return { ok: true, message: "连接成功" };
    if (res.status === 401) return { ok: false, message: "账号或密码错误（401）" };
    if (res.status === 403) return { ok: false, message: "服务器拒绝访问（403）" };
    // 部分服务器对根路径 PROPFIND 有限制，回退 GET 验证
    const res2 = await httpFetch(base, {
      method: "GET",
      headers: authHeaders(cfg),
      timeoutMs: 12000,
    });
    if (res2.status === 401) return { ok: false, message: "账号或密码错误（401）" };
    if (res2.ok) return { ok: true, message: "连接成功" };
    return { ok: false, message: `服务器响应 ${res2.status}` };
  } catch (e) {
    return { ok: false, message: `网络错误：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** SyncBackend 适配器：把 davGet/davPut 包装为引擎所需接口 */
export function webdavBackend(cfg: DavConfig): SyncBackend {
  return {
    async pull() {
      const doc = await davGet(cfg, WEBDAV_DATA_FILE);
      return doc ? { text: doc.text, version: doc.etag } : null;
    },
    async prepare() {
      await davEnsureDirectory(cfg);
    },
    async push(text, version) {
      try {
        const r = await davPut(cfg, WEBDAV_DATA_FILE, text, version);
        return { version: r.etag };
      } catch (e) {
        if (e instanceof DavError && e.status === 412) {
          throw new ConflictError("远端数据已被其他设备修改");
        }
        throw e;
      }
    },
  };
}
