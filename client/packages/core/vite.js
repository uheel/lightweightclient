// 两个客户端共用的 vite 配置。
// 用纯 JS 写：vite 加载配置时会把 workspace 包当作外部模块交给 Node 直接执行，不会编译 .ts。
import https from "node:https";
import react from "@vitejs/plugin-react";

// 代理复用到平台的连接：每个请求新建 TLS 连接时，网络丢包会让握手卡住数秒到数十秒
const keepAlive = new https.Agent({ keepAlive: true, maxSockets: 8 });

/**
 * 每个客户端用自己的固定端口（Tauri 要求），HMR 端口为 port + 1。
 * @param {number} port
 * @returns {import("vite").UserConfig}
 */
export function createViteConfig(port) {
  const host = process.env.TAURI_DEV_HOST;
  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      port,
      strictPort: true,
      host: host || false,
      hmr: host ? { protocol: "ws", host, port: port + 1 } : undefined,
      // 浏览器调试用：普通浏览器受 CORS 限制，经 vite 转发到平台（Tauri 里不走这里）
      proxy: {
        "/__proxy": {
          target: "https://rd.igoodlife.com",
          changeOrigin: true,
          agent: keepAlive,
          ws: true,
          rewrite: (p) => p.replace(/^\/__proxy/, ""),
        },
      },
      watch: { ignored: ["**/src-tauri/**"] },
    },
  };
}
