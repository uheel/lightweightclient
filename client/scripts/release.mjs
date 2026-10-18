#!/usr/bin/env node
/**
 * 发布客户端新版本到 Cloudflare R2，已装的客户端会在菜单里看到"发现新版本"。
 *
 *   node scripts/release.mjs <ops|user> <版本号|patch|minor> [--notes "更新说明"] [--dry-run]
 *
 * 做的事：
 *   1. 改版本号（tauri.conf.json / Cargo.toml / package.json）
 *   2. 打 NSIS 安装包并用更新私钥签名（只在这里打开 createUpdaterArtifacts，平时 tauri build 不需要私钥）
 *   3. 上传安装包到 R2：<前缀>/<版本>/<安装包>，最后再上传 <前缀>/latest.json（先传包再换清单，客户端不会拿到半成品）
 *
 * 前缀和公开地址取自 tauri.conf.json 的 plugins.updater.endpoints，例如
 *   https://update.xxx.com/radar/ops/latest.json → 前缀 radar/ops，安装包地址 https://update.xxx.com/radar/ops/0.1.2/xxx-setup.exe
 *
 * 需要：
 *   - 更新私钥：默认 ~/.tauri/radar-updater.key（也可设 TAURI_SIGNING_PRIVATE_KEY_PATH；有密码时设 TAURI_SIGNING_PRIVATE_KEY_PASSWORD）
 *   - R2 桶名：环境变量 R2_BUCKET，或 scripts/release.config.json 的 bucket
 *   - wrangler 已登录（npx wrangler login），或设了 CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const dryRun = args.includes("--dry-run") && !!args.splice(args.indexOf("--dry-run"), 1);
const notes = flag("--notes") ?? "";
const [app, want] = args;

if (!["ops", "user"].includes(app) || !want) {
  console.error('用法：node scripts/release.mjs <ops|user> <版本号|patch|minor> [--notes "更新说明"] [--dry-run]');
  process.exit(1);
}

const appDir = join(root, "apps", app);
const confPath = join(appDir, "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));

// ---- 版本号 ----
const cur = conf.version;
const [ma, mi, pa] = cur.split(".").map(Number);
const version = want === "patch" ? `${ma}.${mi}.${pa + 1}` : want === "minor" ? `${ma}.${mi + 1}.0` : want;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`版本号格式不对：${version}`);
const newer = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
if (!newer(version, cur)) throw new Error(`新版本 ${version} 必须大于当前版本 ${cur}（客户端只会升级到更大的版本号）`);

// ---- 更新源 ----
const endpoint = conf.plugins?.updater?.endpoints?.[0];
if (!endpoint) throw new Error("tauri.conf.json 里没有 plugins.updater.endpoints");
const url = new URL(endpoint);
if (url.hostname.endsWith("example.com")) throw new Error(`更新地址还是占位符：${endpoint}，先改成绑定到 R2 的域名（两个客户端的 tauri.conf.json 都要改）`);
const publicBase = endpoint.replace(/\/latest\.json$/, "");
const prefix = url.pathname.replace(/^\//, "").replace(/\/latest\.json$/, "");

const cfgPath = join(root, "scripts", "release.config.json");
const bucket = process.env.R2_BUCKET ?? (existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")).bucket : undefined);
if (!bucket && !dryRun) throw new Error("没有 R2 桶名：设环境变量 R2_BUCKET，或写在 scripts/release.config.json 的 bucket");

const keyPath = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH ?? join(homedir(), ".tauri", "radar-updater.key");
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !existsSync(keyPath)) throw new Error(`找不到更新私钥：${keyPath}`);

// ---- 1. 改版本号（只替换版本那一行，不重排文件格式）----
const bump = (file, re) => {
  const s = readFileSync(file, "utf8");
  if (!re.test(s)) throw new Error(`没在 ${file} 里找到版本号`);
  writeFileSync(file, s.replace(re, (_m, a, _v, b) => `${a}${version}${b}`));
};
bump(confPath, /("version":\s*")([^"]+)(")/);
bump(join(appDir, "package.json"), /("version":\s*")([^"]+)(")/);
bump(join(appDir, "src-tauri", "Cargo.toml"), /(^version\s*=\s*")([^"]+)(")/m);
console.log(`版本 ${cur} → ${version}`);

// ---- 2. 打包 + 签名 ----
const sh = (cmd, cmdArgs, opts = {}) => execFileSync(cmd, cmdArgs, { stdio: "inherit", shell: process.platform === "win32", ...opts });
const env = {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: process.env.TAURI_SIGNING_PRIVATE_KEY ?? readFileSync(keyPath, "utf8"),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
};
const override = join(tmpdir(), `radar-release-${app}.json`);
writeFileSync(override, JSON.stringify({ bundle: { createUpdaterArtifacts: true } }));
sh("npx", ["tauri", "build", "--bundles", "nsis", "--config", override], { cwd: appDir, env });

// 两个客户端共用 client/target（Cargo workspace）
const nsisDir = join(root, "target", "release", "bundle", "nsis");
const exeName = `${conf.productName}_${version}_x64-setup.exe`;
const exe = join(nsisDir, exeName);
const sig = `${exe}.sig`;
if (!existsSync(exe) || !existsSync(sig)) throw new Error(`没找到安装包或签名：${exe}(.sig)`);

const latest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": { signature: readFileSync(sig, "utf8").trim(), url: `${publicBase}/${version}/${exeName}` },
  },
};
const outDir = join(root, "target", "release", "updater", app);
mkdirSync(outDir, { recursive: true });
const latestPath = join(outDir, "latest.json");
writeFileSync(latestPath, JSON.stringify(latest, null, 2));
console.log(`\n安装包：${exe}\n清单：${latestPath}`);

// ---- 3. 上传 ----
const put = (key, file, extra) => sh("npx", ["wrangler@4", "r2", "object", "put", `${bucket}/${key}`, "--file", file, "--remote", ...extra]);
if (dryRun) {
  console.log(`\n--dry-run：没有上传。将上传到 ${bucket}/${prefix}/${version}/${exeName} 和 ${bucket}/${prefix}/latest.json`);
} else {
  put(`${prefix}/${version}/${exeName}`, exe, ["--content-type", "application/octet-stream"]);
  // 清单不能被 CDN 缓存，否则客户端要很久才看到新版本
  put(`${prefix}/latest.json`, latestPath, ["--content-type", "application/json", "--cache-control", "no-cache"]);
  console.log(`\n已发布 ${app} v${version}：${endpoint}`);
}
