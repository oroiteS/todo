//! 各平台小组件快照落点。返回 None 表示该平台暂无小组件体系。

use std::path::PathBuf;
use tauri::Manager;

pub const APP_GROUP_ID: &str = "group.com.syn.todolite";

#[cfg(target_os = "macos")]
pub fn snapshot_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    // 优先 App Group 容器（WidgetKit 扩展以沙盒 + App Groups 权限读取）。
    // 主应用非沙盒，目录不存在时直接创建即可；创建失败再回退应用数据目录。
    if let Ok(home) = std::env::var("HOME") {
        let group = PathBuf::from(home)
            .join("Library/Group Containers")
            .join(APP_GROUP_ID);
        if group.is_dir() || std::fs::create_dir_all(&group).is_ok() {
            return Some(group);
        }
        log::warn!("app group dir create failed, fallback to app data dir");
    }
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("widget"))
}

#[cfg(target_os = "android")]
pub fn snapshot_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("widget"))
}

#[cfg(not(any(target_os = "macos", target_os = "android")))]
pub fn snapshot_dir(_app: &tauri::AppHandle) -> Option<PathBuf> {
    // Windows / Linux：暂无小组件体系（Windows 11 Widgets 无第三方 API），
    // 保留接口，未来若官方开放可在此扩展。
    None
}
