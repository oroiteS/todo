//! Tauri 命令层：数据文件读写（原子写 + 备份轮转）、凭据存取、平台信息。
//! 小组件快照写入见 widget 模块。

use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;

const DATA_FILE: &str = "todolite-data.json";
const BACKUP_COUNT: usize = 5;
const SECRET_SERVICE: &str = "todolite";

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 读取本地数据库；文件不存在返回 Null（前端负责初始化默认库）。
/// 主文件损坏时按时间从新到旧尝试备份恢复。
#[tauri::command]
pub fn read_database(app: tauri::AppHandle) -> Result<Value, String> {
    let dir = data_dir(&app)?;
    let path = dir.join(DATA_FILE);
    if !path.exists() {
        return Ok(Value::Null);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    match serde_json::from_str::<Value>(&text) {
        Ok(v) => Ok(v),
        Err(primary_err) => {
            log::warn!("主数据文件损坏，尝试备份恢复: {primary_err}");
            for i in 1..=BACKUP_COUNT {
                let bak = dir.join(format!("{DATA_FILE}.bak{i}"));
                if !bak.exists() {
                    continue;
                }
                if let Ok(t) = fs::read_to_string(&bak) {
                    if let Ok(v) = serde_json::from_str::<Value>(&t) {
                        log::info!("已从备份 {bak:?} 恢复数据");
                        return Ok(v);
                    }
                }
            }
            Err(format!("数据文件损坏且无可用备份: {primary_err}"))
        }
    }
}

/// 原子写入：tmp + rename；写前把当前文件轮转为 .bak1..bak5。
#[tauri::command]
pub fn write_database(app: tauri::AppHandle, data: Value) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let path = dir.join(DATA_FILE);

    if path.exists() {
        for i in (1..BACKUP_COUNT).rev() {
            let from = dir.join(format!("{DATA_FILE}.bak{i}"));
            let to = dir.join(format!("{DATA_FILE}.bak{}", i + 1));
            let _ = fs::rename(from, to);
        }
        let _ = fs::copy(&path, dir.join(format!("{DATA_FILE}.bak1")));
    }

    let tmp = dir.join(format!("{DATA_FILE}.tmp"));
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        let _ = f.sync_all();
    }
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- 凭据存储 ----------

#[cfg(not(target_os = "android"))]
fn secret_set(key: &str, value: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SECRET_SERVICE, key).map_err(|e| e.to_string())?;
    entry.set_password(value).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
fn secret_get(key: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(SECRET_SERVICE, key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(target_os = "android"))]
fn secret_delete(key: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SECRET_SERVICE, key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Android 端：应用私有目录文件存储（不随 WebDAV 同步，不上传）。
#[cfg(target_os = "android")]
fn secret_file(app: &tauri::AppHandle, key: &str) -> Result<PathBuf, String> {
    let dir = data_dir(app)?;
    Ok(dir.join(format!("{key}.secret")))
}

#[cfg(target_os = "android")]
fn secret_set(app: &tauri::AppHandle, key: &str, value: &str) -> Result<(), String> {
    fs::write(secret_file(app, key)?, value).map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
fn secret_get(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
    let p = secret_file(app, key)?;
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(p).map(Some).map_err(|e| e.to_string())
}

#[cfg(target_os = "android")]
fn secret_delete(app: &tauri::AppHandle, key: &str) -> Result<(), String> {
    let p = secret_file(app, key)?;
    if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_secret(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        secret_set(&key, &value)
    }
    #[cfg(target_os = "android")]
    {
        secret_set(&app, &key, &value)
    }
}

#[tauri::command]
pub fn get_secret(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        secret_get(&key)
    }
    #[cfg(target_os = "android")]
    {
        secret_get(&app, &key)
    }
}

#[tauri::command]
pub fn delete_secret(app: tauri::AppHandle, key: String) -> Result<(), String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        secret_delete(&key)
    }
    #[cfg(target_os = "android")]
    {
        secret_delete(&app, &key)
    }
}

// ---------- 平台信息 ----------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
    pub data_dir: String,
    pub app_version: String,
}

#[tauri::command]
pub fn platform_info(app: tauri::AppHandle) -> Result<PlatformInfo, String> {
    let dir = data_dir(&app)?;
    Ok(PlatformInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        data_dir: dir.to_string_lossy().to_string(),
        app_version: app.package_info().version.to_string(),
    })
}
