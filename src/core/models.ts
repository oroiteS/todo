// 领域模型 —— 三端共享，纯数据结构，零平台依赖。

export type ID = string;

/** 优先级：0 无 / 1 低 / 2 中 / 3 高 */
export type Priority = 0 | 1 | 2 | 3;

export interface Task {
  id: ID;
  listId: ID;
  title: string;
  notes?: string;
  /** 本地日期 "yyyy-MM-dd" */
  dueDate?: string;
  priority?: Priority;
  /** 分数排序：插入取相邻中点 */
  sortOrder: number;
  /** 完成时间（ISO datetime），null 表示未完成 */
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  /** 软删除墓碑（回收站） */
  deletedAt?: string | null;
}

export interface TaskList {
  id: ID;
  name: string;
  /** 列表主题色（hex） */
  color: string;
  emoji: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface WebDAVConfig {
  /** 例如 https://dav.jianguoyun.com/dav/ */
  url: string;
  username: string;
  /** 远程目录，默认 TodoLite/ */
  directory: string;
  autoSync: boolean;
}

export interface GitHubSyncConfig {
  /** owner/repo，建议私有仓库 */
  repo: string;
  /** 默认 main */
  branch: string;
  /** 仓库内文件路径，默认 todolite-data.json */
  path: string;
  autoSync: boolean;
}

export type ThemeMode = "system" | "light" | "dark";

export type SyncBackendKind = "webdav" | "github";

export type AccentName =
  | "rose"
  | "orange"
  | "amber"
  | "green"
  | "teal"
  | "sky"
  | "indigo"
  | "violet";

export const ACCENTS: Record<AccentName, string> = {
  rose: "#e11d48",
  orange: "#ea580c",
  amber: "#d97706",
  green: "#16a34a",
  teal: "#0d9488",
  sky: "#0284c7",
  indigo: "#4f46e5",
  violet: "#7c3aed",
};

export interface Settings {
  theme: ThemeMode;
  accent: AccentName;
  /** 当前使用的同步后端 */
  syncBackend: SyncBackendKind;
  /** WebDAV 配置（密码不在此处，存系统凭据管理器） */
  webdav: WebDAVConfig | null;
  /** GitHub 配置（Token 存系统凭据管理器） */
  github: GitHubSyncConfig | null;
  lastSyncAt: string | null;
}

export interface Database {
  schemaVersion: 1;
  tasks: Task[];
  lists: TaskList[];
  settings: Settings;
}

/** 默认列表可选的配色与 emoji */
export const LIST_COLORS = [
  "#e11d48",
  "#ea580c",
  "#d97706",
  "#16a34a",
  "#0d9488",
  "#0284c7",
  "#4f46e5",
  "#7c3aed",
  "#db2777",
  "#57534e",
];

export const LIST_EMOJIS = [
  "📥",
  "📋",
  "💼",
  "🏠",
  "📚",
  "✏️",
  "🎯",
  "🛒",
  "💡",
  "🏃",
  "🎧",
  "🌱",
];

export const DEFAULT_INBOX_NAME = "收集箱";
