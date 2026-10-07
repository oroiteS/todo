//! 数据目录解析：便携版（portable）支持。
//!
//! exe 同目录存在 `.portable` 标记文件时进入便携模式：数据写入 exe 旁的
//! `data/` 文件夹，随程序一起走（解压即用 / U 盘携带），不写用户 AppData。
//! 否则回退系统应用数据目录（Windows: `%APPDATA%\com.syn.todolite`）。
//!
//! 密钥（WebDAV 密码等）仍走系统凭据管理器（keyring），见 commands.rs——
//! 便携模式下它跟随当前系统账户而非 data/ 目录，属有意取舍（避免明文落盘）。

use std::path::{Path, PathBuf};
use tauri::Manager;

/// 便携模式标记文件名（CI 打包 portable zip 时会预置一个空文件）
pub const PORTABLE_MARKER: &str = ".portable";
/// 便携模式数据目录名（位于 exe 同级）
pub const PORTABLE_DATA_DIR: &str = "data";

/// 判定 exe 目录是否为便携模式（纯函数便于测试）。
/// 标记必须是文件而非目录，避免误触发。
pub fn portable_data_dir(exe_dir: &Path) -> Option<PathBuf> {
    exe_dir
        .join(PORTABLE_MARKER)
        .is_file()
        .then(|| exe_dir.join(PORTABLE_DATA_DIR))
}

/// 数据目录统一入口：便携模式优先，否则系统 app_data_dir。
/// 只解析不创建——创建时机由调用方（写数据前）决定。
pub fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::current_exe()
        .ok()
        .as_deref()
        .and_then(Path::parent)
        .and_then(portable_data_dir)
    {
        log::info!("便携模式：数据目录 = {}", dir.display());
        return Ok(dir);
    }
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_base(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "todolite-paths-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn no_marker_means_system_mode() {
        let base = temp_base("absent");
        assert_eq!(portable_data_dir(&base), None);
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn marker_file_activates_portable_dir() {
        let base = temp_base("file");
        std::fs::write(base.join(PORTABLE_MARKER), b"").unwrap();
        assert_eq!(
            portable_data_dir(&base),
            Some(base.join(PORTABLE_DATA_DIR))
        );
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn marker_must_be_file_not_dir() {
        let base = temp_base("dir");
        std::fs::create_dir_all(base.join(PORTABLE_MARKER)).unwrap();
        assert_eq!(portable_data_dir(&base), None);
        std::fs::remove_dir_all(&base).unwrap();
    }
}
