//! 菜单栏（系统托盘）图标 —— 应用右上角常驻入口。
//!
//! - 点击图标弹出菜单：统计「今日 N · 高优 M」+ 离今天最近的 8 条待办名称
//!   （有日期按到期日升序，无日期垫底；与小组件 `nearest` 同一口径）
//!   + 打开 TodoLite + 退出；点任务行即打开主窗口
//! - 数据变更即刷新菜单（write_database 落盘后调 [refresh]），点击弹出的必是最新数据；
//!   主窗口关闭仅隐藏，应用驻留菜单栏后台；Dock 图标点击或菜单「打开」恢复窗口
//!   （见 lib.rs 的 on_window_event / RunEvent::Reopen）
//!
//! 仅桌面端编译（cfg(desktop)），移动端不受影响。

use std::sync::atomic::{AtomicBool, Ordering};
use chrono::Datelike;
use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// 托盘图标 ID（init 创建与 refresh 查找共用）
pub const TRAY_ID: &str = "todolite-tray";

/// 托盘是否成功创建。Linux 极简桌面可能缺 libayatana-appindicator / DBus：
/// 此时应用不得驻留后台（关窗即退出），由 lib.rs 的 on_window_event 检查此标记。
pub static TRAY_AVAILABLE: AtomicBool = AtomicBool::new(false);

/// 与 commands::DATA_FILE 一致（那边是私有常量，这里独立声明）
const DATA_FILE: &str = "todolite-data.json";

/// 菜单里最近待办最多展示条数
const NEAREST_MAX: usize = 8;

/// 单条标题超过该字数（码点）即截断并追加"……"
const MAX_CHARS: usize = 18;

/// 实时读取本地数据，产出菜单内容（解析见 [analyze]）。
/// 文件缺失/损坏时静默返回空，菜单照常可用。
fn menu_data(app: &AppHandle) -> (u32, u32, Vec<String>) {
    let empty = (0, 0, Vec::new());
    let Ok(dir) = crate::paths::data_dir(app) else {
        return empty;
    };
    let Ok(text) = std::fs::read_to_string(dir.join(DATA_FILE)) else {
        return empty;
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return empty;
    };
    analyze(&v, chrono::Local::now().date_naive())
}

/// 与前端 core/repeat.ts 同口径的重复规则镜像：托盘菜单读数据文件时
/// 按「当期发生日」展示（重复任务永不过期、打卡完成当期不占位）。
/// 两端逻辑必须保持一致，字段/语义变更时同步修改（两侧单测各自兜底）。
#[derive(Debug, Clone, Copy, PartialEq)]
enum RepeatRule {
    Daily,
    /// 0=周日 … 6=周六（JS getDay 口径，与前端一致）
    Weekly(u32),
    Monthly(u32),
    Workday,
}

fn parse_date(s: &str) -> Option<chrono::NaiveDate> {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

fn parse_repeat(v: &serde_json::Value) -> Option<RepeatRule> {
    let kind = v.get("kind")?.as_str()?;
    match kind {
        "daily" => Some(RepeatRule::Daily),
        "workday" => Some(RepeatRule::Workday),
        "weekly" => {
            let dow = v.get("dow")?.as_u64()?;
            (dow <= 6).then_some(RepeatRule::Weekly(dow as u32))
        }
        "monthly" => {
            let day = v.get("day")?.as_u64()?;
            (1..=31).contains(&day).then_some(RepeatRule::Monthly(day as u32))
        }
        _ => None,
    }
}

fn days_in_month(y: i32, m: u32) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
                29
            } else {
                28
            }
        }
        _ => unreachable!(),
    }
}

/// 某月第 N 日：N 超出月长钳制到月末（每月31日 → 2月28/29日）
fn clamp_month_day(y: i32, m: u32, day: u32) -> chrono::NaiveDate {
    chrono::NaiveDate::from_ymd_opt(y, m, day.min(days_in_month(y, m)))
        .expect("clamped date is always valid")
}

fn next_occurrence(rule: &RepeatRule, after: chrono::NaiveDate) -> chrono::NaiveDate {
    let step = |d: chrono::NaiveDate| d + chrono::Duration::days(1);
    match rule {
        RepeatRule::Daily => step(after),
        RepeatRule::Workday => {
            let mut d = step(after);
            while matches!(d.weekday(), chrono::Weekday::Sat | chrono::Weekday::Sun) {
                d = step(d);
            }
            d
        }
        RepeatRule::Weekly(dow) => {
            let mut d = step(after);
            while d.weekday().num_days_from_sunday() != *dow {
                d = step(d);
            }
            d
        }
        RepeatRule::Monthly(day) => {
            let (mut y, mut m) = (after.year(), after.month());
            loop {
                m += 1;
                if m > 12 {
                    m = 1;
                    y += 1;
                }
                let candidate = clamp_month_day(y, m, *day);
                if candidate > after {
                    return candidate;
                }
            }
        }
    }
}

fn previous_occurrence(rule: &RepeatRule, before: chrono::NaiveDate) -> chrono::NaiveDate {
    let step = |d: chrono::NaiveDate| d - chrono::Duration::days(1);
    match rule {
        RepeatRule::Daily => step(before),
        RepeatRule::Workday => {
            let mut d = step(before);
            while matches!(d.weekday(), chrono::Weekday::Sat | chrono::Weekday::Sun) {
                d = step(d);
            }
            d
        }
        RepeatRule::Weekly(dow) => {
            let mut d = step(before);
            while d.weekday().num_days_from_sunday() != *dow {
                d = step(d);
            }
            d
        }
        RepeatRule::Monthly(day) => {
            let (mut y, mut m) = (before.year(), before.month());
            loop {
                let candidate = clamp_month_day(y, m, *day);
                if candidate < before {
                    return candidate;
                }
                m -= 1;
                if m < 1 {
                    m = 12;
                    y -= 1;
                }
            }
        }
    }
}

/// 当期发生日：锚点仍是今天/未来 → 锚点；过期 → 今天或未来的最近发生日
fn current_occurrence(
    rule: &RepeatRule,
    today: chrono::NaiveDate,
    anchor: Option<chrono::NaiveDate>,
) -> chrono::NaiveDate {
    if let Some(a) = anchor {
        if a >= today {
            return a;
        }
    }
    match rule {
        RepeatRule::Daily => today,
        RepeatRule::Workday => {
            if matches!(today.weekday(), chrono::Weekday::Sat | chrono::Weekday::Sun) {
                next_occurrence(rule, today)
            } else {
                today
            }
        }
        RepeatRule::Weekly(dow) => {
            if today.weekday().num_days_from_sunday() == *dow {
                today
            } else {
                next_occurrence(rule, today)
            }
        }
        RepeatRule::Monthly(day) => {
            let cur = clamp_month_day(today.year(), today.month(), *day);
            if cur >= today {
                cur
            } else {
                next_occurrence(rule, today)
            }
        }
    }
}

/// 重复任务当前是否处于打卡完成（划掉）态。与前端 recurringDone 同逻辑：
/// 今天还没到下一次发生日，且最近一次打卡就是当前这一期。
fn recurring_done(
    rule: &RepeatRule,
    due: Option<&str>,
    done_log: &[String],
    today: chrono::NaiveDate,
) -> bool {
    let Some(due_date) = due.and_then(parse_date) else {
        return false;
    };
    let Some(last) = done_log.last().and_then(|s| parse_date(s)) else {
        return false;
    };
    today < due_date && last >= previous_occurrence(rule, due_date)
}

/// 重复任务的展示口径到期日（永不过去）
fn effective_due(
    rule: &RepeatRule,
    due: Option<&str>,
    today: chrono::NaiveDate,
) -> chrono::NaiveDate {
    match due.and_then(parse_date) {
        Some(a) if a >= today => a,
        _ => current_occurrence(rule, today, None),
    }
}

/// 从任务 JSON 解析打卡日志（doneLog: string[]）
fn parse_done_log(v: &serde_json::Value) -> Vec<String> {
    v.get("doneLog")
        .and_then(|l| l.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|d| d.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// 从数据 JSON 解析菜单内容（纯函数，[today] 可注入便于测试）：
/// 1. 今日到期未完成数（dueDate <= 今天，含逾期，与前端 todayTasks 语义一致；
///    重复任务按当期发生日口径，永不过期，打卡完成当期不计）
/// 2. 高优先级未完成数（priority == 3）
/// 3. 离今天最近的任务菜单文案（≤[NEAREST_MAX] 条）：有日期按到期日升序（逾期→今天→未来，
///    同日保持手动排序），无日期垫底——与小组件 `nearest` 同一口径；
///    角标注明到期（·昨天 / ·逾期N天 / ·明天 / ·后天 / ·周X / ·M月D日），高优追加 ❗。
fn analyze(v: &serde_json::Value, today_date: chrono::NaiveDate) -> (u32, u32, Vec<String>) {
    let today = today_date.format("%Y-%m-%d").to_string();

    struct Row {
        title: String,
        due: Option<String>,
        high: bool,
        sort_order: f64,
        created_at: String,
    }

    let mut today_n = 0u32;
    let mut hp_n = 0u32;
    let mut rows: Vec<Row> = Vec::new();
    if let Some(tasks) = v["tasks"].as_array() {
        for t in tasks {
            // 墓碑/已完成：字符串即有效时间戳，null 表示未删除/未完成
            if t["deletedAt"].is_string() || t["completedAt"].is_string() {
                continue;
            }
            let title = t["title"].as_str().unwrap_or_default();
            if title.is_empty() {
                continue;
            }
            // 重复任务：打卡完成当期 → 完全不展示（次日照常）；否则按当期发生日口径
            let repeat = parse_repeat(&t["repeat"]);
            let done_log = parse_done_log(t);
            let due = if let Some(rule) = repeat {
                if recurring_done(&rule, t["dueDate"].as_str(), &done_log, today_date) {
                    continue;
                }
                Some(
                    effective_due(&rule, t["dueDate"].as_str(), today_date)
                        .format("%Y-%m-%d")
                        .to_string(),
                )
            } else {
                t["dueDate"]
                    .as_str()
                    .filter(|d| !d.is_empty())
                    .map(str::to_string)
            };
            if due.as_deref().is_some_and(|d| d <= today.as_str()) {
                today_n += 1; // <= 今天：含逾期（重复任务按当期口径，实际等于 == 今天）
            }
            let high = t["priority"].as_u64() == Some(3);
            if high {
                hp_n += 1;
            }
            rows.push(Row {
                title: title.to_string(),
                due,
                high,
                sort_order: t["sortOrder"].as_f64().unwrap_or(0.0),
                created_at: t["createdAt"].as_str().unwrap_or_default().to_string(),
            });
        }
    }

    // 与前端 compareTasks 一致：sortOrder 升序，平局按 createdAt；
    // 随后「稳定地」按有日期在前、日期升序重排——无日期行保持手动次序垫底。
    // ISO "yyyy-MM-dd" 字符串可直接字典序比较，逾期→今天→未来自然有序。
    rows.sort_by(|a, b| {
        a.sort_order
            .partial_cmp(&b.sort_order)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.created_at.cmp(&b.created_at))
    });
    rows.sort_by(|a, b| match (&a.due, &b.due) {
        (Some(x), Some(y)) => x.cmp(y),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });

    let texts = rows
        .iter()
        .take(NEAREST_MAX)
        .map(|r| {
            let suffix = r
                .due
                .as_deref()
                .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
                .map(|d| due_suffix(d, today_date))
                .unwrap_or_default();
            let hp_mark = if r.high { " ❗" } else { "" };
            format!("□ {}{suffix}{hp_mark}", truncate(&r.title, MAX_CHARS))
        })
        .collect();

    (today_n, hp_n, texts)
}

/// 到期角标（与前端 formatDue 口径一致）：昨天 / 逾期N天 / 明天 / 后天 / 周X / M月D日；今天不加
fn due_suffix(due: chrono::NaiveDate, today: chrono::NaiveDate) -> String {
    let d = (due - today).num_days();
    match d {
        n if n < 0 => {
            if n == -1 {
                "·昨天".to_string()
            } else {
                format!("·逾期{}天", -n)
            }
        }
        0 => String::new(),
        1 => "·明天".to_string(),
        2 => "·后天".to_string(),
        n if n <= 6 => format!(
            "·周{}",
            ["一", "二", "三", "四", "五", "六", "日"]
                [due.weekday().num_days_from_monday() as usize]
        ),
        _ => format!("·{}月{}日", due.month(), due.day()),
    }
}

/// 按字数（码点）截断：超过 [max] 个字时保留前 [max] 字并追加省略号
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    format!("{}……", s.chars().take(max).collect::<String>())
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let (today, hp, rows) = menu_data(app);
    let info = MenuItem::with_id(
        app,
        "counts",
        &format!("今日 {today} · 高优 {hp}"),
        false, // 纯展示，不可点
        None::<&str>,
    )?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let mut items: Vec<&dyn IsMenuItem<tauri::Wry>> = vec![&info, &sep1];

    // 最近待办行（不可点会使「展示名称」失去入口，故可点：行为与「打开」一致）
    let task_items: Vec<MenuItem<tauri::Wry>> = rows
        .iter()
        .enumerate()
        .map(|(i, text)| {
            MenuItem::with_id(app, format!("task-{i}"), text, true, None::<&str>)
        })
        .collect::<Result<_, _>>()?;
    let sep_tasks = PredefinedMenuItem::separator(app)?;
    if !task_items.is_empty() {
        for item in &task_items {
            items.push(item);
        }
        items.push(&sep_tasks);
    }

    let open = MenuItem::with_id(app, "open", "打开 TodoLite", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 TodoLite", true, None::<&str>)?;
    items.push(&open);
    items.push(&sep2);
    items.push(&quit);
    Menu::with_items(app, &items)
}

/// 显示并聚焦主窗口
pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 数据变更后主动重建托盘菜单（commands::write_database 落盘成功后调用）。
///
/// 为什么不能依赖「点击时重建」：macOS 上 tray-icon 在 NSView `mouseDown:` 里
/// 同步弹菜单（`performClick` 进入嵌套菜单追踪循环），物理 mouse-up 被追踪循环
/// 吞掉、永远收不到；且 tauri 的托盘事件经 EventLoopProxy 异步排队，任何挂在
/// 点击事件上的重建都赶在弹出之前执行不了——菜单内容会一直停在启动那一刻。
/// 因此与 Android 小组件「写完快照立刻 refreshAll」同构：数据一落盘就重建菜单，
/// 之后任意时刻点击弹出的都是最新数据。Windows（先派发 Up 事件再弹菜单）与
/// Linux（appindicator 由 set_menu 更新 DBus 菜单）同样由此机制受益。
pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    if let Ok(menu) = build_menu(app) {
        let _ = tray.set_menu(Some(menu));
    }
}

/// 创建菜单栏图标。在 tauri::Builder::setup 中调用（仅桌面端）。
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("TodoLite")
        .menu(&build_menu(app)?)
        .show_menu_on_left_click(true) // 左/右键都弹出菜单
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            // 「打开」与最近待办行（task-N）：打开/聚焦主窗口
            _ => show_main(app),
        })
        .on_tray_icon_event(|tray, event| {
            // 兜底：菜单弹出前再刷一次。正常路径由 refresh() 在数据落盘时完成；
            // 这里保留是因为 Windows 在 LBUTTONUP 弹菜单前会先派发 Up 事件，
            // 可覆盖「应用运行期间数据文件被外部改动」的场景。macOS 的 Up 被
            // 菜单追踪循环吞掉，本兜底不生效也不妨碍（见 refresh 的注释）。
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Ok(menu) = build_menu(app) {
                    let _ = tray.set_menu(Some(menu));
                }
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    TRAY_AVAILABLE.store(true, Ordering::Relaxed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 固定"今天"：2026-01-14（周三）
    const TODAY: &str = "2026-01-14";

    fn task(title: &str, extra: serde_json::Value) -> serde_json::Value {
        let base = json!({
            "id": "t",
            "listId": "l1",
            "title": title,
            "sortOrder": 0,
            "priority": 0,
            "completedAt": null,
            "deletedAt": null,
            "createdAt": "2026-01-14T08:00:00Z",
        });
        let mut o = base.as_object().unwrap().clone();
        if let Some(extra) = extra.as_object() {
            for (k, v) in extra {
                o.insert(k.clone(), v.clone());
            }
        }
        serde_json::Value::Object(o)
    }

    fn analyze_tasks(tasks: serde_json::Value) -> (u32, u32, Vec<String>) {
        analyze(&json!({ "tasks": tasks }), TODAY.parse().unwrap())
    }

    #[test]
    fn nearest_order_overdue_today_future_undated() {
        let (_, _, texts) = analyze_tasks(json!([
            task("无日期", json!({})),
            task("后天", json!({ "dueDate": "2026-01-16", "sortOrder": 2 })),
            task("今天", json!({ "dueDate": TODAY, "sortOrder": 3 })),
            task("逾期", json!({ "dueDate": "2026-01-10", "sortOrder": 4 })),
            task("明天", json!({ "dueDate": "2026-01-15", "sortOrder": 5 })),
        ]));
        let titles: Vec<String> = texts
            .iter()
            .map(|t| t.trim_start_matches("□ ").to_string())
            .collect();
        assert_eq!(titles[0], "逾期·逾期4天");
        assert_eq!(titles[1], "今天");
        assert_eq!(titles[2], "明天·明天");
        assert_eq!(titles[3], "后天·后天");
        assert_eq!(titles[4], "无日期");
    }

    #[test]
    fn suffix_weekday_and_far_date() {
        // 2026-01-17 是周六（3 天后），2026-02-01 超出一周
        let (_, _, texts) = analyze_tasks(json!([
            task("本周", json!({ "dueDate": "2026-01-17" })),
            task("远期", json!({ "dueDate": "2026-02-01" })),
            task("逾期多日", json!({ "dueDate": "2026-01-11" })),
        ]));
        // 升序排列后：逾期多日(01-11) → 本周(01-17 周六) → 远期(02-01)
        assert!(texts[0].contains("·逾期3天"), "{}", texts[0]);
        assert!(texts[1].contains("·周六"), "{}", texts[1]);
        assert!(texts[2].contains("·2月1日"), "{}", texts[2]);
    }

    #[test]
    fn high_priority_mark_and_counts() {
        let (today_n, hp_n, texts) = analyze_tasks(json!([
            task("救火", json!({ "priority": 3 })),
            task("普通", json!({})),
        ]));
        assert_eq!(today_n, 0);
        assert_eq!(hp_n, 1);
        assert!(texts[0].ends_with("❗"), "{}", texts[0]);
        assert!(!texts[1].contains('❗'));
    }

    #[test]
    fn today_due_has_no_suffix_and_counts_today() {
        let (today_n, _, texts) =
            analyze_tasks(json!([task("到期今天", json!({ "dueDate": TODAY }))]));
        assert_eq!(today_n, 1);
        assert_eq!(texts[0], "□ 到期今天");
    }

    #[test]
    fn completed_and_deleted_excluded() {
        let (today_n, hp_n, texts) = analyze_tasks(json!([
            task("做完", json!({ "dueDate": TODAY, "completedAt": "2026-01-14T09:00:00Z" })),
            task("删了", json!({ "priority": 3, "deletedAt": "2026-01-13T00:00:00Z" })),
        ]));
        assert_eq!((today_n, hp_n), (0, 0));
        assert!(texts.is_empty());
    }

    #[test]
    fn cap_at_eight() {
        let tasks: Vec<_> = (0..12)
            .map(|i| {
                task(
                    "x",
                    json!({ "dueDate": format!("2026-02-{:02}", i + 1), "title": format!("任务{i}") }),
                )
            })
            .collect();
        let (_, _, texts) = analyze_tasks(serde_json::Value::Array(tasks));
        assert_eq!(texts.len(), NEAREST_MAX);
        assert!(texts[0].starts_with("□ 任务0"));
    }

    #[test]
    fn long_title_truncated() {
        let (_, _, texts) = analyze_tasks(json!([task("一二三四五六七八九十甲乙丙丁戊己庚辛壬", json!({}))]));
        let t = &texts[0];
        assert!(t.ends_with("……"), "{t}");
        assert!(t.chars().count() < 25, "{t}");
    }

    #[test]
    fn same_day_keeps_manual_order() {
        let (_, _, texts) = analyze_tasks(json!([
            task("B", json!({ "dueDate": TODAY, "sortOrder": 20 })),
            task("A", json!({ "dueDate": TODAY, "sortOrder": 10 })),
        ]));
        assert!(texts[0].contains("A"));
        assert!(texts[1].contains("B"));
    }

    // ---------- 重复任务（与前端 core/repeat.ts 同口径） ----------

    #[test]
    fn daily_stale_due_shows_today_without_overdue_mark() {
        // 每天任务锚点拖了 3 天没打开：按「今天」呈现，不倒贴逾期
        let (today_n, _, texts) = analyze_tasks(json!([
            task("背单词", json!({
                "dueDate": "2026-01-11",
                "repeat": { "kind": "daily" },
            })),
        ]));
        assert_eq!(today_n, 1);
        assert_eq!(texts[0], "□ 背单词"); // 无任何到期角标
    }

    #[test]
    fn recurring_done_period_hidden_until_next() {
        // 打卡完成当期（dueDate 滚到明天、日志含今天）：不计今日数、不占最近列表
        let (today_n, _, texts) = analyze_tasks(json!([
            task("背单词", json!({
                "dueDate": "2026-01-15",
                "repeat": { "kind": "daily" },
                "doneLog": ["2026-01-14"],
            })),
        ]));
        assert_eq!(today_n, 0);
        assert!(texts.is_empty());
    }

    #[test]
    fn weekly_missed_rolls_to_next_weekday_suffix() {
        // 每周二任务，锚点还是昨天（周二），今天是周三 → 展示下周二（·周二）
        let (today_n, _, texts) = analyze_tasks(json!([
            task("组会", json!({
                "dueDate": "2026-01-13",
                "repeat": { "kind": "weekly", "dow": 2 },
            })),
        ]));
        assert_eq!(today_n, 0);
        assert!(texts[0].contains("·周二"), "{}", texts[0]);
    }

    #[test]
    fn monthly_clamp_rust_side() {
        // 每月31日：1月31日的下一期钳制到 2月28日（2026 平年）
        let rule = RepeatRule::Monthly(31);
        let jan31 = parse_date("2026-01-31").unwrap();
        assert_eq!(next_occurrence(&rule, jan31), parse_date("2026-02-28").unwrap());
        // 反推对称：从 2月28日 上一期是 1月31日（不能是 1月28日）
        assert_eq!(
            previous_occurrence(&rule, parse_date("2026-02-28").unwrap()),
            jan31
        );
    }

    #[test]
    fn parse_repeat_rejects_invalid() {
        assert_eq!(parse_repeat(&json!({ "kind": "daily" })), Some(RepeatRule::Daily));
        assert_eq!(
            parse_repeat(&json!({ "kind": "weekly", "dow": 7 })),
            None
        );
        assert_eq!(parse_repeat(&json!({ "kind": "monthly", "day": 0 })), None);
        assert_eq!(parse_repeat(&json!({ "kind": "yearly" })), None);
        assert_eq!(parse_repeat(&json!("daily")), None);
    }
}
