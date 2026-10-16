import { invoke } from "@tauri-apps/api/core";

/**
 * 耗时埋点：打印到控制台，Tauri 里同时打印到 tauri dev 的终端（Rust 命令 perf_log，只在调试构建里输出）。
 * 全部记录也放在 window.__perf 里，控制台里可以 console.table(__perf) 查看。
 */
export interface PerfRecord {
  label: string;
  total: number;
  stages: Record<string, number>;
  info?: Record<string, string | number | boolean>;
  at: number;
}

const records: PerfRecord[] = [];
(window as unknown as { __perf: PerfRecord[] }).__perf = records;

const r1 = (n: number) => Math.round(n * 10) / 10;

export function formatBytes(n: number) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(2)}MB` : n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`;
}

export function perfLog(rec: Omit<PerfRecord, "at">) {
  const r = { ...rec, total: r1(rec.total), stages: Object.fromEntries(Object.entries(rec.stages).map(([k, v]) => [k, r1(v)])), at: Date.now() };
  records.push(r);
  if (records.length > 2000) records.splice(0, records.length - 2000);
  const parts = [`[perf] ${r.label}`, `total=${r.total}ms`, ...Object.entries(r.stages).map(([k, v]) => `${k}=${v}`), ...Object.entries(r.info ?? {}).map(([k, v]) => `${k}=${v}`)];
  const line = parts.join(" ");
  console.info(line);
  if ("__TAURI_INTERNALS__" in window) invoke("perf_log", { line }).catch(() => {});
}

/** 分阶段计时：lap(name) 记下距上一次 lap 的耗时，end() 输出一条记录 */
export function perfTimer(label: string) {
  const t0 = performance.now();
  let last = t0;
  const stages: Record<string, number> = {};
  const info: Record<string, string | number | boolean> = {};
  return {
    lap(name: string) {
      const now = performance.now();
      stages[name] = (stages[name] ?? 0) + now - last;
      last = now;
    },
    /** 把一段已知耗时累加到某个阶段（例如每页请求的拆分耗时），不影响 lap 的起点 */
    add(name: string, ms: number) {
      stages[name] = (stages[name] ?? 0) + ms;
    },
    info(k: string, v: string | number | boolean) {
      info[k] = v;
    },
    end() {
      perfLog({ label, total: performance.now() - t0, stages, info });
    },
    /** 等界面画完下一帧再记 render 阶段并输出 */
    endAfterPaint(name = "render") {
      requestAnimationFrame(() =>
        setTimeout(() => {
          this.lap(name);
          this.end();
        }),
      );
    },
  };
}

export type PerfTimer = ReturnType<typeof perfTimer>;
