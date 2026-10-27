//! 两个客户端共用的平台接口请求命令（各自的 lib.rs 用 #[path] 引入）。
//!
//! 不直接用 plugin-http 的 fetch：它每个请求新建一个 reqwest Client，每次都要重新建 TCP + TLS 连接。
//! 网络有丢包时新连接的 TLS 握手会按重传退避卡住 1、3、7、15 秒（2026-10-15 实测本机 30 次新连接有 13 次卡住，
//! 20 次里有 11 次超过 3 秒），切换机构时同时发的几个请求一起卡十几到三十几秒。这里全程共用一个 Client。
//!
//! 平台只支持 HTTP/1.1（ALPN 不协商 h2），一个连接同一时间只能跑一个请求，并发几个请求就要新建几个连接。所以：
//! 1. 预热：登录页一出现就建好 POOL 个连接，之后每 25 秒发一轮轻量请求让它们保持活跃（api_warm）；
//! 2. 限流：同时在途的请求不超过 POOL 个，登录后一起发出的请求排队用已经建好的连接，不再临时新建连接。
//!
//! 2026-10-16 实测大列表慢主要在下载响应体（未压缩时约 400KB/s，3.7MB 的通信日志要 7–11 秒），
//! 所以：打开 gzip（平台 nginx 压缩 JSON 约 7 倍，见 Cargo.toml 的 reqwest）；多页数据在这里并发取（api_request_pages）；
//! 响应体按原始字节交给前端（pack）。

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex, Once},
    time::{Duration, Instant},
};
use serde_json::value::RawValue;
use tauri::ipc::Response;
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

/// 各阶段耗时（毫秒），前端用来定位慢在哪：排队等名额 / 平台处理到返回响应头 / 下载响应体
#[derive(serde::Serialize, Default)]
struct Timing {
    queue: f64,
    ttfb: f64,
    body: f64,
    /// 解压后的响应体大小
    bytes: usize,
    pages: u32,
}

#[derive(serde::Serialize)]
struct Meta {
    status: u16,
    timing: Timing,
}

fn ms(d: Duration) -> f64 {
    (d.as_secs_f64() * 10000.0).round() / 10.0
}

/// 返回给前端的原始字节：第一行是 Meta 的 JSON（状态码、耗时），换行后是响应体原样。
/// 不再把响应体当字符串塞进 JSON 返回：那样几 MB 的响应体要在 Rust 里转义一遍、在 WebView 里再解析一遍。
fn pack(status: u16, timing: Timing, body: &[u8]) -> Response {
    let mut out = serde_json::to_vec(&Meta { status, timing }).unwrap_or_default();
    out.reserve(body.len() + 1);
    out.push(b'\n');
    out.extend_from_slice(body);
    Response::new(out)
}

fn check_url(url: &str) -> Result<(), String> {
    if url.starts_with("https://") || url.starts_with("http://") {
        Ok(())
    } else {
        Err(format!("不支持的地址：{url}"))
    }
}

struct Fetched {
    status: u16,
    body: Vec<u8>,
    queue: Duration,
    ttfb: Duration,
    download: Duration,
}

impl Fetched {
    fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }
    fn timing(&self) -> Timing {
        Timing { queue: ms(self.queue), ttfb: ms(self.ttfb), body: ms(self.download), bytes: self.body.len(), pages: 1 }
    }
}

/// 排队拿到名额后再发，保证在途请求不超过预热好的连接数
async fn fetch(req: reqwest::RequestBuilder) -> Result<Fetched, String> {
    let t0 = Instant::now();
    let _permit = GATE.acquire().await.map_err(|e| e.to_string())?;
    let t1 = Instant::now();
    let res = req.send().await.map_err(|e| {
        if e.is_timeout() {
            "平台 60 秒内没有响应，请缩小查询范围后重试".to_string()
        } else {
            e.to_string()
        }
    })?;
    let t2 = Instant::now();
    let status = res.status().as_u16();
    let body: Vec<u8> = res.bytes().await.map_err(|e| e.to_string())?.into();
    Ok(Fetched { status, body, queue: t1 - t0, ttfb: t2 - t1, download: t2.elapsed() })
}

fn with_headers(mut req: reqwest::RequestBuilder, headers: &HashMap<String, String>) -> reqwest::RequestBuilder {
    for (k, v) in headers {
        req = req.header(k, v);
    }
    req
}

#[tauri::command]
pub async fn api_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<Response, String> {
    check_url(&url)?;
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = with_headers(CLIENT.request(method, &url), &headers);
    if let Some(b) = body {
        req = req.body(b);
    }
    let f = fetch(req).await?;
    Ok(pack(f.status, f.timing(), &f.body))
}

/// 上传文件（multipart）：前端把 FormData 编码成原始字节直接作为 IPC 请求体传过来（不转成 JSON 数组，几百 KB 的图片也只拷一次），
/// 目标地址和请求头放在 IPC 请求头里：x-url、x-headers（JSON，含 multipart 的 content-type 和 boundary）
#[tauri::command]
pub async fn api_upload(request: tauri::ipc::Request<'_>) -> Result<Response, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("上传内容格式不对".into());
    };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let url = header("x-url").ok_or("缺少上传地址")?;
    check_url(&url)?;
    let headers: HashMap<String, String> = serde_json::from_str(&header("x-headers").unwrap_or_default()).map_err(|e| e.to_string())?;
    let method = reqwest::Method::from_bytes(header("x-method").as_deref().unwrap_or("POST").as_bytes()).map_err(|e| e.to_string())?;
    let req = with_headers(CLIENT.request(method, &url), &headers).body(body.clone());
    let f = fetch(req).await?;
    Ok(pack(f.status, f.timing(), &f.body))
}

/// 平台分页接口的一页：只解析外层，data 保持原始 JSON 文本，合并时直接拼接，不逐条反序列化
#[derive(serde::Deserialize)]
struct Page<'a> {
    #[serde(default)]
    succeeded: bool,
    #[serde(default)]
    total: Option<u64>,
    #[serde(borrow, default)]
    data: Option<&'a RawValue>,
}

/// 取一个分页 GET 接口的全部数据（最多 max_rows 条）：先取第 1 页拿到 total，其余页并发取（受 GATE 限流），
/// 按页序拼成一个 {"succeeded":true,"total":平台总数,"data":[...]} 返回。
/// url 不带 current / pageSize，这里追加。任何一页失败就把那一页的响应原样返回，由前端统一处理错误。
/// 注意：分页之间如果有新数据写入，页边界可能有重复或遗漏（和逐页顺序取一样），查询的时间范围固定时没有这个问题。
#[tauri::command]
pub async fn api_request_pages(
    url: String,
    headers: HashMap<String, String>,
    page_size: u32,
    max_rows: u32,
) -> Result<Response, String> {
    check_url(&url)?;
    let t0 = Instant::now();
    let page_size = page_size.max(1);
    let page_req = |n: u32| with_headers(CLIENT.get(&url).query(&[("current", n), ("pageSize", page_size)]), &headers);

    let first = fetch(page_req(1)).await?;
    let first_total = match serde_json::from_slice::<Page>(&first.body) {
        Ok(p) if first.ok() && p.succeeded => p.total.unwrap_or(0),
        _ => return Ok(pack(first.status, first.timing(), &first.body)),
    };
    let pages = first_total.min(max_rows as u64).div_ceil(page_size as u64).max(1) as u32;

    let mut tasks = tokio::task::JoinSet::new();
    for n in 2..=pages {
        let req = page_req(n);
        tasks.spawn(async move { (n, fetch(req).await) });
    }
    let mut rest: Vec<(u32, Fetched)> = Vec::with_capacity(pages as usize);
    while let Some(r) = tasks.join_next().await {
        let (n, f) = r.map_err(|e| e.to_string())?;
        rest.push((n, f?));
    }
    rest.sort_by_key(|(n, _)| *n);

    let mut bodies: Vec<&Fetched> = vec![&first];
    bodies.extend(rest.iter().map(|(_, f)| f));
    let mut out = Vec::with_capacity(bodies.iter().map(|f| f.body.len()).sum::<usize>() + 64);
    out.extend_from_slice(format!("{{\"succeeded\":true,\"total\":{first_total},\"data\":[").as_bytes());
    let mut empty = true;
    for f in &bodies {
        let page = match serde_json::from_slice::<Page>(&f.body) {
            Ok(p) if f.ok() && p.succeeded => p,
            _ => return Ok(pack(f.status, f.timing(), &f.body)),
        };
        let raw = page.data.map(|d| d.get().trim()).unwrap_or("[]");
        let inner = raw.strip_prefix('[').and_then(|r| r.strip_suffix(']')).unwrap_or("").trim();
        if !inner.is_empty() {
            if !empty {
                out.push(b',');
            }
            out.extend_from_slice(inner.as_bytes());
            empty = false;
        }
    }
    out.extend_from_slice(b"]}");

    let timing = Timing {
        queue: ms(first.queue),
        ttfb: ms(first.ttfb),
        body: ms(t0.elapsed().saturating_sub(first.queue + first.ttfb)),
        bytes: bodies.iter().map(|f| f.body.len()).sum(),
        pages,
    };
    Ok(pack(200, timing, &out))
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

/// 前端的耗时记录（只在调试构建里输出）：打到终端的 stderr（不缓冲，窗口关掉也不会丢），
/// 同时追加到系统临时目录的 radar-perf.log，方便事后对照
#[tauri::command]
pub fn perf_log(line: String) {
    if cfg!(debug_assertions) {
        use std::io::Write;
        eprintln!("{line}");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(std::env::temp_dir().join("radar-perf.log")) {
            let _ = writeln!(f, "{line}");
        }
    }
}
