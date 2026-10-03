// TodoLite macOS 小组件（WidgetKit）
//
// 内容：今日待办 + 高优先级待办（对应 README 路线图第一项）。
// 数据来源：主应用每次变更后写入 App Group 容器的 widget-snapshot.json
// （schema 见 src/bridge/widget.ts，落点见 src-tauri/src/widget/platform.rs）。
//
// 本工程没有 Xcode 工程，构建方式为 swiftc 手工编译 + .appex 组装：
//   scripts/build-macos-widget.sh [path/to/TodoLite.app]
// 详见 docs/widget-adaptation.md 第 4 节。

import WidgetKit
import SwiftUI

// MARK: - 快照模型（与 Rust/TS 侧 WidgetSnapshot 字段一一对应，camelCase）

struct SnapshotTask {
    var id = ""
    var title = ""
    var listName = ""
    var dueDate: String?
    /** 0 无 / 1 低 / 2 中 / 3 高 */
    var priority = 0

    private enum CodingKeys: String, CodingKey {
        case id, title, listName, dueDate, priority
    }
}

extension SnapshotTask: Decodable {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        listName = try c.decodeIfPresent(String.self, forKey: .listName) ?? ""
        dueDate = try c.decodeIfPresent(String.self, forKey: .dueDate)
        priority = try c.decodeIfPresent(Int.self, forKey: .priority) ?? 0
    }
}

struct SnapshotCounts {
    var today = 0
    var upcoming = 0
    var all = 0
    var completedToday = 0
    var highPriority = 0

    private enum CodingKeys: String, CodingKey {
        case today, upcoming, all, completedToday, highPriority
    }
}

extension SnapshotCounts: Decodable {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        today = try c.decodeIfPresent(Int.self, forKey: .today) ?? 0
        upcoming = try c.decodeIfPresent(Int.self, forKey: .upcoming) ?? 0
        all = try c.decodeIfPresent(Int.self, forKey: .all) ?? 0
        completedToday = try c.decodeIfPresent(Int.self, forKey: .completedToday) ?? 0
        highPriority = try c.decodeIfPresent(Int.self, forKey: .highPriority) ?? 0
    }
}

struct WidgetSnapshot {
    var generatedAt = ""
    var today: [SnapshotTask] = []
    var overdue: [SnapshotTask] = []
    var highPriority: [SnapshotTask] = []
    var counts = SnapshotCounts()

    private enum CodingKeys: String, CodingKey {
        case generatedAt, today, overdue, highPriority, counts
    }
}

extension WidgetSnapshot: Decodable {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try c.decodeIfPresent(String.self, forKey: .generatedAt) ?? ""
        today = try c.decodeIfPresent([SnapshotTask].self, forKey: .today) ?? []
        overdue = try c.decodeIfPresent([SnapshotTask].self, forKey: .overdue) ?? []
        highPriority = try c.decodeIfPresent([SnapshotTask].self, forKey: .highPriority) ?? []
        counts = try c.decodeIfPresent(SnapshotCounts.self, forKey: .counts) ?? SnapshotCounts()
    }
}

// MARK: - 快照读取

enum SnapshotStore {
    static let appGroupID = "group.com.syn.todolite"
    static let fileName = "widget-snapshot.json"

    /// 依次尝试：App Group 容器 API → 标准 Group Containers 路径 →
    /// 主应用数据目录（主应用创建 App Group 目录失败时的开发期回退）。
    static func fileURL() -> URL? {
        let fm = FileManager.default
        if let base = fm.containerURL(forSecurityApplicationGroupIdentifier: appGroupID) {
            let url = base.appendingPathComponent(fileName)
            if fm.fileExists(atPath: url.path) { return url }
        }
        guard let home = ProcessInfo.processInfo.environment["HOME"] else { return nil }
        let group = URL(fileURLWithPath: home)
            .appendingPathComponent("Library/Group Containers")
            .appendingPathComponent(appGroupID, isDirectory: true)
            .appendingPathComponent(fileName, isDirectory: false)
        if fm.fileExists(atPath: group.path) { return group }
        let appData = URL(fileURLWithPath: home)
            .appendingPathComponent("Library/Application Support/com.syn.todolite/widget")
            .appendingPathComponent(fileName, isDirectory: false)
        if fm.fileExists(atPath: appData.path) { return appData }
        return nil
    }

    static func load() -> WidgetSnapshot {
        guard let url = fileURL(), let data = try? Data(contentsOf: url) else {
            return WidgetSnapshot()
        }
        return (try? JSONDecoder().decode(WidgetSnapshot.self, from: data)) ?? WidgetSnapshot()
    }
}

// MARK: - Timeline

struct TodoEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> TodoEntry {
        TodoEntry(date: .now, snapshot: Self.sample)
    }

    func getSnapshot(in context: Context, completion: @escaping @Sendable (TodoEntry) -> Void) {
        completion(TodoEntry(date: .now, snapshot: SnapshotStore.load()))
    }

    func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<TodoEntry>) -> Void) {
        // 主应用写快照后无法直接调用 WidgetCenter.reloadTimelines()（Rust 侧），
        // 以 15 分钟兜底刷新；WidgetKit 会按系统预算自动合并。
        let entry = TodoEntry(date: .now, snapshot: SnapshotStore.load())
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: .now)
            ?? .now.addingTimeInterval(900)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    /// 占位/预览用示例数据
    private static var sample: WidgetSnapshot {
        var s = WidgetSnapshot()
        s.today = [
            SnapshotTask(id: "s1", title: "交周报", listName: "工作", dueDate: "2026-01-14", priority: 2),
            SnapshotTask(id: "s2", title: "回复邮件", listName: "工作", dueDate: "2026-01-14", priority: 0),
        ]
        s.highPriority = [
            SnapshotTask(id: "s3", title: "修复线上故障", listName: "工作", dueDate: nil, priority: 3),
        ]
        s.counts = SnapshotCounts(today: 2, upcoming: 5, all: 42, completedToday: 7, highPriority: 1)
        return s
    }
}

// MARK: - 视图

/// "yyyy-MM-dd" 字符串可直接按字典序比较日期
private func todayString(_ date: Date) -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.locale = Locale(identifier: "en_US_POSIX")
    return f.string(from: date)
}

private struct SectionHeader: View {
    let title: String
    let count: Int
    let color: Color

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(title).font(.system(size: 11, weight: .semibold))
            Text("·").font(.system(size: 11)).foregroundStyle(.secondary)
            Text("\(count)").font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .foregroundStyle(.primary)
    }
}

private struct TaskRow: View {
    let task: SnapshotTask
    let today: String

    private var isOverdue: Bool {
        guard let due = task.dueDate else { return false }
        return due < today
    }

    var body: some View {
        HStack(spacing: 4) {
            if task.priority >= 3 {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.system(size: 8))
                    .foregroundStyle(.orange)
            }
            Text(task.title)
                .font(.system(size: 11))
                .lineLimit(1)
                .foregroundStyle(isOverdue ? AnyShapeStyle(.red) : AnyShapeStyle(.primary))
            if isOverdue {
                Text("逾期")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(.red)
            }
            Spacer(minLength: 0)
        }
    }
}

/// 列表段：标题 + 至多 5 条，超出显示剩余数
private struct TaskSection: View {
    let title: String
    let color: Color
    let tasks: [SnapshotTask]
    let total: Int
    let today: String
    let emptyText: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionHeader(title: title, count: total, color: color)
            if tasks.isEmpty {
                Text(emptyText)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(tasks.prefix(5).enumerated()), id: \.element.id) { _, task in
                    TaskRow(task: task, today: today)
                }
                if total > 5 {
                    Text("还有 \(total - 5) 条…")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SmallView: View {
    let snap: WidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 3) {
                Image(systemName: "checklist")
                    .font(.system(size: 10, weight: .semibold))
                Text("TodoLite")
                    .font(.system(size: 10, weight: .semibold))
                Spacer(minLength: 0)
            }
            .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(snap.counts.today)")
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                Text("今日")
                    .font(.system(size: 12, weight: .medium))
            }
            HStack(spacing: 3) {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.system(size: 9))
                Text("\(snap.counts.highPriority) 高优")
                    .font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(.orange)
            Spacer(minLength: 0)
            Text("已完成 \(snap.counts.completedToday)")
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
        }
    }
}

private struct MediumView: View {
    let snap: WidgetSnapshot
    let today: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            TaskSection(
                title: "今日", color: .accentColor,
                tasks: snap.today, total: snap.counts.today,
                today: today, emptyText: "今天没有待办 🎉")
            Divider()
            TaskSection(
                title: "高优先", color: .orange,
                tasks: snap.highPriority, total: snap.counts.highPriority,
                today: today, emptyText: "暂无高优先级任务")
        }
    }
}

private struct LargeView: View {
    let snap: WidgetSnapshot
    let today: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TaskSection(
                title: "今日", color: .accentColor,
                tasks: snap.today, total: snap.counts.today,
                today: today, emptyText: "今天没有待办 🎉")
            Divider()
            TaskSection(
                title: "高优先", color: .orange,
                tasks: snap.highPriority, total: snap.counts.highPriority,
                today: today, emptyText: "暂无高优先级任务")
            Spacer(minLength: 0)
        }
    }
}

struct TodoLiteWidgetEntryView: View {
    var entry: Provider.Entry

    var body: some View {
        let today = todayString(entry.date)
        WidgetFamilyView(snapshot: entry.snapshot, today: today)
            .containerBackground(for: .widget) {
                Color(nsColor: .windowBackgroundColor)
            }
            .padding(2)
    }
}

// 占位避免编译器对未使用类型的警告
private struct WidgetFamilyView: View {
    @Environment(\.widgetFamily) private var family
    let snapshot: WidgetSnapshot
    let today: String

    var body: some View {
        switch family {
        case .systemSmall:
            SmallView(snap: snapshot)
        case .systemMedium:
            MediumView(snap: snapshot, today: today)
        default:
            LargeView(snap: snapshot, today: today)
        }
    }
}

// MARK: - Widget 声明

struct TodoLiteWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TodoLiteWidget", provider: Provider()) { entry in
            TodoLiteWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("今日待办")
        .description("展示今日待办与高优先级任务，数据来自 TodoLite 主应用。")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

@main
struct TodoLiteWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodoLiteWidget()
    }
}
