# 小组件适配指南

数据通道（应用 → 快照文件）在 v1 打通；**macOS WidgetKit 小组件已在 v1.1 实现**，
**Android（AppWidget）已在 v1.2 实现**（见第 5 节）。

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
| Android | 应用私有目录 `widget/widget-snapshot.json`。**实际落点是 `dataDir/widget/`**（Tauri `app_data_dir()` 在 Android 解析为 `activity.dataDir`，即 `/data/user/0/<pkg>/widget/`），AppWidget Provider 读取时对 `dataDir/widget/`、`filesDir/widget/`、外部存储三处按序探测 | AppWidget 与主应用同进程（渲染在宿主进程），Provider 可直接读私有目录 |
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

### 4.5 已知限制与最终结论（2026-10 实测）

**结论：画廊枚举需要完整系统身份（开发者签名 + App Group profile + 公证链），
免费账号无法达成，小组件定位为「本地构建可选功能」。**

已实测四种形态全部被 WidgetKit 在枚举阶段过滤（画廊不可见，且无任何加载日志）：

| 形态 | 结果 |
|---|---|
| ad-hoc + 空 entitlements | ❌ 不枚举 |
| ad-hoc + 沙盒 + groups（无 profile） | ❌ 不枚举 |
| Apple Development 签名 + 沙盒 + groups（无 profile） | ❌ 不枚举 |
| Apple Development 签名 + 无沙盒 + 空 entitlements | ❌ 不枚举 |

附带实测结论：

- **App Group 容器创建需要 profile**：即使主应用带 groups entitlement 且为
  真实团队签名，无 profile 时 `~/Library/Group Containers/<group>` 创建仍被
  系统拒绝（EPERM），快照回退到 `~/Library/Application Support/com.syn.todolite/widget/`；
- profile 免费账号仅能经 Xcode 工程（自动签名）生成，本仓库无 Xcode 工程；
- 分发包（CI dmg / brew）不含小组件扩展（嵌入脚本不在 CI 流程中）；
- 恢复路径 = Developer Program（Developer ID + 公证 + App Group profile）后，
  在 `TodoLiteWidget.entitlements` 恢复标准形态（沙盒 + groups，文件内有注释），
  Swift 读取代码按 容器 → 标准路径 → 回退 排序，无需改代码；
- 刷新为 timeline 兜底（≤15 分钟），添加/移除小组件或等待兜底即可看到最新数据。

## 5. Android AppWidget 小组件（✅ v1.2 已实现）

实现走**标准 AppWidget + RemoteViews**（未用 Glance）：内容为「今日待办 + 高优先级任务」，
与 macOS 小组件同一快照通道。无任何签名/厂商认证要求，自签名 APK 即可用。

### 5.1 文件清单（均在 `src-tauri/gen/android/app/src/main/`）

| 文件 | 作用 |
|---|---|
| `java/com/syn/todolite/TodoliteWidgetProvider.kt` | AppWidgetProvider：读快照 → RemoteViews 渲染；逾期（红点）→ 今日（灰点）→ 高优（橙点）去重后至多 4 行；标题「今天 · N」+ 红色「逾期 K」后缀 + 橙色「❗ M」徽标；空态文案；点击任意位置打开主应用 |
| `res/xml/todolite_widget_info.xml` | provider 信息：4x2（`targetCellWidth/Height`），`updatePeriodMillis=1800000` 半小时兜底，`previewLayout` 用真布局做预览 |
| `res/layout/todolite_widget.xml` | 布局：根布局 `@android:id/background` + 圆角背景（系统按该 ID 统一裁切圆角） |
| `res/drawable/todolite_widget_bg.xml` | 16dp 圆角背景（兼容旧版本/圆角识别失败场景） |
| `res/values|values-night/todolite_widget_colors.xml` | 配色取自 `src/styles.css` 设计令牌（panel/ink/ink2/ink3/danger/warn）；**深色用静态 `-night` 资源**（小米等 ROM 不支持 RemoteViews 代码动态换色） |
| `res/values/strings.xml` | 小组件文案（描述/标题前缀/逾期后缀/徽标/空态/无快照引导） |
| `AndroidManifest.xml` | receiver（`APPWIDGET_UPDATE`，`exported=true`）+ `android.appwidget.provider` meta-data |

### 5.2 行为与限制

- **刷新时机**：主应用写快照后不发广播（Kotlin 桥接暂缺，见施工清单遗留项），依赖
  系统 30 分钟轮询 + 桌面重建（添加组件、重启桌面等）重读。快照永远是最新写入，
  组件展示最多滞后半小时。后续可让 Rust 写完快照后触发一次
  `AppWidgetManager.actionAppWidgetUpdate` 广播实现即时刷新（预留）。
- **渲染约束**：RemoteViews 不支持动态增删 View，任务行是布局里固定的 4 个
  TextView（无任务时隐藏）；行内容用 SpannableString 给「●」圆点上色。
- **点击**：整卡 `PendingIntent.getActivity` 直达 MainActivity（Android 12+ 禁 trampoline）。
- **快照缺失/损坏**：显示「打开 TodoLite 同步小组件数据」引导，不崩。
- **验证**：`ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew :app:compileDebugKotlin`
  （在 `src-tauri/gen/android/` 下执行，Kotlin 编译不触发 Rust 交叉编译）。

### 5.3 后续可选增强（原施工清单遗留项）

1. Kotlin 插件桥：Rust 写完快照后发 `AppWidgetManager` 广播实现秒级刷新；
2. `ListView` + `RemoteViewsFactory` 展示更多条目；
3. 按任务条目区分点击目标（打开应用并定位到对应任务）；
4. 如迁移 Glance：`GlanceAppWidget.provideGlance` 读同一快照文件即可。

## 6. 接口契约（不要破坏）

- Rust 命令签名：`write_widget_snapshot(snapshot: WidgetSnapshot) -> bool`
  （`false` = 当前平台无落点，前端必须容忍）；
- 快照字段只增不改：新增字段一律可选并给默认值，旧小组件读新快照不能崩；
- 前端唯一入口：`widgetBridge.pushSnapshot(db)`（`src/bridge/widget.ts`），
  不要在其他地方直接 invoke 该命令。
