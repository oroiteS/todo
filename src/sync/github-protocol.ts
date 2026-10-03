// GitHub 同步的纯协议工具（零依赖，可单测）。
// 实现：GitHub Contents API —— GET 读文件（content + sha），
// PUT 写文件（带 sha 乐观锁）；每次 PUT 在仓库中生成一个真实 commit。

import { base64ToUtf8, utf8ToBase64 } from "@/lib/base64";

export const GITHUB_API_BASE = "https://api.github.com";
export const DEFAULT_GITHUB_PATH = "todolite-data.json";

/** GET /repos/{owner}/{repo}/contents/{path}?ref={branch} */
export function contentsApiUrl(
  apiBase: string,
  repo: string,
  path: string,
  branch?: string,
): string {
  const encodedPath = normalizePath(path)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  return `${apiBase.replace(/\/+$/, "")}/repos/${repo}/contents/${encodedPath}${ref}`;
}

export function normalizePath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

/** GitHub 返回的 base64（含换行）→ UTF-8 文本 */
export function ghDecodeContent(b64: string): string {
  return base64ToUtf8(b64);
}

/** UTF-8 文本 → base64（PUT 请求体用） */
export function ghEncodeContent(text: string): string {
  return utf8ToBase64(text);
}

/** 同步提交信息：出现在 GitHub 仓库的提交历史里 */
export function commitMessage(now: Date = new Date()): string {
  const ts = now.toISOString().slice(0, 19).replace("T", " ");
  return `todo-sync: ${ts}`;
}

/** 校验 owner/repo 形式 */
export function isValidRepo(repo: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(repo.trim());
}
