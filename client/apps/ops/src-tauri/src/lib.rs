#[path = "../../../../packages/core/rust/api_http.rs"]
mod api_http;

#[path = "../../../../packages/core/rust/alert_popup.rs"]
mod alert_popup;

mod child_webview;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};

/// 显示并聚焦主窗口（托盘点击、重复启动都走这里）
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

    // 只允许运行一个实例：再次打开时唤起已在运行的窗口（客户端常驻托盘，用户容易重复打开）。
    // 开发版不限制，否则装好的版本还在托盘里时 tauri dev 一启动就退出
    #[cfg(all(desktop, not(debug_assertions)))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)));
    }

    // 自动更新（菜单里的"检查更新"），见 packages/core/src/ui/UpdateMenu.tsx
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build()).plugin(tauri_plugin_process::init());
    }

    builder
        // 平台接口由 Rust 层发出（不受 WebView 的 CORS 限制），共用一个连接池，见 api_http.rs
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            api_http::api_request,
            api_http::api_request_pages,
            api_http::api_upload,
            api_http::api_warm,
            api_http::perf_log,
            alert_popup::alert_popup_show,
            alert_popup::alert_popup_hide,
            alert_popup::alert_popup_create,
            alert_popup::alert_popup_destroy,
            child_webview::child_webview_create
        ])
        .setup(|app| {
            // 告警弹窗窗口这里不建：只在系统设置里打开了"告警弹窗"后才建（前端调 alert_popup_create）
            let show = MenuItem::with_id(app, "show", "打开 Radar Config", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Radar Config")
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
                // 告警弹窗按 Alt+F4 也只是隐藏，下次有告警还要用
                if w.label() == "main" || w.label() == alert_popup::POPUP {
                    api.prevent_close();
                    let _ = w.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
