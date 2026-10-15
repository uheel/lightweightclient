//! 两个客户端共用的平台接口请求命令（各自的 lib.rs 用 #[path] 引入）。
//!
//! 不直接用 plugin-http 的 fetch：它每个请求新建一个 reqwest Client，每次都要重新建 TCP + TLS 连接。
//! 网络有丢包时新连接的 TLS 握手会按重传退避卡住 1、3、7、15 秒（2026-10-15 实测本机 30 次新连接有 13 次卡住，
//! 20 次里有 11 次超过 3 秒），切换机构时同时发的几个请求一起卡十几到三十几秒。这里全程共用一个 Client。
//!
//! 平台只支持 HTTP/1.1（ALPN 不协商 h2），一个连接同一时间只能跑一个请求，并发几个请求就要新建几个连接。所以：
//! 1. 预热：登录页一出现就建好 POOL 个连接，之后每 25 秒发一轮轻量请求让它们保持活跃（api_warm）；
//! 2. 限流：同时在途的请求不超过 POOL 个，登录后一起发出的请求排队用已经建好的连接，不再临时新建连接。

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex, Once},
    time::Duration,
};
use tauri_plugin_http::reqwest;
use tokio::sync::Semaphore;

/// 预热并保持的连接数，也是同时在途请求的上限
const POOL: usize = 6;
/// 保活间隔：要短于服务器关闭空闲连接的时间（常见 60 秒）
const KEEP_WARM: Duration = Duration::from_secs(25);

static GATE: Semaphore = Semaphore::const_new(POOL);
/// 当前要保活的服务器地址
static WARM_TARGET: Mutex<Option<String>> = Mutex::new(None);
static WARM_LOOP: Once = Once::new();

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(POOL * 2)
        .tcp_keepalive(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(15))
        // 整个请求的上限：平台遇到大查询（例如不带 SN 查全部设备的通信日志）可能一直不返回，界面会一直转圈
        .timeout(Duration::from_secs(60))
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
    // 排队拿到名额后再发，保证在途请求不超过预热好的连接数
    let _permit = GATE.acquire().await.map_err(|e| e.to_string())?;
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = CLIENT.request(method, &url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let res = req.send().await.map_err(|e| {
        if e.is_timeout() {
            "平台 60 秒内没有响应，请缩小查询范围后重试".to_string()
        } else {
            e.to_string()
        }
    })?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(ApiResponse { status, body })
}

/// 建好 / 保持 POOL 个到服务器的连接：同时发 POOL 个 HEAD 请求，空闲连接不够时 reqwest 会新建。
/// 不占用 GATE 名额，卡在握手上也不影响界面的请求。
async fn warm_once() {
    let Some(base) = WARM_TARGET.lock().unwrap().clone() else { return };
    let url = format!("{}/", base.trim_end_matches('/'));
    let mut tasks = tokio::task::JoinSet::new();
    for _ in 0..POOL {
        let url = url.clone();
        tasks.spawn(async move {
            let _ = CLIENT.head(&url).timeout(Duration::from_secs(30)).send().await;
        });
    }
    while tasks.join_next().await.is_some() {}
}

/// 设置要预热的服务器（登录页出现时、每次请求时调用，地址没变就什么都不做）
#[tauri::command]
pub fn api_warm(server: String) {
    if !(server.starts_with("https://") || server.starts_with("http://")) {
        return;
    }
    let changed = {
        let mut t = WARM_TARGET.lock().unwrap();
        if t.as_deref() == Some(server.as_str()) {
            false
        } else {
            *t = Some(server);
            true
        }
    };
    WARM_LOOP.call_once(|| {
        tauri::async_runtime::spawn(async {
            loop {
                tokio::time::sleep(KEEP_WARM).await;
                warm_once().await;
            }
        });
    });
    if changed {
        tauri::async_runtime::spawn(warm_once());
    }
}
