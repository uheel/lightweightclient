# 雷达平台轻量客户端

一套代码，打出两个**完全独立**的桌面客户端：

| 客户端 | 目录 | 面向谁 | 内容 |
|---|---|---|---|
| **康养看护**（用户端） | `apps/user` | 护理值守、家属、机构管理者 | 长者实时状态、告警接收与处理、健康数据。**不出现任何设备、运维、调试、配置信息** |
| **雷达运维**（运维端） | `apps/ops` | 运维、安装、调试人员 | 设备状态、安装角度、通信日志、设备配置、升级等 |

- 两个客户端用**同一个平台账号**登录，但内容完全不同。显示什么由客户端决定，服务器端的权限依然有效。
- 两个客户端各自打包。用户端安装包里**不包含**任何运维代码。
- 客户端没有自己的后端，所有数据都直接调用 rd.igoodlife.com 网页端用的接口。
- 界面稿：https://claude.ai/artifact/2g1hiCvr4yzAnmFjpS7Js3（分"用户端"和"运维端"两页）

## 用户端已实现

- 登录、按权限识别角色（管理者 / 护理值守）、可管理多个机构的账号可以切换机构
- **护理值守首页**：长者卡片的实时状态（订阅设备频道）、筛选、待处理告警、今日需关注
- **告警处理**：选择实际情况并填写处理说明，写回平台（与网页端"处理告警"一致）
- **托盘常驻与系统通知**：
  - 关闭窗口会缩到托盘，继续接收告警；退出要在托盘菜单里点
  - 新告警时右下角弹出应用内提醒；如果窗口不在前台，还会发系统通知并让任务栏闪烁
  - 本次运行期间到达、但还没处理的告警，每 60 秒在后台再提醒一次
  - 托盘提示文字显示待处理数量
  - 只允许运行一个实例，重复打开会唤起已在运行的窗口

## 目录

```
client/
  package.json            npm workspaces 根，常用命令见下
  Cargo.toml              Rust workspace：两个客户端共享编译缓存 target/
  packages/core/          两端共用（@radar/core）
    src/http.ts           请求封装：Tauri 里走 plugin-http（绕开 CORS），统一处理请求头、filter[] 参数、响应解包、401
    src/session.ts        登录会话（token 只存在内存）
    src/auth.ts           登录 / 退出，与网页端流程一致
    src/org.ts            机构树、切换机构
    src/realtime.ts       SignalR 实时通道 /hub/message
    src/theme.ts          品牌色、状态色、antd 基础主题
    src/ui/               共用界面：登录页、SessionGate、useRealtime
    vite.js               两端共用的 vite 配置（含浏览器调试代理）
  apps/user/              用户端（端口 1430，com.igoodlife.radar.care）
  apps/ops/               运维端（端口 1420，com.igoodlife.radar.ops）
```

**原则**：只有两端都用得到的东西才放进 `core`。设备、日志、配置这类运维接口放在 `apps/ops/src/api/`，不要放进 core。

## 常用命令（在 client/ 下执行）

完整的运行、调试、打包说明见 [运行与调试.md](运行与调试.md)。

```bash
npm install
npm run user          # 启动用户端桌面客户端
npm run ops           # 启动运维端桌面客户端
npm run web:user      # 只启动用户端前端，在浏览器里调试（http://localhost:1430）
npm run web:ops       # 同上，运维端（http://localhost:1420）
npm run build:user    # 打用户端安装包
npm run build:ops     # 打运维端安装包
```

- 两个客户端的端口不同，可以同时运行。
- 浏览器调试时，请求经过 vite 的 `/__proxy` 转发到 rd.igoodlife.com，登录页上的服务器选项不起作用。

## 环境要求

- Node 22+
- Rust（MSVC 工具链）
- VS 2022 的"使用 C++ 的桌面开发"（含 MSVC 生成工具和 Windows SDK）

**Windows 注意**：在 Git Bash 里 `cargo build` 会用错链接器（Git 自带的 `/usr/bin/link.exe` 会挡住 MSVC 的链接器），请在 PowerShell 或 cmd 里编译。

## 为什么不受跨域限制

平台接口没有返回 CORS 响应头，普通网页跨域调用会被浏览器拦截。客户端的请求通过 `@tauri-apps/plugin-http` 从 Rust 层发出，不经过 WebView，所以不受 CORS 限制。可以访问的域名在每个客户端的 `src-tauri/capabilities/default.json` 里配置。

## 待确认

- 用户端的角色按**权限能力**判断，不看角色名，规则见 `apps/user/src/roles.ts`：管理者 = 超管、机构管理员或有用户 / 角色管理权限；护理值守 = 有实时监测或告警权限。两种都满足的账号默认进管理者概览，可以在右上角切换视图。**家属**暂时不自动识别（平台上没有家属账号，见下）。开发模式下右上角有"开发预览"，可以查看所有角色的首页。
- 家属端的账号来源待定：平台账号里没有家属，家属很可能用的是手机 App / 小程序的账号体系。
- "我已到场"、家属留言等功能，平台上是否有对应接口，还需要确认。
