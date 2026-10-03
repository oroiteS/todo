// 运行环境探测

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** macOS（用于红绿灯留白等平台特化 UI） */
export function isMacLike(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
}

export function isMobileWidth(): boolean {
  return typeof window !== "undefined" && window.innerWidth < 768;
}
