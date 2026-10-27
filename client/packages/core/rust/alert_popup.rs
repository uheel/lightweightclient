//! 告警弹窗窗口（用户端、运维端共用，两端 lib.rs 用 #[path] 引入）：
//! 独立的小窗口，置顶、不进任务栏，固定在屏幕右下角（主窗口所在的屏幕）。
//! 内容由主窗口通过事件推送，见 packages/core/src/ui/AlertPopup.tsx

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl, WebviewWindowBuilder};

pub const POPUP: &str = "alert-popup";
const POPUP_WIDTH: f64 = 372.0;
const POPUP_MARGIN: f64 = 12.0;

/// 建好弹窗窗口（隐藏），已经有了就不动。用户端启动时就建，运维端打开弹窗开关时才建
pub fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if app.get_webview_window(POPUP).is_some() {
        return Ok(());
    }
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
    Ok(())
}

/// 必须是 async 命令：在同步命令里建窗口，Windows 上会卡死主线程（整个程序没反应）
#[tauri::command]
pub async fn alert_popup_create(app: AppHandle) {
    let _ = create(&app);
}

#[tauri::command]
pub async fn alert_popup_destroy(app: AppHandle) {
    if let Some(w) = app.get_webview_window(POPUP) {
        let _ = w.destroy();
    }
}

/// 按内容高度（逻辑像素）摆好位置并显示，不抢焦点
#[tauri::command]
pub fn alert_popup_show(app: AppHandle, height: f64) {
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
pub fn alert_popup_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window(POPUP) {
        let _ = w.hide();
    }
}
