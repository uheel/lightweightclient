#[path = "../../../../packages/core/rust/api_http.rs"]
mod api_http;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

/// 告警弹窗：独立的小窗口，置顶、不进任务栏，固定在屏幕右下角（主窗口所在的屏幕）。
/// 内容由主窗口通过事件推送，见 src/desktop/AlertPopup.tsx
const POPUP: &str = "alert-popup";
const POPUP_WIDTH: f64 = 372.0;
const POPUP_MARGIN: f64 = 12.0;

/// 按内容高度（逻辑像素）摆好位置并显示，不抢焦点
#[tauri::command]
fn alert_popup_show(app: AppHandle, height: f64) {
    let Some(w) = app.get_webview_window(POPUP) else { return };
    let monitor = app
        .get_webview_window("main")
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| w.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let scale = m.scale_factor();
        let area = m.work_area();
        let (pw, ph, margin) = ((POPUP_WIDTH * scale) as i32, (height * scale) as i32, (POPUP_MARGIN * scale) as i32);
        let _ = w.set_size(PhysicalSize::new(pw as u32, ph as u32));
        let _ = w.set_position(PhysicalPosition::new(
            area.position.x + area.size.width as i32 - pw - margin,
            area.position.y + area.size.height as i32 - ph - margin,
        ));
    }
    let _ = w.show();
    let _ = w.set_always_on_top(true);
}

#[tauri::command]
fn alert_popup_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window(POPUP) {
        let _ = w.hide();
    }
}

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
        // 自动更新（菜单里的"检查更新"），见 packages/core/src/ui/UpdateMenu.tsx
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build()).plugin(tauri_plugin_process::init());
    }

    builder
        // 平台接口由 Rust 层发出（不受 WebView 的 CORS 限制），共用一个连接池，见 api_http.rs
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![api_http::api_request, api_http::api_request_pages, api_http::api_warm, api_http::perf_log, alert_popup_show, alert_popup_hide])
        .setup(|app| {
            // 告警弹窗启动时就建好（隐藏），有告警时直接显示，不用等页面加载
            WebviewWindowBuilder::new(app, POPUP, WebviewUrl::App("index.html#alert-popup".into()))
                .title("新告警")
                .inner_size(POPUP_WIDTH, 160.0)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .focused(false)
                .visible(false)
                .build()?;
            let show = MenuItem::with_id(app, "show", "打开 Health Guardian", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出（不再接收告警）", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            // id 为 "main"，前端用 TrayIcon.getById("main") 更新提示文字（待处理告警数）
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Health Guardian")
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
                if w.label() == "main" || w.label() == POPUP {
                    api.prevent_close();
                    let _ = w.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
