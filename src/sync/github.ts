// GitHub 同步后端：Contents API + Personal Access Token（HTTPS，三端一致，
// 无需 SSH 密钥）。fine-grained PAT 只需「选中仓库 + Contents 读写」权限。

import { bodySnippet, httpFetch } from "./http";
import {
  ConflictError,
  HttpSyncError,
  type SyncBackend,
} from "./backend";
import {
  commitMessage,
  contentsApiUrl,
  ghDecodeContent,
  ghEncodeContent,
  GITHUB_API_BASE,
  isValidRepo,
  normalizePath,
} from "./github-protocol";

export interface GitHubConfig {
  /** owner/repo */
  repo: string;
  /** 默认 main */
  branch: string;
  /** 仓库内文件路径，默认 todolite-data.json */
  path: string;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

function authError(res: { status: number; text: string }): never {
  if (res.status === 401) {
    throw new HttpSyncError("Token 无效或已过期（401）", 401);
  }
  if (res.status === 403) {
    throw new HttpSyncError(
      `Token 权限不足（403）${bodySnippet(res.text)}：fine-grained Token 需勾选该仓库的 Contents 读写权限`,
      403,
    );
  }
  throw new HttpSyncError(
    `GitHub 请求失败（HTTP ${res.status}）${bodySnippet(res.text)}`,
    res.status,
  );
}

/** GET contents；404（仓库内无此文件）返回 null 表示首次同步 */
export async function ghGetFile(
  token: string,
  cfg: GitHubConfig,
): Promise<{ text: string; sha: string } | null> {
  if (!isValidRepo(cfg.repo)) {
    throw new HttpSyncError("仓库名格式应为 owner/repo", 400);
  }
  const res = await httpFetch(
    contentsApiUrl(GITHUB_API_BASE, cfg.repo, cfg.path, cfg.branch),
    { method: "GET", headers: headers(token), timeoutMs: 20000 },
  );
  if (res.status === 404) return null;
  if (!res.ok) authError(res);

  const data = JSON.parse(res.text) as {
    content?: string | null;
    encoding?: string;
    sha?: string;
    size?: number;
  };
  if (data.encoding !== "base64" || typeof data.content !== "string" || !data.sha) {
    throw new HttpSyncError(
      `文件过大（${Math.round((data.size ?? 0) / 1024)}KB）：Contents API 上限 1MB，请精简数据或改用 WebDAV`,
    );
  }
  return { text: ghDecodeContent(data.content), sha: data.sha };
}

/** PUT contents：带 sha 乐观锁；每次写入 = 一个真实 commit */
export async function ghPutFile(
  token: string,
  cfg: GitHubConfig,
  text: string,
  sha: string | null,
): Promise<{ sha: string }> {
  const body: Record<string, unknown> = {
    message: commitMessage(),
    content: ghEncodeContent(text),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;

  const url = contentsApiUrl(GITHUB_API_BASE, cfg.repo, cfg.path);
  const res = await httpFetch(url, {
    method: "PUT",
    headers: headers(token),
    body: JSON.stringify(body),
    timeoutMs: 30000,
  });

  if (res.status === 409 || res.status === 422) {
    // sha 不匹配：远端已被其他设备更新（Conflicting files / Invalid request）
    throw new ConflictError("远端已有更新的提交，需要重新合并");
  }
  if (res.status === 404) {
    throw new HttpSyncError(
      `仓库或分支不存在（404）：请确认 ${cfg.repo} 存在且 ${cfg.branch} 分支已创建（私有仓库需 Token 有权限）`,
      404,
    );
  }
  if (!res.ok) authError(res);

  const data = JSON.parse(res.text) as { content?: { sha?: string } };
  return { sha: data.content?.sha ?? sha ?? "" };
}

/** 设置页「测试连接」：仓库可见性 → 分支存在性 */
export async function ghTest(
  token: string,
  cfg: GitHubConfig,
): Promise<{ ok: boolean; message: string }> {
  if (!isValidRepo(cfg.repo)) {
    return { ok: false, message: "仓库名格式应为 owner/repo" };
  }
  try {
    const repoRes = await httpFetch(`${GITHUB_API_BASE}/repos/${cfg.repo}`, {
      method: "GET",
      headers: headers(token),
      timeoutMs: 12000,
    });
    if (repoRes.status === 401) return { ok: false, message: "Token 无效或已过期（401）" };
    if (repoRes.status === 404) {
      return { ok: false, message: "仓库不存在或 Token 无权访问（404）" };
    }
    if (!repoRes.ok) {
      return { ok: false, message: `GitHub 响应 ${repoRes.status}` };
    }
    const branchRes = await httpFetch(
      `${GITHUB_API_BASE}/repos/${cfg.repo}/branches/${encodeURIComponent(cfg.branch)}`,
      { method: "GET", headers: headers(token), timeoutMs: 12000 },
    );
    if (branchRes.status === 404) {
      return { ok: false, message: `分支 ${cfg.branch} 不存在，请在 GitHub 上创建（如 main）` };
    }
    return { ok: true, message: "连接成功：仓库与分支均可访问" };
  } catch (e) {
    return {
      ok: false,
      message: `网络错误：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** SyncBackend 适配器 */
export function githubBackend(cfg: GitHubConfig, token: string): SyncBackend {
  const normalized: GitHubConfig = {
    repo: cfg.repo.trim(),
    branch: cfg.branch.trim() || "main",
    path: normalizePath(cfg.path) || "todolite-data.json",
  };
  return {
    async pull() {
      const file = await ghGetFile(token, normalized);
      return file ? { text: file.text, version: file.sha } : null;
    },
    async push(text, version) {
      const r = await ghPutFile(token, normalized, text, version);
      return { version: r.sha };
    },
  };
}
