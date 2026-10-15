//! 两个客户端共用的平台接口请求命令（各自的 lib.rs 用 #[path] 引入）。
//!
//! 不直接用 plugin-http 的 fetch：它每个请求新建一个 reqwest Client，每次都要重新建 TCP + TLS 连接。
//! 网络有丢包时新连接的 TLS 握手会按重传退避卡住 1、3、7、15 秒（2026-10-15 实测本机 30 次新连接有 13 次卡住），
//! 切换机构时同时发的几个请求一起卡十几到三十几秒。这里全程共用一个 Client：连接复用，平台支持时走 HTTP/2 多路复用。

use std::{collections::HashMap, sync::LazyLock, time::Duration};
use tauri_plugin_http::reqwest;

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_keepalive(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .expect("创建 HTTP 客户端失败")
});

#[derive(serde::Serialize)]
pub struct ApiResponse {
    status: u16,
    body: String,
}

#[tauri::command]
pub async fn api_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<ApiResponse, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!("不支持的地址：{url}"));
    }
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = CLIENT.request(method, &url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(ApiResponse { status, body })
}
