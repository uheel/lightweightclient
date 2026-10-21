import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { computeSteps, isSmallOrg, loadGuideData, type GuideData, type NavKey, type Step, type StepKey, type Target } from "./steps";

/**
 * 快速开始的状态：检查结果、抽屉开关、"下一步"提示条，以及从清单跳到页面时要选中的东西（focus）。
 * 按机构记在本机：不再自动弹出、上次完成了哪几步、是否全部完成（全部完成后侧栏入口收成帮助图标，进来也不再检查）。
 */

interface Saved {
  hidden?: boolean;
  done?: StepKey[];
  complete?: boolean;
}

const keyOf = (orgId: string) => `ops:guide:${orgId}`;
function readSaved(orgId: string): Saved {
  try {
    return JSON.parse(localStorage.getItem(keyOf(orgId)) ?? "{}") as Saved;
  } catch {
    return {};
  }
}
function writeSaved(orgId: string, s: Saved) {
  try {
    localStorage.setItem(keyOf(orgId), JSON.stringify(s));
  } catch {
    /* 存不了就只在本次生效 */
  }
}

/** 自动重新检查的最短间隔（切页面时触发） */
const AUTO_GAP_MS = 20_000;

export interface Focus extends Target {
  seq: number;
}

export interface Banner {
  done: Step;
  next?: Step;
}

interface GuideState {
  steps: Step[];
  /** 已完成几步（没检查过的步骤用上次记下的结果） */
  doneCount: number;
  complete: boolean;
  loading: boolean;
  progress?: { done: number; total: number };
  checkedAt?: number;
  error?: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  /** 清单开着但收成一条（只显示进度和下一步） */
  mini: boolean;
  setMini: (v: boolean) => void;
  hidden: boolean;
  setHidden: (v: boolean) => void;
  refresh: (force?: boolean) => void;
  go: (t: Target) => void;
  focus?: Focus;
  /** 已经被页面处理过的 focus.seq：记在这里而不是页面里，页面重新挂载时不会再处理一遍 */
  handled: { current: number };
  banner?: Banner;
  closeBanner: () => void;
}

const Ctx = createContext<GuideState | null>(null);

export function useGuide() {
  return useContext(Ctx);
}

/** 页面接收从清单跳过来的选中 / 新建请求 */
export function useGuideFocus(nav: NavKey, handle: (f: Focus) => void) {
  const g = useContext(Ctx);
  const f = g?.focus;
  const handled = g?.handled;
  const ref = useRef(handle);
  ref.current = handle;
  useEffect(() => {
    if (!f || !handled || f.nav !== nav || f.seq <= handled.current) return;
    handled.current = f.seq;
    ref.current(f);
  }, [f, handled, nav]);
}

export function GuideProvider({ orgId, nav, onNav, children }: { orgId: string; nav: NavKey; onNav: (k: NavKey) => void; children: ReactNode }) {
  const [saved, setSaved] = useState<Saved>(() => readSaved(orgId));
  const [data, setData] = useState<GuideData>();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [error, setError] = useState<string>();
  const [open, setOpenState] = useState(false);
  const [mini, setMini] = useState(false);
  const [focus, setFocus] = useState<Focus>();
  const handled = useRef(0);
  const [banner, setBanner] = useState<Banner>();
  const running = useRef(false);
  const lastAt = useRef(0);
  const openRef = useRef(false);
  const prevDone = useRef<Set<StepKey> | undefined>(undefined);

  const save = useCallback(
    (patch: Saved) =>
      setSaved((s) => {
        const next = { ...s, ...patch };
        writeSaved(orgId, next);
        return next;
      }),
    [orgId],
  );

  const steps = useMemo(() => (data ? computeSteps(data) : []), [data]);

  const run = useCallback(
    async (force: boolean) => {
      if (running.current) return;
      if (!force && Date.now() - lastAt.current < AUTO_GAP_MS) return;
      running.current = true;
      lastAt.current = Date.now();
      setLoading(true);
      setError(undefined);
      try {
        const d = await loadGuideData(
          (x) => openRef.current || isSmallOrg(x),
          (done, total) => setProgress({ done, total }),
        );
        setData(d);
        // 新机构（没有房间也没有雷达）第一次进来自动打开清单
        if (!prevDone.current && !d.rooms.length && !d.radars.length && !readSaved(orgId).hidden) {
          openRef.current = true;
          setOpenState(true);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        running.current = false;
        setLoading(false);
        setProgress(undefined);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgId],
  );

  // 检查结果出来后：记下完成情况；有步骤刚变成完成时出"下一步"提示条
  useEffect(() => {
    if (!steps.length) return;
    const known = steps.filter((s) => s.status !== "unknown");
    const done = new Set(known.filter((s) => s.status === "done").map((s) => s.key));
    const prev = prevDone.current;
    if (prev) {
      const fresh = steps.find((s) => done.has(s.key) && !prev.has(s.key));
      if (fresh && !saved.hidden && !openRef.current) setBanner({ done: fresh, next: steps.find((s) => s.status !== "done") });
    }
    // 没检查到的步骤沿用上次的结果
    const merged = new Set([...done, ...(saved.done ?? []).filter((k) => !known.some((s) => s.key === k))]);
    prevDone.current = merged;
    const complete = known.length === steps.length && done.size === steps.length;
    save({ done: [...merged], complete });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  const setOpen = useCallback(
    (v: boolean) => {
      openRef.current = v;
      setOpenState(v);
      if (v) setMini(false);
      // 打开时做完整检查（大机构平时只做轻量检查）
      if (v) run(!data?.heavy || Date.now() - lastAt.current > AUTO_GAP_MS);
    },
    [run, data],
  );

  // 进来时检查一次；已经全部完成的机构不检查，等打开清单
  useEffect(() => {
    if (!readSaved(orgId).complete) run(true);
  }, [orgId, run]);

  // 切页面时重新检查（有间隔限制），这样在页面上做完操作回来，清单和提示条是新的
  const firstNav = useRef(true);
  useEffect(() => {
    if (firstNav.current) {
      firstNav.current = false;
      return;
    }
    // 提示条只针对刚才那一页的操作，换页面就收掉
    setBanner(undefined);
    if (openRef.current || !saved.complete) run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav]);

  const go = useCallback(
    (t: Target) => {
      onNav(t.nav);
      setBanner(undefined);
      if (t.id || t.action) setFocus((f) => ({ ...t, seq: (f?.seq ?? 0) + 1 }));
    },
    [onNav],
  );

  const doneCount = useMemo(() => {
    if (!steps.length) return saved.done?.length ?? 0;
    return steps.filter((s) => (s.status === "unknown" ? saved.done?.includes(s.key) : s.status === "done")).length;
  }, [steps, saved.done]);

  const value: GuideState = {
    steps,
    doneCount,
    complete: !!saved.complete,
    loading,
    progress,
    checkedAt: data?.heavy?.at,
    error,
    open,
    setOpen,
    mini,
    setMini,
    hidden: !!saved.hidden,
    setHidden: (v) => save({ hidden: v }),
    refresh: (force) => run(!!force),
    go,
    focus,
    handled,
    banner,
    closeBanner: () => setBanner(undefined),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
