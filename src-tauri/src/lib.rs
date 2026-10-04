mod commands;
#[cfg(desktop)]
mod tray;
mod widget;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_database,
            commands::write_database,
            commands::set_secret,
            commands::get_secret,
            commands::delete_secret,
            widget::write_widget_snapshot,
            commands::platform_info,
            commands::http_request,
        ])
        .setup(|app| {
            // 菜单栏图标（右上角常驻入口），仅桌面端
            #[cfg(desktop)]
            {
                #[cfg(target_os = "linux")]
                {
                    // Linux 极简桌面可能缺 appindicator/DBus：托盘失败不致命，
                    // 只是退化为普通窗口应用（关闭窗口即退出，见 on_window_event）
                    if let Err(e) = tray::init(app.handle()) {
                        log::warn!("系统托盘初始化失败，关闭窗口将直接退出: {e}");
                    }
                }
                #[cfg(not(target_os = "linux"))]
                tray::init(app.handle())?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 桌面端：关闭窗口 = 隐藏到菜单栏驻留后台（退出走菜单栏图标 → 退出）
            // Linux 托盘不可用时例外：放行关闭，避免「隐藏后无处恢复」
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                #[cfg(target_os = "linux")]
                if !tray::TRAY_AVAILABLE.load(std::sync::atomic::Ordering::Relaxed) {
                    return;
                }
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS：Dock 图标点击时恢复主窗口（窗口隐藏后应用仍在运行）
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                tray::show_main(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
