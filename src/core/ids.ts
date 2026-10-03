// ID 生成：优先 crypto.randomUUID（WebView 安全上下文可用），降级随机串。

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return (
    "id-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}
