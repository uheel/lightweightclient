/**
 * 从快速开始跳过来后，把要改的那一项滚到可见处并闪两下。
 * 页签、属性分组可能还在加载，所以等元素出现（最多 timeout 毫秒）；selectors 按顺序取第一个找得到的。返回取消函数。
 */
export function flashSpot(selectors: string[], timeout = 8000): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const t0 = Date.now();
  const tick = () => {
    if (stopped) return;
    const el = selectors.map((s) => document.querySelector<HTMLElement>(s)).find(Boolean);
    if (!el) {
      if (Date.now() - t0 < timeout) timer = setTimeout(tick, 120);
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("spot-flash");
    void el.offsetWidth; // 重新触发动画
    el.classList.add("spot-flash");
    el.addEventListener("animationend", () => el.classList.remove("spot-flash"), { once: true });
  };
  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
