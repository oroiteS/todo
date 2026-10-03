import { describe, expect, it } from "vitest";
import {
  commitMessage,
  contentsApiUrl,
  ghDecodeContent,
  ghEncodeContent,
  isValidRepo,
  normalizePath,
} from "./github-protocol";

describe("github-protocol", () => {
  it("contentsApiUrl 编码路径段并拼接 ref", () => {
    expect(
      contentsApiUrl("https://api.github.com", "user/repo", "todolite-data.json", "main"),
    ).toBe("https://api.github.com/repos/user/repo/contents/todolite-data.json?ref=main");
    expect(
      contentsApiUrl("https://api.github.com", "user/repo", "data/todo.json"),
    ).toBe("https://api.github.com/repos/user/repo/contents/data/todo.json");
    // 路径中的特殊字符需要编码
    expect(contentsApiUrl("https://api.github.com", "a/b", "my data.json", "dev 1")).toBe(
      "https://api.github.com/repos/a/b/contents/my%20data.json?ref=dev%201",
    );
    // 目录路径的前后斜杠被清理
    expect(normalizePath("/data/todo.json/")).toBe("data/todo.json");
  });

  it("base64 编解码往返（含中文与 emoji）", () => {
    const samples = [
      "plain text",
      "中文内容：明天交报告 ✅",
      JSON.stringify({ title: " café ☕", nested: { ok: true } }),
    ];
    for (const s of samples) {
      expect(ghDecodeContent(ghEncodeContent(s))).toBe(s);
    }
  });

  it("ghDecodeContent 容忍 GitHub 返回的换行符", () => {
    const encoded = ghEncodeContent("hello 中文");
    const withNewlines = encoded.replace(/(.{4})/g, "$1\n").trim();
    expect(ghDecodeContent(withNewlines)).toBe("hello 中文");
  });

  it("commitMessage 生成同步提交信息", () => {
    const msg = commitMessage(new Date("2026-01-14T08:09:10Z"));
    expect(msg).toBe("todo-sync: 2026-01-14 08:09:10");
    expect(msg).toMatch(/^todo-sync: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("isValidRepo 校验 owner/repo", () => {
    expect(isValidRepo("user/repo")).toBe(true);
    expect(isValidRepo("user.name/repo.name-2")).toBe(true);
    expect(isValidRepo("justastring")).toBe(false);
    expect(isValidRepo("")).toBe(false);
  });
});
