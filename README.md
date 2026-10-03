# TodoLite

轻量、好看、跨平台的待办清单 —— 覆盖 **macOS / Windows / Android** 三端。

- **真应用**：基于 Tauri 2，安装包仅几 MB，启动快、内存占用低
- **本地优先**：数据存在你自己的设备上，无账号、无追踪
- **双通道同步**：WebDAV 网盘或 GitHub 私有仓库（HTTPS + Token，无需 SSH），任务级自动合并
- **智能输入**：`明天 交报告 #工作 !高` 一行搞定日期 / 列表 / 优先级
- **小组件就绪**：macOS WidgetKit 与 Android AppWidget 的数据通道与接口已预留（见下）

## 功能（v1 · 标准个人版）

- 任务增删改查、完成划线动效、备注
- 列表 / 项目分组（emoji + 主题色）、智能视图（今天 / 计划 / 全部）
- 截止日期与今日 / 逾期标记，未来 7 天「计划」视图
- 搜索（`⌘K`）、拖拽排序、回收站（软删除，保留 30 天）
- 深浅色主题（跟随系统）+ 8 种强调色
- WebDAV 同步：手动 / 启动时 / 变更后防抖自动同步，任务级 LWW 合并 + 墓碑删除传播
- JSON 导入导出（设置页）

## 技术栈

| 层 | 选型 |
|---|---|
| 壳 | Tauri 2（系统 WebView，Rust 命令层） |
| 前端 | React 19 + TypeScript + Vite 7 |
| 样式 | Tailwind CSS 4（设计令牌 + 手写组件，无重组件库） |
| 状态 | Zustand 5 |
| 存储 | 单 JSON 数据文件，原子写 + 5 级备份轮转 |
| 凭据 | 系统凭据管理器（Keychain / Windows 凭据管理器 / 应用私有目录） |
| 同步 | WebDAV（`@tauri-apps/plugin-http`，ETag 乐观锁） |
| 测试 | Vitest（领域层纯函数单测） |

## 本地开发（macOS / Windows）

```bash
pnpm install
pnpm tauri dev      # 开发模式，热更新
pnpm test           # 领域层单测
pnpm tauri build    # 产出 .app/.dmg 或 .exe/.msi
```

要求：Node 20+、pnpm、Rust stable；Windows 端需 WebView2（Win11 自带）。

## Android

工程已入库（`src-tauri/gen/android`）。本地构建需要 JDK 17 + Android SDK/NDK：

```bash
rustup target add aarch64-linux-android
pnpm tauri android init   # 已初始化则跳过
pnpm tauri android build --apk --debug --target aarch64
# 产物：src-tauri/gen/android/app/build/outputs/apk/**/app-*.apk
```

没有 Android 环境也可以直接用 GitHub Actions：推送 `v*` tag（或手动
workflow_dispatch）即可在 Release 页下载三端安装包。

## 同步配置

设置 → 同步，二选一即可，两通道语义一致：任务/列表按 `id` 并集、`updatedAt` 新者胜（LWW）；
删除以墓碑传播；设置项以本地为准。密码/Token 只存本机系统凭据管理器，永不上传。

### WebDAV（坚果云示例）

1. 服务器地址：`https://dav.jianguoyun.com/dav/`，账号 + 「应用密码」（官网安全选项里生成）
2. 「测试连接」→「保存配置」→「立即同步」；其他设备填同一配置

### GitHub 仓库

1. 在 GitHub 建一个**私有仓库**（如 `your-name/todolite-sync`）
2. 创建 fine-grained Token：github.com/settings/personal-access-tokens/new →
   只勾选该仓库 + **Contents: Read and write**
3. 应用内填 `owner/repo`、分支（`main`）、Token，测试连接 → 立即同步

认证走 HTTPS + Token，**三端（含 Android）配置方式完全相同，无需配置 SSH 密钥**；
Token 只存系统凭据管理器。每次同步在仓库中就是一个真实 commit，数据文件
（默认 `todolite-data.json`）历史完整可回溯；单文件上限 1MB（Contents API 限制，
约数千条带备注的任务，正常个人使用远达不到）。

## 小组件（路线图）

数据通道已预留：应用每次变更都会把「今日/逾期任务摘要 + 计数」快照写到
平台共享位置（macOS App Group 容器 / Android files 目录）。后续实现
macOS WidgetKit 与 Android AppWidget 时**无需改动核心代码**，
施工清单见 [docs/widget-adaptation.md](docs/widget-adaptation.md)。

## 目录结构

```
src/                  前端（三端共享 100% 逻辑）
├── core/             领域层：模型/操作/合并算法/智能输入解析（纯函数，全量单测）
├── sync/             WebDAV 客户端 + 同步引擎（ETag 乐观锁，单飞行）
├── bridge/           ★ 小组件快照接口
├── stores/           Zustand（数据仓库 / UI 状态 / 同步状态）
├── components/       UI 组件
└── lib/              主题/凭据/平台探测
src-tauri/            Tauri 壳
├── src/commands.rs   数据文件原子读写+备份、凭据、平台信息
├── src/widget/       ★ 分平台快照落点（cfg）
└── gen/android/      Android Studio 工程（已入库）
.github/workflows/    三端构建 CI
```

## Roadmap

- [ ] macOS 小组件（WidgetKit）—— 接口已预留
- [ ] Android 小组件（AppWidget / Glance）—— 接口已预留
- [ ] 任务提醒系统通知
- [ ] 子任务 / 重复任务 / 标签
- [ ] macOS / Windows 正式签名与公证

## License

见 [LICENSE](LICENSE)。
