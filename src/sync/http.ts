// 统一网络出口：Tauri 下走自研命令 http_request（支持代理三模式），
// 浏览器环境回退原生 fetch（仅开发预览，代理不生效）。
//
// 代理配置由数据仓库经 setProxyProvider 注入，
// 避免 sync 层反向依赖 store 造成循环引用。

import { invoke } from "@tauri-apps/api/core";
import type { ProxyConfig } from "@/core/models";
import { DEFAULT_PROXY } from "@/core/models";
import { isTauri } from "@/lib/tauri";

export interface HttpTextResponse {
  status: number;
  ok: boolean;
  /** 键统一小写；WebDAV 依赖 etag 等 */
  headers: Record<string, string>;
  text: string;
}

export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** 超时毫秒；Tauri 端由 Rust 侧强制执行 */
  timeoutMs?: number;
  /** 仅浏览器回退路径生效 */
  signal?: AbortSignal;
}

let proxyProvider: () => ProxyConfig = () => ({ ...DEFAULT_PROXY });

export function setProxyProvider(fn: () => ProxyConfig): void {
  proxyProvider = fn;
}

/** 当前生效的代理配置（设置页展示用） */
export function activeProxy(): ProxyConfig {
  return proxyProvider() ?? { ...DEFAULT_PROXY };
}

async function tauriRequest(
  url: string,
  init: HttpRequestInit,
): Promise<HttpTextResponse> {
  const proxy = activeProxy();
  const r = await invoke<{
    status: number;
    ok: boolean;
    headers: [string, string][];
    body: string;
    finalUrl: string;
  }>("http_request", {
    method: init.method ?? "GET",
    url,
    headers: Object.entries(init.headers ?? {}),
    body: init.body ?? null,
    timeoutMs: init.timeoutMs ?? null,
    proxyMode: proxy.mode,
    proxyUrl: proxy.url,
  });
  const headers: Record<string, string> = {};
  for (const [k, v] of r.headers) headers[k] = v;
  return { status: r.status, ok: r.ok, headers, text: r.body };
}

async function browserRequest(
  url: string,
  init: HttpRequestInit,
): Promise<HttpTextResponse> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  return { status: res.status, ok: res.ok, headers, text: await res.text() };
}

export function httpFetch(
  url: string,
  init: HttpRequestInit = {},
): Promise<HttpTextResponse> {
  return isTauri() ? tauriRequest(url, init) : browserRequest(url, init);
}

/** 把响应体压成一行、截断，用于拼进错误信息（服务端原话比状态码更能定位问题） */
export function bodySnippet(text: string, max = 160): string {
  const s = text.trim().replace(/\s+/g, " ").slice(0, max);
  return s ? `：${s}` : "";
}
