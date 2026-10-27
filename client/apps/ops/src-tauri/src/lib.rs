#[path = "../../../../packages/core/rust/api_http.rs"]
mod api_http;

#[path = "../../../../packages/core/rust/alert_popup.rs"]
mod alert_popup;

use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

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
            api_http::api_warm,
            api_http::perf_log,
            alert_popup::alert_popup_show,
            alert_popup::alert_popup_hide,
            alert_popup::alert_popup_create,
            alert_popup::alert_popup_destroy
        ])
        // 告警弹窗窗口只在系统设置里打开了"告警弹窗"后才建（前端调 alert_popup_create）
        .on_window_event(|w, e| match e {
            // 告警弹窗按 Alt+F4 也只是隐藏，下次有告警还要用
            WindowEvent::CloseRequested { api, .. } if w.label() == alert_popup::POPUP => {
                api.prevent_close();
                let _ = w.hide();
            }
            // 运维端没有托盘：主窗口关了就退出，不让隐藏的弹窗窗口把进程留着
            WindowEvent::Destroyed if w.label() == "main" => w.app_handle().exit(0),
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
