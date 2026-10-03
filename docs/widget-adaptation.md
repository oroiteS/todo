# 小组件适配指南（预留接口说明）

v1 已经打通「数据 → 小组件」的完整数据通道，并留好扩展点。本文件是后续实现
macOS（WidgetKit）与 Android（AppWidget）小组件时的完整施工说明。

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
    { "id": "...", "title": "交周报", "listName": "工作", "dueDate": "2026-01-14" }
  ],
  "overdue": [],                   // 已逾期，最多 10 条
  "counts": {
    "today": 3,          // 今天到期总数（不受 10 条截断影响）
    "upcoming": 5,       // 未来 7 天
    "all": 42,           // 全部未完成
    "completedToday": 7  // 今日已完成
  }
}
```

推送时机（已实现）：任务/列表任何变更后防抖 600ms 自动推送；应用启动时推送一次。

## 3. 平台落点（已实现，`src-tauri/src/widget/platform.rs`）

| 平台 | 路径 | 说明 |
|---|---|---|
| macOS | `~/Library/Group Containers/group.com.syn.todolite/widget-snapshot.json` | 目录存在才使用；否则回退 App Data `widget/` |
| Android | 应用私有目录 `widget/widget-snapshot.json`（`files/widget/`） | AppWidget 与主应用同进程不同渲染管线，可直接读 |
| Windows/Linux | 无（命令返回 false） | Windows 11 小组件无第三方 API，接口保留 |

## 4. macOS WidgetKit 施工清单（后续任务）

1. Xcode 中为主 app 添加 **Widget Extension** target（SwiftUI，WidgetKit）；
2. 主 app 与 extension 同时开启 **App Groups**，组名 `group.com.syn.todolite`
   （`src-tauri/gen/apple` 下的 entitlements 文件加
   `com.apple.security.application-groups` 条目；正式分发需对应签名的 App Group）；
3. Extension 的 `TimelineProvider` 读取快照文件（App Group 容器路径），
   渲染小/中/大三种尺寸：
   - 小：`counts.today` 大数字 + 「今日待办」
   - 中：today 前 3 条标题列表
   - 大：today + overdue 合并列表
4. `.containerBackground(for: .widget)` 使用快照里没有的信息（如强调色）时，
   直接读主 app 的 `UserDefaults(suiteName: "group.com.syn.todolite")`——
   可在 `write_widget_snapshot` 中顺带写入 accent 颜色（预留）；
5. 刷新策略：`.timelinePolicy(.after(nextUpdate))` 每小时兜底刷新一次即可，
   数据变化由主 app 写文件 + `WidgetCenter.shared.reloadTimelines()` 触发
   （需要在 Swift 侧桥接，或在快照写入后由 app 调用；后续任务实现）。

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
