// 主题应用：深浅色 + 强调色写到 CSS 变量

import { ACCENTS, type Settings } from "@/core/models";

export function applyTheme(settings: Settings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const dark =
    settings.theme === "dark" ||
    (settings.theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
  root.style.setProperty("--accent", ACCENTS[settings.accent] ?? ACCENTS.rose);
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function watchSystemTheme(cb: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
