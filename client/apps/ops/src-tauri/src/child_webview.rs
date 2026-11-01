use tauri::{
    webview::{PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};

/**
 * 在主窗口里建一个子 webview，页面加载前先跑 script。
 * 前端的 new Webview() 不能带初始化脚本，数据魔墙的平台页面要靠它在平台页面加载前写入登录信息，所以放在这里建；
 * 建好后移动、隐藏、关闭还是前端用 Webview.getByLabel 来做（见 workspace/childWebview.ts）。
 * 页面加载完发 child-webview-loaded（内容是 label）给主窗口，前端等它再显示，避免屏幕上出现白屏。
 * 要是 async：Windows 上在同步命令里建 webview 会死锁。
 */
#[tauri::command]
pub async fn child_webview_create(app: AppHandle, label: String, url: String, script: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let window = app.get_window("main").ok_or("找不到主窗口")?;
    let url = url.parse().map_err(|e| format!("网址不对：{e}"))?;
    let builder = WebviewBuilder::new(label, WebviewUrl::External(url))
        .initialization_script(script)
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = webview.app_handle().emit_to("main", "child-webview-loaded", webview.label());
            }
        });
    window.add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
    Ok(())
}
