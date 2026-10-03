//! 小组件数据快照（预留接口，v1 只写快照文件，不包含任何小组件 UI）。
//!
//! 设计：前端每次数据变更后推送一份「精简快照」（WidgetSnapshot）到此模块，
//! 按 `#[cfg]` 写入各平台小组件进程可读取的位置：
//! - macOS: App Group 容器 `group.com.syn.todolite`（未来 WidgetKit 扩展读取），
//!   未启用签名/App Group 时回退到应用数据目录 `widget/`
//! - Android: 应用数据目录 `widget/`（未来 AppWidget Provider / Glance 读取）
//! - 其余桌面平台: 目前无小组件体系，写操作为 no-op
//!
//! 详见 docs/widget-adaptation.md。

pub mod platform;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetTaskRef {
    pub id: String,
    pub title: String,
    pub list_name: String,
    pub due_date: Option<String>,
    /// 0 无 / 1 低 / 2 中 / 3 高；默认值保证旧快照仍可解码
    #[serde(default)]
    pub priority: u8,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetCounts {
    pub today: u32,
    pub upcoming: u32,
    pub all: u32,
    pub completed_today: u32,
    /// 高优先级（priority=3）未完成总数，v1.1 新增
    #[serde(default)]
    pub high_priority: u32,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSnapshot {
    pub generated_at: String,
    pub today: Vec<WidgetTaskRef>,
    pub overdue: Vec<WidgetTaskRef>,
    /// 高优先级（priority=3）未完成任务，与到期日无关；v1.1 新增
    #[serde(default)]
    pub high_priority: Vec<WidgetTaskRef>,
    pub counts: WidgetCounts,
}

#[tauri::command]
pub fn write_widget_snapshot(
    app: tauri::AppHandle,
    snapshot: WidgetSnapshot,
) -> Result<bool, String> {
    let Some(dir) = platform::snapshot_dir(&app) else {
        // 当前平台无小组件体系，静默跳过
        return Ok(false);
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("widget-snapshot.json");
    let tmp = dir.join("widget-snapshot.json.tmp");
    let json = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    log::debug!("widget snapshot written: {:?}", path);
    Ok(true)
}
