#[path = "../../../../packages/core/rust/api_http.rs"]
mod api_http;

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
        .invoke_handler(tauri::generate_handler![api_http::api_request, api_http::api_request_pages, api_http::api_warm, api_http::perf_log])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
