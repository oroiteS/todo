import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Cloud,
  CloudUpload,
  Database,
  Download,
  Github,
  Loader2,
  Palette,
  RefreshCw,
  X,
} from "lucide-react";
import { ACCENTS, type AccentName, type ThemeMode } from "@/core/models";
import { davTest } from "@/sync/webdav";
import { ghTest } from "@/sync/github";
import { useDataStore } from "@/stores/data";
import { useSyncStore } from "@/stores/sync";
import { useUiStore } from "@/stores/ui";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { getSecret, setSecret } from "@/lib/secrets";
import { isTauri } from "@/lib/tauri";

const inputCls =
  "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent/60";
const labelCls = "mb-1.5 block text-xs font-medium text-ink2";
const btnCls =
  "flex items-center justify-center gap-1.5 rounded-lg border border-line bg-panel px-3.5 py-2 text-[13px] font-medium transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50";
const btnPrimaryCls =
  "flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[13px] font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50";

export function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fade-in absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
      />
      <div className="pop-in relative flex max-h-[88vh] w-[580px] max-w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/20">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-bold">设置</h2>
          <button
            type="button"
            aria-label="关闭设置"
            onClick={() => setOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-panel2 hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          <AppearanceSection />
          <SyncSection />
          <DataSection />
          <AboutSection />
        </div>
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line/60 bg-panel2/40 p-4">
      <h3 className="mb-3 flex items-center gap-2 text-[13px] font-bold">
        <span className="text-ink2">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

// ---------- 外观 ----------

const THEMES: Array<{ value: ThemeMode; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

function AppearanceSection() {
  const theme = useDataStore((s) => s.db.settings.theme);
  const accent = useDataStore((s) => s.db.settings.accent);
  const updateSettings = useDataStore((s) => s.updateSettings);

  // 选中色变化时,把该色点滚到可见区域(色板为横向滚动容器)
  const accentScrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    accentScrollerRef.current
      ?.querySelector('[data-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [accent]);

  return (
    <Card icon={<Palette size={14} />} title="外观">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 rounded-xl bg-panel2 p-1">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => updateSettings({ theme: t.value })}
              className={cn(
                "flex-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-[13px] transition-all",
                theme === t.value
                  ? "bg-panel font-medium shadow-sm"
                  : "text-ink2 hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* 色板:横向滚动,同屏约 4 个,把宽度留给左侧主题切换 */}
        <div
          ref={accentScrollerRef}
          className="w-[106px] shrink-0 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex w-max gap-1.5 p-1">
            {(Object.keys(ACCENTS) as AccentName[]).map((name) => (
              <button
                key={name}
                type="button"
                aria-label={`强调色 ${name}`}
                data-selected={accent === name}
                onClick={() => updateSettings({ accent: name })}
                className={cn(
                  "h-5 w-5 shrink-0 rounded-full transition-transform hover:scale-110",
                  accent === name &&
                    "ring-2 ring-ink/30 ring-offset-2 ring-offset-panel",
                )}
                style={{ background: ACCENTS[name] }}
              />
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------- 同步 ----------

function Switch({ checked, onChange }: { checked: boolean; onChange(v: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
        checked ? "bg-accent" : "bg-ink3/40",
      )}
    >
      <span
        className={cn(
          "block h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}

function StatusLine({
  localMsg,
  lastSyncAt,
}: {
  localMsg: { ok: boolean; text: string } | null;
  lastSyncAt: string | null;
}) {
  const { status, message } = useSyncStore();
  return (
    <p
      className={cn(
        "mt-2.5 text-xs",
        localMsg ? (localMsg.ok ? "text-ok" : "text-danger") : "text-ink3",
      )}
    >
      {localMsg
        ? localMsg.text
        : status === "error" && message
          ? message
          : lastSyncAt
            ? `上次同步：${formatRelativeTime(lastSyncAt)}`
            : "尚未同步"}
    </p>
  );
}

function SyncSection() {
  const syncBackend = useDataStore((s) => s.db.settings.syncBackend);
  const setSyncBackend = useDataStore((s) => s.setSyncBackend);

  return (
    <Card icon={<Cloud size={14} />} title="同步">
      <div className="mb-4 flex rounded-xl bg-panel2 p-1">
        {(
          [
            { value: "webdav", label: "WebDAV 网盘" },
            { value: "github", label: "GitHub 仓库" },
          ] as const
        ).map((b) => (
          <button
            key={b.value}
            type="button"
            onClick={() => setSyncBackend(b.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[13px] transition-all",
              syncBackend === b.value
                ? "bg-panel font-medium shadow-sm"
                : "text-ink2 hover:text-ink",
            )}
          >
            {b.value === "github" && <Github size={13} />}
            {b.label}
          </button>
        ))}
      </div>
      {syncBackend === "github" ? <GitHubForm /> : <WebDAVForm />}
    </Card>
  );
}

function WebDAVForm() {
  const webdav = useDataStore((s) => s.db.settings.webdav);
  const lastSyncAt = useDataStore((s) => s.db.settings.lastSyncAt);
  const setWebDAV = useDataStore((s) => s.setWebDAV);
  const triggerSync = useDataStore((s) => s.triggerSync);
  const { status } = useSyncStore();

  const [url, setUrl] = useState(webdav?.url ?? "");
  const [username, setUsername] = useState(webdav?.username ?? "");
  const [password, setPassword] = useState("");
  const [directory, setDirectory] = useState(webdav?.directory ?? "TodoLite");
  const [autoSync, setAutoSync] = useState(webdav?.autoSync ?? true);
  const [busy, setBusy] = useState<"test" | "save" | "sync" | null>(null);
  const [localMsg, setLocalMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const currentCfg = () => ({
    url: url.trim(),
    username: username.trim(),
    directory: directory.trim() || "TodoLite",
    autoSync,
  });

  const onTest = async () => {
    if (!url.trim()) {
      setLocalMsg({ ok: false, text: "请先填写服务器地址" });
      return;
    }
    setBusy("test");
    setLocalMsg(null);
    const savedPassword = await getSecret("webdav");
    const res = await davTest({
      ...currentCfg(),
      password: password.trim() || savedPassword || "",
    });
    setLocalMsg({ ok: res.ok, text: res.message });
    setBusy(null);
  };

  const onSave = async () => {
    setBusy("save");
    try {
      if (password.trim()) await setSecret("webdav", password.trim());
      setWebDAV(currentCfg());
      setLocalMsg({ ok: true, text: "配置已保存" });
    } catch (e) {
      setLocalMsg({ ok: false, text: `保存失败：${String(e)}` });
    }
    setBusy(null);
  };

  const onSync = async () => {
    setBusy("sync");
    await onSave();
    await triggerSync();
    setBusy(null);
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={labelCls}>服务器地址</label>
          <input
            className={inputCls}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://dav.jianguoyun.com/dav/"
          />
        </div>
        <div>
          <label className={labelCls}>账号</label>
          <input
            className={inputCls}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名 / 邮箱"
            autoComplete="off"
          />
        </div>
        <div>
          <label className={labelCls}>应用密码</label>
          <input
            className={inputCls}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={webdav ? "已保存（留空不修改）" : "应用专用密码"}
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className={labelCls}>远程目录</label>
          <input
            className={inputCls}
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            placeholder="TodoLite"
          />
        </div>
        <div className="flex items-end gap-2 pb-1">
          <Switch checked={autoSync} onChange={setAutoSync} />
          <span className="text-[13px] text-ink2">变更后自动同步</span>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button type="button" className={btnCls} onClick={onTest} disabled={busy !== null}>
          {busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <CloudUpload size={13} />}
          测试连接
        </button>
        <button type="button" className={btnPrimaryCls} onClick={onSave} disabled={busy !== null}>
          {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : null}
          保存配置
        </button>
        <button type="button" className={btnCls} onClick={onSync} disabled={busy !== null}>
          {busy === "sync" || status === "syncing" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
          立即同步
        </button>
      </div>

      <StatusLine localMsg={localMsg} lastSyncAt={lastSyncAt} />
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink3">
        坚果云等服务的 WebDAV 需使用「应用密码」而非登录密码；密码只存本机系统凭据管理器。
      </p>
    </div>
  );
}

function GitHubForm() {
  const gh = useDataStore((s) => s.db.settings.github);
  const lastSyncAt = useDataStore((s) => s.db.settings.lastSyncAt);
  const setGitHub = useDataStore((s) => s.setGitHub);
  const triggerSync = useDataStore((s) => s.triggerSync);
  const { status } = useSyncStore();

  const [repo, setRepo] = useState(gh?.repo ?? "");
  const [branch, setBranch] = useState(gh?.branch ?? "main");
  const [path, setPath] = useState(gh?.path ?? "todolite-data.json");
  const [token, setToken] = useState("");
  const [autoSync, setAutoSync] = useState(gh?.autoSync ?? true);
  const [busy, setBusy] = useState<"test" | "save" | "sync" | null>(null);
  const [localMsg, setLocalMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const currentCfg = () => ({
    repo: repo.trim(),
    branch: branch.trim() || "main",
    path: path.trim() || "todolite-data.json",
    autoSync,
  });

  const onTest = async () => {
    if (!repo.trim()) {
      setLocalMsg({ ok: false, text: "请先填写仓库名（owner/repo）" });
      return;
    }
    setBusy("test");
    setLocalMsg(null);
    const savedToken = await getSecret("github");
    const res = await ghTest(token.trim() || savedToken || "", currentCfg());
    setLocalMsg({ ok: res.ok, text: res.message });
    setBusy(null);
  };

  const onSave = async () => {
    setBusy("save");
    try {
      if (token.trim()) await setSecret("github", token.trim());
      setGitHub(currentCfg());
      setLocalMsg({ ok: true, text: "配置已保存" });
    } catch (e) {
      setLocalMsg({ ok: false, text: `保存失败：${String(e)}` });
    }
    setBusy(null);
  };

  const onSync = async () => {
    setBusy("sync");
    await onSave();
    await triggerSync();
    setBusy(null);
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>仓库（owner/repo）</label>
          <input
            className={inputCls}
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="your-name/todolite-sync"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div>
          <label className={labelCls}>分支</label>
          <input
            className={inputCls}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="main"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div>
          <label className={labelCls}>文件路径</label>
          <input
            className={inputCls}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="todolite-data.json"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div>
          <label className={labelCls}>访问 Token（PAT）</label>
          <input
            className={inputCls}
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={gh ? "已保存（留空不修改）" : "ghp_… / github_pat_…"}
            autoComplete="new-password"
          />
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <Switch checked={autoSync} onChange={setAutoSync} />
          <span className="text-[13px] text-ink2">变更后自动同步（每次同步 = 一个 commit）</span>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button type="button" className={btnCls} onClick={onTest} disabled={busy !== null}>
          {busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <CloudUpload size={13} />}
          测试连接
        </button>
        <button type="button" className={btnPrimaryCls} onClick={onSave} disabled={busy !== null}>
          {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : null}
          保存配置
        </button>
        <button type="button" className={btnCls} onClick={onSync} disabled={busy !== null}>
          {busy === "sync" || status === "syncing" ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
          立即同步
        </button>
      </div>

      <StatusLine localMsg={localMsg} lastSyncAt={lastSyncAt} />
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink3">
        建议使用私有仓库。Token 在 github.com/settings/personal-access-tokens/new 创建
        （fine-grained）：只勾选这一个仓库 +「Contents: Read and write」权限即可。
        认证走 HTTPS，三端配置方式完全相同，无需配置 SSH 密钥；Token 只存本机系统凭据管理器。
      </p>
    </div>
  );
}

// ---------- 数据 ----------

function DataSection() {
  const exportJson = useDataStore((s) => s.exportJson);
  const importDatabase = useDataStore((s) => s.importDatabase);
  const [dataDir, setDataDir] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    invoke<{ dataDir: string }>("platform_info")
      .then((info) => setDataDir(info.dataDir))
      .catch(() => {});
  }, []);

  const onExport = async () => {
    const json = exportJson();
    try {
      await navigator.clipboard.writeText(json);
      setMsg("已复制完整 JSON 到剪贴板，可粘贴保存");
    } catch {
      setImportOpen(true);
      setImportText(json);
      setMsg("剪贴板不可用，JSON 已填入下方文本框，请手动复制");
    }
  };

  const onImport = () => {
    try {
      const ok = importDatabase(JSON.parse(importText));
      setMsg(ok ? "导入成功" : "导入失败：数据格式不正确");
      if (ok) {
        setImportOpen(false);
        setImportText("");
      }
    } catch {
      setMsg("导入失败：不是有效的 JSON");
    }
  };

  return (
    <Card icon={<Database size={14} />} title="数据">
      <div className="flex items-center gap-2">
        <button type="button" className={btnCls} onClick={onExport}>
          <Download size={13} />
          导出（复制 JSON）
        </button>
        <button type="button" className={btnCls} onClick={() => setImportOpen((v) => !v)}>
          从 JSON 导入
        </button>
      </div>
      {importOpen && (
        <div className="mt-2">
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="粘贴 TodoLite 导出的 JSON 数据"
            className={cn(inputCls, "h-28 resize-none font-mono text-xs")}
          />
          <button type="button" className={cn(btnPrimaryCls, "mt-2")} onClick={onImport}>
            确认导入（覆盖当前数据）
          </button>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-ink2">{msg}</p>}
      {dataDir && (
        <p className="mt-2 text-xs leading-relaxed text-ink3">数据目录：{dataDir}</p>
      )}
    </Card>
  );
}

// ---------- 关于 ----------

function AboutSection() {
  const [info, setInfo] = useState<{ os: string; arch: string; appVersion: string } | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    invoke<{ os: string; arch: string; appVersion: string }>("platform_info")
      .then(setInfo)
      .catch(() => {});
  }, []);

  return (
    <Card icon={<Github size={14} />} title="关于">
      <p className="text-xs leading-relaxed text-ink3">
        TodoLite v{info?.appVersion ?? "0.1.0"}
        {info ? ` · ${info.os}/${info.arch}` : ""} · 轻量、本地优先的跨平台待办清单
        <br />
        数据存储在本机，通过你自己的 WebDAV 网盘或 GitHub 私有仓库同步，无任何第三方服务。
      </p>
    </Card>
  );
}
