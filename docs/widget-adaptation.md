# 小组件适配指南

数据通道（应用 → 快照文件）在 v1 打通；**macOS WidgetKit 小组件已在 v1.1 实现**，
Android（AppWidget）按第 5 节清单待实现。

## 1. 数据流总览

```mermaid
flowchart LR
  A[UI 操作] --> B[Zustand 数据仓库]
  B -->|防抖 600ms| C[WidgetBridge.pushSnapshot]
  C --> D[Tauri 命令<br/>write_widget_snapshot]
  D -->|#[cfg] 分平台| E[快照文件 widget-snapshot.json]
  E --> F[macOS: App Group 容器<br/>或 App Data/widget/]
  E --> G[Android: App Data/widget/]
  F --> H[WidgetKit Extension 读取渲染]
  G --> I[AppWidget Provider 读取渲染]
```

关键点：**小组件进程与主应用不共享内存**，一切通过「快照文件」传递。
核心代码不依赖任何小组件实现——快照写不出来时静默失败（返回 false）。

## 2. 快照 Schema（`WidgetSnapshot`）

前后端类型一一对应（TS 见 `src/bridge/widget.ts`，Rust 见 `src-tauri/src/widget/mod.rs`）：

```jsonc
{
  "generatedAt": "2026-01-14T04:00:00.000Z",
  "today": [                       // 今天到期，最多 10 条
    { "id": "...", "title": "交周报", "listName": "工作", "dueDate": "2026-01-14", "priority": 2 }
  ],
  "overdue": [],                   // 已逾期，最多 10 条
  "highPriority": [                // 高优先级（priority=3）未完成，与到期日无关，最多 10 条；v1.1 新增
    { "id": "...", "title": "救火", "listName": "工作", "dueDate": null, "priority": 3 }
  ],
  "counts": {
    "today": 3,          // 今天到期总数（不受 10 条截断影响）
    "upcoming": 5,       // 未来 7 天
    "all": 42,           // 全部未完成
    "completedToday": 7, // 今日已完成
    "highPriority": 1    // 高优先级总数；v1.1 新增
  }
}
```

推送时机（已实现）：任务/列表任何变更后防抖 600ms 自动推送；应用启动时推送一次。

## 3. 平台落点（已实现，`src-tauri/src/widget/platform.rs`）

| 平台 | 路径 | 说明 |
|---|---|---|
| macOS | `~/Library/Group Containers/group.com.syn.todolite/widget-snapshot.json` | 目录不存在时主应用会直接创建（主应用非沙盒）；创建失败才回退 App Data `widget/` |
| Android | 应用私有目录 `widget/widget-snapshot.json`（`files/widget/`） | AppWidget 与主应用同进程不同渲染管线，可直接读 |
| Windows/Linux | 无（命令返回 false） | Windows 11 小组件无第三方 API，接口保留 |

## 4. macOS WidgetKit 小组件（✅ 已实现）

源码在 `src-tauri/widgets/macos/`，构建脚本 `scripts/build-macos-widget.sh`。

### 4.1 结构

| 文件 | 作用 |
|---|---|
| `TodoLiteWidget.swift` | WidgetBundle + TimelineProvider + 小/中/大三种尺寸渲染 |
| `Info.plist` | `.appex` 配置（Bundle ID `com.syn.todolite.widget`，widgetkit-extension 扩展点） |
| `TodoLiteWidget.entitlements` | App Sandbox + App Groups（`group.com.syn.todolite`） |

### 4.2 渲染内容（用户视角）

- **小**：今日待办大数字 + 高优计数 + 今日已完成
- **中**：左「今日」（至多 5 条）/ 右「高优先」（至多 5 条）双栏
- **大**：上下两段完整列表；逾期任务红字 + 「逾期」角标，高优任务橙色 ❗ 角标

### 4.3 构建与安装

```bash
pnpm tauri build                    # 先构建主应用
scripts/build-macos-widget.sh       # swiftc 编译 universal .appex → 签名 → 嵌入 PlugIns
open src-tauri/target/release/bundle/macos/TodoLite.app
# 通知中心 → 编辑小组件 → 搜索 TodoLite → 添加「今日待办」
```

脚本要点：本仓库无 Xcode 工程（Tauri 桌面端走 cargo），故用 `swiftc`
手工编译 arm64+x86_64 并 `lipo` 合成 universal；extension 以 ad-hoc 身份
签名；嵌入后重签外层 .app 时**注入 App Groups entitlements**
（`TodoLiteApp.entitlements`，仅组名、无沙盒），并刻意不用 `--deep`
以免覆盖 extension 已带 entitlements 的签名。

### 4.4 数据流与刷新

- 读取顺序：`containerURL(App Group)` → 标准 Group Containers 路径 →
  App Data `widget/`（与 Rust 侧落点一一对应，任一可读即用）；
- 解码容错：所有字段 `decodeIfPresent` + 默认值，旧快照/缺字段不崩（契约见第 6 节）；
- 刷新：timeline 每 15 分钟兜底重读快照（WidgetKit 按预算自动合并）。
  主应用是 Rust 进程，暂无法直接调 `WidgetCenter.reloadTimelines()`；
  如需秒级刷新，后续可加一个 Swift 助手或为 Tauri 桥接 ObjC，见 Roadmap。

### 4.5 已知限制（当前 ad-hoc 路线）

- **App Group 容器需要真实签名**：macOS 只为有 Team 签名的进程创建
  `~/Library/Group Containers/<group>` 容器（Xcode 中开启 App Groups 同样要求
  选 Team）。ad-hoc 本地运行时主应用创建会被系统拒绝（EPERM），快照自动回退到
  `~/Library/Application Support/com.syn.todolite/widget/`。
- **因此扩展暂不开启 App Sandbox**：无沙盒的扩展才能在回退路径下读到快照，
  保证"无签名也能用"。正式上架/公证前需做两件事：
  1. 用开发者身份签名（App Group 注册到对应 Team），届时主应用能正常创建容器；
  2. 在 `TodoLiteWidget.entitlements` 恢复 `com.apple.security.app-sandbox = true`
     （扩展届时只从 Group 容器读取，该行文件内有注释标记）。
- 刷新为 timeline 兜底（≤15 分钟），添加/移除小组件或等待兜底即可看到最新数据。

## 5. Android AppWidget 施工清单（后续任务）

1. `src-tauri/gen/android/app/src/main/` 下新增
   `res/xml/todolite_widget_info.xml`（`updatePeriodMillis=1800000` 半小时兜底）；
2. 新增 `AppWidgetProvider`（Kotlin）：`onUpdate` 中读取
   `filesDir/widget/widget-snapshot.json`，用 RemoteViews 渲染：
   - 布局建议：`LinearLayout` 竖排，标题行「今天 · N」，下面至多 3 条任务标题；
   - 点击任意条目打开主 Activity（`PendingIntent`）；
3. `AndroidManifest.xml` 注册 receiver 与 meta-data；
4. 若使用 Jetpack Glance 替代 RemoteViews：`GlanceAppWidget` 的
   `provideGlance` 中读同一快照文件即可；
5. 主 app 数据变更后如需立即刷新：Tauri 侧写快照后发一个
   `AppWidgetManager` 广播（Kotlin 插件桥接，预留）；
   依赖系统半小时轮询也可接受（快照永远是最新的）。

## 6. 接口契约（不要破坏）

- Rust 命令签名：`write_widget_snapshot(snapshot: WidgetSnapshot) -> bool`
  （`false` = 当前平台无落点，前端必须容忍）；
- 快照字段只增不改：新增字段一律可选并给默认值，旧小组件读新快照不能崩；
- 前端唯一入口：`widgetBridge.pushSnapshot(db)`（`src/bridge/widget.ts`），
  不要在其他地方直接 invoke 该命令。
