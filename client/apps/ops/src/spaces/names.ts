/** 楼宇页的命名规则：批量建房、建楼层、建床位时生成名字，全部在本地算 */

const byName = (a: string, b: string) => a.localeCompare(b, "zh-CN", { numeric: true });
export { byName };

/**
 * 展开房间名："301-310, 312 活动室" → 301…310、312、活动室。
 * 范围两头可以带前后缀（"A301-305室"），起始号有前导零时按它的位数补零（"01-12"）。
 * 反向范围（"101-1"）当普通名字处理；单个范围最多 max 个。
 */
export function expandNames(input: string, max = 200): string[] {
  const out: string[] = [];
  for (const tok of input.split(/[,，、;；\s]+/).filter(Boolean)) {
    const m = tok.match(/^(.*?)(\d+)[-~～](\d+)(\D*)$/);
    const a = m ? Number(m[2]) : NaN;
    const b = m ? Number(m[3]) : NaN;
    if (m && b >= a && b - a < max) {
      const pad = m[2]!.startsWith("0") ? m[2]!.length : 0;
      for (let n = a; n <= b; n++) out.push(`${m[1]}${String(n).padStart(pad, "0")}${m[4]}`);
    } else out.push(tok);
  }
  return [...new Set(out)];
}

export type FloorFormat = "F" | "层" | "楼";

export const FLOOR_FORMATS: { value: FloorFormat; label: string }[] = [
  { value: "F", label: "1F" },
  { value: "层", label: "1层" },
  { value: "楼", label: "1楼" },
];

/** 楼层名：地下层写成 B1、B2 */
export function floorLabel(n: number, f: FloorFormat) {
  return n < 0 ? `B${-n}` : `${n}${f}`;
}

/** 床位名：房间名-序号床，例如 301-1床 */
export function bedLabel(room: string, n: number) {
  return `${room}-${n}床`;
}

/** 房间里下一张床的名字（跳过已有的） */
export function nextBedName(room: string, existing: string[]) {
  const have = new Set(existing);
  let n = existing.length + 1;
  while (have.has(bedLabel(room, n))) n++;
  return bedLabel(room, n);
}

/** 楼层的默认房号范围：3 层 → 301-310 */
export function defaultRoomRange(floorNumber?: number) {
  const f = floorNumber && floorNumber > 0 ? floorNumber : 1;
  return `${f}01-${f}10`;
}
