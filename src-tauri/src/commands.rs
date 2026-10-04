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

// ---------- 统一 HTTP 出口（同步层专用，支持代理三模式） ----------
//
// tauri-plugin-http 的 fetch 只能"叠加"代理、无法强制直连（no_proxy），
// 因此同步请求统一走本命令，由这里精确控制代理行为：
//   none   不走代理：reqwest no_proxy()，无视系统/环境变量代理
//   auto   自动检测：reqwest 默认行为（HTTP_PROXY/HTTPS_PROXY/ALL_PROXY 环境变量，
//          以及 Windows / macOS 系统网络代理设置，需 reqwest system-proxy 特性）
//   manual 指定代理：显式 Proxy::all(url)，支持 http(s):// 与 socks5://

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpTextResponse {
    pub status: u16,
    pub ok: bool,
    /// 响应头（键统一小写，同名头后者覆盖）
    pub headers: Vec<(String, String)>,
    pub body: String,
    /// 跟随重定向后的最终 URL
    pub final_url: String,
}

fn friendly_net_err(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "请求超时".to_string()
    } else if e.is_connect() {
        format!("连接失败：{e}")
    } else if e.is_redirect() {
        format!("重定向次数过多：{e}")
    } else {
        format!("网络错误：{e}")
    }
}

#[tauri::command]
pub async fn http_request(
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    timeout_ms: Option<u64>,
    proxy_mode: Option<String>,
    proxy_url: Option<String>,
) -> Result<HttpTextResponse, String> {
    let m = reqwest::Method::from_bytes(method.to_ascii_uppercase().as_bytes())
        .map_err(|e| format!("无效的 HTTP 方法「{method}」: {e}"))?;
    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(20_000).clamp(1_000, 120_000));

    let mut builder = reqwest::Client::builder().timeout(timeout);
    match proxy_mode.as_deref() {
        Some("none") => builder = builder.no_proxy(),
        Some("manual") => {
            let proxy = proxy_url.as_deref().unwrap_or("").trim();
            if proxy.is_empty() {
                return Err("已选择「指定代理」但未填写代理地址".to_string());
            }
            let p = reqwest::Proxy::all(proxy).map_err(|e| format!("代理地址无效「{proxy}」: {e}"))?;
            builder = builder.proxy(p);
        }
        // auto / 未设置：reqwest 默认 = 环境变量 + 系统代理
        _ => {}
    }
    let client = builder.build().map_err(|e| format!("HTTP 客户端初始化失败：{e}"))?;

    let mut req = client.request(m, &url);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let res = req.send().await.map_err(|e| friendly_net_err(&e))?;
    let status = res.status().as_u16();
    let final_url = res.url().to_string();
    let mut hs: Vec<(String, String)> = Vec::with_capacity(res.headers().len());
    for (k, v) in res.headers() {
        if let Ok(val) = v.to_str() {
            let key = k.as_str().to_ascii_lowercase();
            if let Some(entry) = hs.iter_mut().find(|(ek, _)| *ek == key) {
                entry.1 = val.to_string();
            } else {
                hs.push((key, val.to_string()));
            }
        }
    }
    let text = res.text().await.map_err(|e| friendly_net_err(&e))?;
    Ok(HttpTextResponse {
        ok: (200..300).contains(&status),
        status,
        headers: hs,
        body: text,
        final_url,
    })
}
