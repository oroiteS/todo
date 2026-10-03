//! 各平台小组件快照落点。返回 None 表示该平台暂无小组件体系。

use std::path::PathBuf;
use tauri::Manager;

pub const APP_GROUP_ID: &str = "group.com.syn.todolite";

#[cfg(target_os = "macos")]
pub fn snapshot_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    // 优先 App Group 容器（需要正式签名 + entitlements，后续小组件任务启用）。
    // 未启用时目录不存在，回退到应用数据目录，保证开发期快照同样可见。
    if let Ok(home) = std::env::var("HOME") {
        let group = PathBuf::from(home)
            .join("Library/Group Containers")
            .join(APP_GROUP_ID);
        if group.is_dir() {
            return Some(group);
        }
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
