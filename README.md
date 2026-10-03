# TodoLite

轻量、好看、跨平台的待办清单 —— 覆盖 **macOS / Windows / Android** 三端。

- **真应用**：基于 Tauri 2，安装包仅几 MB，启动快、内存占用低
- **本地优先**：数据存在你自己的设备上，无账号、无追踪
- **双通道同步**：WebDAV 网盘或 GitHub 私有仓库（HTTPS + Token，无需 SSH），任务级自动合并
- **智能输入**：`明天 交报告 #工作 !高` 一行搞定日期 / 列表 / 优先级
- **macOS 小组件**：WidgetKit 小组件展示「今日待办 + 高优先级任务」，数据经快照文件同步

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

## 安装（Homebrew · macOS）

```bash
brew install --cask --no-quarantine oroiteS/tap/todolite
```

该命令自动 tap [oroiteS/homebrew-tap](https://github.com/oroiteS/homebrew-tap)
并安装 Release 中的 dmg（Apple Silicon / Intel 自动选择对应架构）。

> [!NOTE]
> 应用尚未做 Apple 签名与公证（见 Roadmap），`--no-quarantine` 用于跳过
> Gatekeeper 隔离标记；若不带该参数安装、首次打开提示「已损坏」，运行
> `xattr -dr com.apple.quarantine /Applications/TodoLite.app` 即可。

cask 由 tap 仓库的定时 workflow 跟随最新 Release 自动更新 `version` 与 `sha256`，
之后跟随新版本发布即可：

```bash
brew update && brew upgrade
```

## 本地开发（macOS / Windows）

```bash
pnpm install
pnpm tauri dev      # 开发模式，热更新
pnpm test           # 领域层单测
pnpm tauri build    # 产出 .app/.dmg 或 .exe/.msi
```

要求：Node 20+、pnpm、Rust stable；Windows 端需 WebView2（Win11 自带）。

### macOS 小组件

```bash
pnpm tauri build               # 先构建主应用
scripts/build-macos-widget.sh  # swiftc 编译 WidgetKit 扩展并嵌入 .app
```

打开应用后在 通知中心 → 编辑小组件 添加「今日待办」。原理与限制见
[docs/widget-adaptation.md](docs/widget-adaptation.md)。

## Android

工程已入库（`src-tauri/gen/android`）。本地构建需要 JDK 17 + Android SDK/NDK：

```bash
rustup target add aarch64-linux-android
pnpm tauri android init   # 已初始化则跳过
pnpm tauri android build --apk --debug --target aarch64
# 产物：src-tauri/gen/android/app/build/outputs/apk/**/app-*.apk

# 发布构建（固定密钥签名，可直接覆盖安装旧版）：
pnpm tauri android build --apk --target aarch64
```

没有 Android 环境也可以直接用 GitHub Actions：推送 `v*` tag（或手动
workflow_dispatch）即可在 Release 页下载三端安装包。

## 更新与签名（兼容式升级）

所有正式版本均可**直接覆盖安装**——不卸载旧版、数据保留。机制、签名密钥生成
（一次性）、GitHub Secrets 配置与发版红线见
[docs/compatible-updates.md](docs/compatible-updates.md)。

Android 端首次需配置发布密钥（之后所有版本自动复用）：

```bash
./scripts/gen-android-keystore.sh   # 生成密钥，按输出提示配置 GitHub Secrets 即可
```

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

## 小组件

macOS 已实现（WidgetKit，内容为**今日待办 + 高优先级任务**）：应用每次变更都会把
「今日/逾期/高优任务摘要 + 计数」快照写到平台共享位置，小组件扩展读取渲染；
构建方式与签名限制见 [docs/widget-adaptation.md](docs/widget-adaptation.md)。

Android 已实现（**标准 AppWidget + RemoteViews**，同一快照数据通道）：
4x2 组件展示「今天 · N」标题（含红色逾期计数）+ 至多 4 条任务
（逾期红点 / 今日灰点 / 高优橙点，按 id 去重）+ 高优「❗ M」徽标；
深浅色跟随系统（静态 `-night` 资源），点击整卡打开应用。数据变更后
**实时刷新**（写快照后 JNI 直调 `AppWidgetManager.updateAppWidget`），
30 分钟系统轮询兜底。无任何签名/厂商认证要求。实现细节见
[docs/widget-adaptation.md](docs/widget-adaptation.md) 第 5 节。

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
├── widgets/macos/    ★ macOS WidgetKit 小组件（SwiftUI，swiftc 构建）
└── gen/android/      Android Studio 工程（已入库）
scripts/              构建辅助（macOS 小组件嵌入、Android 密钥等）
.github/workflows/    三端构建 CI
```

## 应用图标

图标源文件为根目录的 [app-icon.png](app-icon.png)（1254×1254），由 **gpt-image-2** 生成；
通过 `pnpm tauri icon ./app-icon.png` 一键产出 macOS / Windows / Android / iOS 全套图标，
Web 端 favicon 在 `public/`。生成提示词原文：

> 设计一枚现代极简风格的 iOS App 图标，用于一款待办清单（Todo List）效率软件。
> 图标主体：干净的纯白色背景（可带极浅的暖白 #FAFAFA），画面正中是一个粗壮饱满的
> 黑色对勾（✓），对勾从深黑色到炭灰色有极其细微的单色渐变，笔画末端为圆头，宽度均匀，
> 略微向右上方扬起，传达「完成、干脆、可靠」的气质。对勾后方衬托一个极浅的灰色
> （约 8% 黑）同心圆环作为唯一的装饰层次，让画面有呼吸感和聚焦感，但绝不抢主体。
> 构图居中，对勾约占画布 55%，四周留白充足。扁平化矢量设计，边缘锐利干净，无描边，
> 最多带一层极克制的柔和投影（大模糊半径、不透明度低于 6%）。整体气质参考 Things、
> TickTick 等顶级效率应用图标：安静、高级、克制、耐看。正方形 1:1 构图，图标铺满画布。
> 严格避免：红色及任何彩色、彩虹渐变、卡通质感、3D 渲染、厚阴影、描边、文字、
> 多余装饰元素、复杂纹理、高饱和颜色、杂乱背景。

## Roadmap

- [x] macOS 小组件（WidgetKit）—— 今日待办 + 高优先级任务
- [x] Android 小组件（AppWidget + RemoteViews）—— 同一快照通道，今日 + 高优先级
- [x] Android 小组件即时刷新（写快照后 JNI 直调 AppWidgetManager.updateAppWidget）
- [ ] 小组件即时刷新（WidgetCenter.reloadTimelines 桥接）
- [ ] 任务提醒系统通知
- [ ] 子任务 / 重复任务 / 标签
- [ ] macOS / Windows 正式签名与公证（CI 已预留，配置 Apple secrets 即自动生效）

## License

见 [LICENSE](LICENSE)。
