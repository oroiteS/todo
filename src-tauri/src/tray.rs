//! 菜单栏（系统托盘）图标 —— 应用右上角常驻入口。
//!
//! - 点击图标弹出菜单：实时统计「今日 N · 高优 M」（直接读本地数据文件）
//!   + 打开 TodoLite + 退出
//! - 主窗口关闭仅隐藏，应用驻留菜单栏后台；Dock 图标点击或菜单「打开」恢复窗口
//!   （见 lib.rs 的 on_window_event / RunEvent::Reopen）
//!
//! 仅桌面端编译（cfg(desktop)），移动端不受影响。

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

/// 托盘是否成功创建。Linux 极简桌面可能缺 libayatana-appindicator / DBus：
/// 此时应用不得驻留后台（关窗即退出），由 lib.rs 的 on_window_event 检查此标记。
pub static TRAY_AVAILABLE: AtomicBool = AtomicBool::new(false);

/// 与 commands::DATA_FILE 一致（那边是私有常量，这里独立声明）
const DATA_FILE: &str = "todolite-data.json";

/// 实时统计（今日到期未完成数，高优先级未完成数）。
/// 语义与前端 buildSnapshot 对齐：未删除、未完成；today = dueDate <= 今天；
/// 高优 = priority == 3。文件缺失/损坏时静默返回 0，菜单照常可用。
fn counts(app: &AppHandle) -> (u32, u32) {
    let empty = (0, 0);
    let Ok(dir) = app.path().app_data_dir() else {
        return empty;
    };
    let Ok(text) = std::fs::read_to_string(dir.join(DATA_FILE)) else {
        return empty;
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return empty;
    };
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut today_n = 0u32;
    let mut hp_n = 0u32;
    if let Some(tasks) = v["tasks"].as_array() {
        for t in tasks {
            // 墓碑/已完成：字符串即有效时间戳，null 表示未删除/未完成
            if t["deletedAt"].is_string() || t["completedAt"].is_string() {
                continue;
            }
            let due = t["dueDate"].as_str();
            if due.is_some_and(|d| d <= today.as_str()) {
                today_n += 1; // <= 今天：含逾期（与前端 todayTasks 语义一致）
            }
            if t["priority"].as_u64() == Some(3) {
                hp_n += 1;
            }
        }
    }
    (today_n, hp_n)
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let (today, hp) = counts(app);
    let info = MenuItem::with_id(
        app,
        "counts",
        &format!("今日 {today} · 高优 {hp}"),
        false, // 纯展示，不可点
        None::<&str>,
    )?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let open = MenuItem::with_id(app, "open", "打开 TodoLite", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 TodoLite", true, None::<&str>)?;
    Menu::with_items(app, &[&info, &sep1, &open, &sep2, &quit])
}

/// 显示并聚焦主窗口
pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// 创建菜单栏图标。在 tauri::Builder::setup 中调用（仅桌面端）。
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id("todolite-tray")
        .tooltip("TodoLite")
        .menu(&build_menu(app)?)
        .show_menu_on_left_click(true) // 左/右键都弹出菜单
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 每次左键抬起先刷新计数菜单，再由系统弹出
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
