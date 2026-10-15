#[path = "../../../../packages/core/rust/api_http.rs"]
mod api_http;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};

/// 显示并聚焦主窗口（托盘点击、重复启动、通知后都走这里）
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // 只允许运行一个实例：再次打开时唤起已在运行的窗口（客户端常驻托盘，用户容易重复打开）
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)));
    }

    builder
        // 平台接口由 Rust 层发出（不受 WebView 的 CORS 限制），共用一个连接池，见 api_http.rs
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![api_http::api_request])
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "打开康养看护", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出（不再接收告警）", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            // id 为 "main"，前端用 TrayIcon.getById("main") 更新提示文字（待处理告警数）
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("康养看护")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        // 关闭窗口 = 隐藏到托盘，继续接收告警；真正退出走托盘菜单
        .on_window_event(|w, e| {
            if let WindowEvent::CloseRequested { api, .. } = e {
                if w.label() == "main" {
                    api.prevent_close();
                    let _ = w.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
