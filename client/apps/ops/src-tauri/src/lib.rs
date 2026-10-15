#[path = "../../../../packages/core/rust/api_http.rs"]
mod api_http;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 平台接口由 Rust 层发出（不受 WebView 的 CORS 限制），共用一个连接池，见 api_http.rs
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![api_http::api_request, api_http::api_warm])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
