import dayjs from "dayjs";
import type { Bed, CodeOption, MemberHit, NewMember } from "../api/member";
import { rangeRef, type Dropdown, type SheetSpec } from "./xlsx";

/** 批量导入长者：模板列、逐行校验、匹配床位 */

export interface Column {
  key: keyof Fields;
  title: string;
  required?: boolean;
  /** 表头的其他写法 */
  alias?: string[];
  width?: number;
  /** 填写格式说明（写进模板的"填写说明"页） */
  format: string;
  /** 示例值（模板里的示例行）；床位相关几列用机构里实际的空床位 */
  example?: string;
}

interface Fields {
  realName: string;
  phoneNumber: string;
  gender: string;
  age: string;
  birthDate: string;
  idType: string;
  idNumber: string;
  memberType: string;
  height: string;
  weight: string;
  building: string;
  floor: string;
  room: string;
  bed: string;
  checkInDate: string;
  address: string;
}

/** 示例行的姓名以此开头，导入时跳过 */
export const EXAMPLE_PREFIX = "示例";

export const COLUMNS: Column[] = [
  {
    key: "realName",
    title: "姓名",
    required: true,
    alias: ["用户姓名", "长者姓名", "名字"],
    width: 12,
    format: `文字，最多 32 个字。以"${EXAMPLE_PREFIX}"开头的行是示例，导入时自动跳过`,
    example: `${EXAMPLE_PREFIX}-张秀英`,
  },
  {
    key: "phoneNumber",
    title: "手机号",
    required: true,
    alias: ["手机", "电话", "联系电话", "手机号码"],
    width: 14,
    format: "11 位手机号，只填数字（中间的空格、短横线会自动去掉）。平台按手机号识别长者：同一手机号在表里只能出现一次；已登记过的手机号不会重复建档，也不会修改原有资料",
    example: "13812345678",
  },
  { key: "gender", title: "性别", required: true, width: 6, format: "下拉选择 男 / 女。空着时按身份证号推算，推算不出就报错", example: "女" },
  { key: "age", title: "年龄", required: true, width: 6, format: "1–199 的整数，不带\"岁\"。空着时按出生日期（或身份证号）推算，推算不出就报错", example: "81" },
  {
    key: "birthDate",
    title: "出生日期",
    alias: ["生日", "出生年月"],
    width: 12,
    format: "年-月-日，例如 1945-03-08；也可以写 1945/3/8、1945年3月8日、19450308，或用 Excel 的日期格式。不填时按身份证号推算",
    example: "1945-03-08",
  },
  { key: "idType", title: "证件类型", width: 10, format: "下拉选择，只能选列表里的值。填了证件号码但不填类型时按身份证处理", example: "身份证" },
  {
    key: "idNumber",
    title: "证件号码",
    alias: ["身份证号", "身份证号码", "身份证"],
    width: 21,
    format: "身份证为 18 位，最后一位可以是 X，导入时会核对校验位。这一列已设为文本格式，请不要改成数字格式，否则 Excel 会把号码变成科学计数（如 1.10101E+17）",
    example: "110101194503081224",
  },
  { key: "memberType", title: "老人分类", alias: ["分类"], width: 10, format: "下拉选择，只能选列表里的值（与平台\"老人分类\"选项一致）", example: "慢性病" },
  { key: "height", title: "身高", required: true, alias: ["身高(cm)", "身高cm"], width: 7, format: "单位厘米，只填数字（50–250）", example: "158" },
  { key: "weight", title: "体重", required: true, alias: ["体重(kg)", "体重kg"], width: 7, format: "单位公斤，只填数字（10–300）", example: "52" },
  {
    key: "building",
    title: "楼栋",
    alias: ["楼宇", "楼"],
    width: 12,
    format: "需要同时办理入住时才填楼栋、楼层、房间、床位。可以下拉选择（列表来自当前空床位），也可以手动填写，名称与平台一致即可，可对照\"空床位\"页。四项里床位必填，其余能唯一确定床位即可",
  },
  { key: "floor", title: "楼层", alias: ["层"], width: 8, format: "例如 3层，也可以只写 3" },
  { key: "room", title: "房间", alias: ["房间号", "房号"], width: 14, format: "与平台房间名一致，例如 301房间；只写 301 也能匹配到\"301房间\"\"301室\"" },
  {
    key: "bed",
    title: "床位",
    alias: ["床位号", "床号"],
    width: 16,
    format: "与平台床位名一致。床位名带房间号前缀时（如\"301房间-1床\"），填了房间后可以只写后半段\"1床\"。已有人入住的床位、表里重复的床位会报错",
  },
  { key: "checkInDate", title: "入住日期", alias: ["入住时间"], width: 12, format: "格式同出生日期。不填默认为导入当天" },
  { key: "address", title: "居住地址", alias: ["地址", "居住地详细地址"], width: 26, format: "文字，最多 128 个字", example: "XX市XX区XX路1号" },
];

export const headerTitle = (c: Column) => (c.required ? `${c.title}*` : c.title);

const norm = (s: string) =>
  s
    .replace(/[\s*＊（）()]/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase();

/** 表头行 → 每列对应的字段；返回缺少的必填列 */
export function mapHeader(header: string[]) {
  const cols = new Map<number, keyof Fields>();
  header.forEach((h, i) => {
    const n = norm(h ?? "");
    if (!n) return;
    const c = COLUMNS.find((c) => norm(c.title) === n || c.alias?.some((a) => norm(a) === n));
    if (c && ![...cols.values()].includes(c.key)) cols.set(i, c.key);
  });
  const missing = COLUMNS.filter((c) => c.required && ![...cols.values()].includes(c.key)).map((c) => c.title);
  return { cols, missing };
}

// ---------- 单元格解析 ----------

/** 日期：Excel 序列号或 2024-1-2 / 2024/1/2 / 2024年1月2日 / 20240102 */
function parseDate(s: string) {
  if (!s) return undefined;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = dayjs("1899-12-30").add(Math.floor(Number(s)), "day");
    return d.isValid() ? d : undefined;
  }
  const m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/) ?? s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return undefined;
  const d = dayjs(`${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`);
  return d.isValid() && d.format("YYYY-MM-DD") === `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}` ? d : undefined;
}

/** 18 位身份证：校验码，返回出生日期、性别 */
function parseIdCard(id: string) {
  if (!/^\d{17}[\dX]$/.test(id)) return undefined;
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const sum = w.reduce((n, k, i) => n + k * Number(id[i]), 0);
  if ("10X98765432"[sum % 11] !== id[17]) return undefined;
  const birth = parseDate(id.slice(6, 14));
  if (!birth) return undefined;
  return { birth, gender: Number(id[16]) % 2 === 1 ? 1 : 2 };
}

const optionValue = (opts: CodeOption[], s: string) => opts.find((o) => norm(o.label) === norm(s) || o.value === s)?.value;

// ---------- 床位匹配 ----------

const place = (s: string) => norm(s).replace(/(层|楼|f)$/, "");
const roomKey = (s: string) => norm(s).replace(/(房间|房|室|号)$/, "");

export const bedPath = (b: Bed) => [b.building, b.floor, b.roomName, b.bedName].join(" / ");

function matchBed(beds: Bed[], f: Pick<Fields, "building" | "floor" | "room" | "bed">) {
  let list = beds;
  if (f.building) list = list.filter((b) => norm(b.building) === norm(f.building) || place(b.building) === place(f.building));
  if (f.floor) list = list.filter((b) => place(b.floor) === place(f.floor));
  if (f.room) list = list.filter((b) => roomKey(b.roomName) === roomKey(f.room));
  const exact = list.filter((b) => norm(b.bedName) === norm(f.bed));
  // 床位名常带房间号前缀（如"101房间-1床"），填"1床"也认
  const hits = exact.length ? exact : list.filter((b) => norm(b.bedName).endsWith(norm(f.bed)));
  return hits;
}

// ---------- 逐行校验 ----------

export interface ImportRow {
  /** Excel 里的行号 */
  line: number;
  raw: Fields;
  data?: NewMember;
  bed?: Bed;
  checkInDate?: string;
  errors: string[];
  warnings: string[];
  /** 当前机构里已有这个手机号的长者 */
  existing?: MemberHit;
}

export interface Dicts {
  idTypes: CodeOption[];
  memberTypes: CodeOption[];
  beds: Bed[];
}

/** 解析整张表（第一行为表头）。existing 之后按手机号单独查 */
export function parseRows(table: string[][], dicts: Dicts) {
  const header = table[0] ?? [];
  const { cols, missing } = mapHeader(header);
  if (missing.length) return { rows: [] as ImportRow[], error: `缺少必填列：${missing.join("、")}（第一行必须是表头，可以用"下载模板"里的格式）` };

  const rows: ImportRow[] = [];
  const phones = new Map<string, number>();
  const bedUsed = new Map<string, number>();
  const today = dayjs().format("YYYY-MM-DD");

  table.slice(1).forEach((cells, i) => {
    const raw = Object.fromEntries(COLUMNS.map((c) => [c.key, ""])) as unknown as Fields;
    cols.forEach((key, ci) => (raw[key] = (cells[ci] ?? "").trim()));
    if (!Object.values(raw).some(Boolean)) return; // 空行
    if (raw.realName.startsWith(EXAMPLE_PREFIX)) return; // 模板里的示例行
    const line = i + 2;
    const errors: string[] = [];
    const warnings: string[] = [];

    const realName = raw.realName;
    if (!realName) errors.push("姓名为空");
    else if (realName.length > 32) errors.push("姓名超过 32 个字");

    const phone = raw.phoneNumber.replace(/[\s-]/g, "");
    if (!phone) errors.push("手机号为空");
    else if (!/^\+?\d{5,20}$/.test(phone)) errors.push(`手机号格式不对：${raw.phoneNumber}`);
    else {
      if (!/^1\d{10}$/.test(phone)) warnings.push("手机号不是 11 位大陆号码，请确认");
      const prev = phones.get(phone);
      if (prev) errors.push(`手机号与第 ${prev} 行重复`);
      else phones.set(phone, line);
    }

    // 证件
    let idType: number | undefined;
    const idNumber = raw.idNumber.replace(/\s/g, "").toUpperCase();
    if (raw.idType) {
      const v = optionValue(dicts.idTypes, raw.idType);
      if (v) idType = Number(v);
      else errors.push(`证件类型"${raw.idType}"不在选项里（${dicts.idTypes.map((o) => o.label).join(" / ")}）`);
    } else if (idNumber) idType = 1;
    let fromId: ReturnType<typeof parseIdCard>;
    if (idNumber) {
      if (/E\+/i.test(raw.idNumber)) errors.push("证件号码被 Excel 转成了科学计数法，请把该列设为文本后重新填写");
      else if (idType === 1) {
        fromId = parseIdCard(idNumber);
        if (!fromId) errors.push(`身份证号不正确：${idNumber}`);
      }
      if (idNumber.length > 18) errors.push("证件号码超过 18 位");
    }

    // 性别
    let gender: number | undefined;
    if (raw.gender) {
      gender = /^(男|1|m|male)$/i.test(raw.gender) ? 1 : /^(女|2|f|female)$/i.test(raw.gender) ? 2 : undefined;
      if (!gender) errors.push(`性别"${raw.gender}"无法识别（填 男 / 女）`);
      else if (fromId && fromId.gender !== gender) warnings.push("性别与身份证号不一致，以表里填写的为准");
    } else {
      gender = fromId?.gender;
      if (!gender) errors.push("性别为空（也没有能推算性别的身份证号）");
    }

    // 出生日期、年龄
    let birth = raw.birthDate ? parseDate(raw.birthDate) : fromId?.birth;
    if (raw.birthDate && !birth) {
      errors.push(`出生日期"${raw.birthDate}"无法识别（例如 1945-03-08）`);
      birth = undefined;
    } else if (birth && (birth.isAfter(dayjs()) || birth.year() < 1890)) errors.push(`出生日期不合理：${birth.format("YYYY-MM-DD")}`);
    let age: number | undefined;
    if (raw.age) {
      age = Number(raw.age);
      if (!Number.isInteger(age) || age < 1 || age > 199) {
        errors.push(`年龄"${raw.age}"应为 1–199 的整数`);
        age = undefined;
      }
    } else if (birth) age = dayjs().diff(birth, "year");
    else errors.push("年龄为空（也没有能推算年龄的出生日期或身份证号）");

    // 老人分类
    let memberType: number | undefined;
    if (raw.memberType) {
      const v = optionValue(dicts.memberTypes, raw.memberType);
      if (v) memberType = Number(v);
      else errors.push(`老人分类"${raw.memberType}"不在选项里（${dicts.memberTypes.map((o) => o.label).join(" / ")}）`);
    }

    const num = (s: string, label: string, min: number, max: number) => {
      if (!s) return undefined;
      const n = Number(s.replace(/(cm|kg|公斤|厘米)$/i, ""));
      if (!Number.isFinite(n) || n < min || n > max) {
        errors.push(`${label}"${s}"应在 ${min}–${max} 之间`);
        return undefined;
      }
      return n;
    };
    const height = num(raw.height, "身高", 50, 250);
    const weight = num(raw.weight, "体重", 10, 300);
    if (!raw.height) errors.push("身高为空");
    if (!raw.weight) errors.push("体重为空");

    // 床位
    let bed: Bed | undefined;
    let checkInDate: string | undefined;
    const wantsBed = !!(raw.building || raw.floor || raw.room || raw.bed);
    if (wantsBed) {
      if (!raw.bed) errors.push("填了楼栋 / 楼层 / 房间，但床位为空");
      else {
        const hits = matchBed(dicts.beds, raw);
        const where = [raw.building, raw.floor, raw.room, raw.bed].filter(Boolean).join(" / ");
        if (!hits.length) errors.push(`找不到床位：${where}`);
        else if (hits.length > 1) errors.push(`床位不唯一（${hits.length} 个匹配），请补充楼栋 / 楼层 / 房间：${where}`);
        else {
          bed = hits[0]!;
          if (bed.memberId) errors.push(`床位已有人入住：${bed.realName ?? ""}`);
          const prev = bedUsed.get(bed.bedId);
          if (prev) errors.push(`与第 ${prev} 行是同一个床位`);
          else bedUsed.set(bed.bedId, line);
        }
      }
      const d = raw.checkInDate ? parseDate(raw.checkInDate) : dayjs();
      if (!d) errors.push(`入住日期"${raw.checkInDate}"无法识别`);
      else checkInDate = d.format("YYYY-MM-DD");
    } else if (raw.checkInDate) warnings.push("填了入住日期但没有床位，只建档不入住");

    const data: NewMember = {
      realName,
      phoneNumber: phone,
      gender,
      age,
      birthDate: birth?.format("YYYY-MM-DD"),
      idType,
      idNumber: idNumber || undefined,
      memberType,
      height,
      weight,
      address: raw.address || undefined,
    };
    rows.push({ line, raw, data: errors.length ? undefined : data, bed, checkInDate: checkInDate ?? (bed ? today : undefined), errors, warnings });
  });
  return { rows, error: rows.length ? undefined : "表里没有数据行" };
}

/** 已有档案时的处理说明（预览时根据按手机号查到的结果补充） */
export function applyExisting(r: ImportRow, hit: MemberHit | undefined) {
  r.existing = hit;
  if (!hit) return;
  const sameName = hit.realName === r.raw.realName;
  r.warnings.push(
    sameName ? "已有档案（手机号相同），不会重复建档，也不会修改已有资料" : `手机号已登记为"${hit.realName}"，不会新建，也不会修改资料`,
  );
  if (r.bed && hit.checkType === 2) {
    r.warnings.push("这位长者已经入住，不再办理入住");
    r.bed = undefined;
  }
  if (r.bed && !sameName) {
    r.errors.push("姓名与已有档案不一致，为避免入住错人，请核对手机号");
    r.data = undefined;
  }
}

/** 下载模板：长者表（带一行示例）+ 填写说明 + 当前机构空床位 */
export function templateSheets(dicts: Dicts): SheetSpec[] {
  const free = dicts.beds.filter((b) => !b.memberId);
  // 示例行的床位用机构里实际的一个空床位，写法和平台一致
  const sample = free[0];
  const example: Record<string, string | undefined> = {
    building: sample?.building ?? "1号楼",
    floor: sample?.floor ?? "3层",
    room: sample?.roomName ?? "301房间",
    bed: sample?.bedName ?? "301房间-1床",
    checkInDate: dayjs().format("YYYY-MM-DD"),
  };
  const exampleRow = COLUMNS.map((c) => c.example ?? example[c.key] ?? "");

  // 下拉选项放在隐藏的"选项"表里：平台固定选项只能选，床位位置只作提示（也能手动填简写）
  const uniq = (list: string[]) => [...new Set(list.filter(Boolean))];
  type OptionList = { key: keyof Fields; values: string[]; strict: boolean };
  const lists = ([
    { key: "gender", values: ["男", "女"], strict: true },
    { key: "idType", values: dicts.idTypes.map((o) => o.label), strict: true },
    { key: "memberType", values: dicts.memberTypes.map((o) => o.label), strict: true },
    { key: "building", values: uniq(free.map((b) => b.building)), strict: false },
    { key: "floor", values: uniq(free.map((b) => b.floor)), strict: false },
    { key: "room", values: uniq(free.map((b) => b.roomName)), strict: false },
    { key: "bed", values: uniq(free.map((b) => b.bedName)), strict: false },
  ] as OptionList[]).filter((l) => l.values.length);
  const OPTIONS = "选项";
  const height = Math.max(0, ...lists.map((l) => l.values.length));
  const optionRows = [
    lists.map((l) => COLUMNS.find((c) => c.key === l.key)!.title),
    ...Array.from({ length: height }, (_, i) => lists.map((l) => l.values[i] ?? "")),
  ];
  const DATA_ROWS: [number, number] = [1, 2000];
  const dropdowns: Dropdown[] = lists.map((l, i) => ({
    col: COLUMNS.findIndex((c) => c.key === l.key),
    rows: DATA_ROWS,
    source: rangeRef(OPTIONS, i, l.values.length),
    strict: l.strict,
    title: COLUMNS.find((c) => c.key === l.key)!.title,
    message: l.strict ? "请从下拉列表里选择" : "可从下拉列表选择（当前空床位），也可以手动填写",
  }));

  const notes = [
    "第一行是表头，请不要修改或删除；列的顺序可以调整，不需要的选填列可以删掉",
    "只导入第一个工作表\"长者\"，每行一位长者，空行会跳过",
    `灰色的示例行（姓名以"${EXAMPLE_PREFIX}"开头）导入时会自动跳过，可以保留，也可以删掉`,
    "带 * 的列必填；其他列不知道可以空着",
    "性别、证件类型、老人分类只能从下拉列表里选；楼栋、楼层、房间、床位的下拉列表来自当前空床位，也可以手动填写",
    "手机号、证件号码请保持文本格式；从别的表格粘贴时用\"选择性粘贴 → 值\"，避免带入数字格式",
    "导入前会逐行检查并预览，有错误的行不会导入，改好后重新选择文件即可",
  ];
  return [
    {
      name: "长者",
      header: true,
      textColumns: true,
      rows: [COLUMNS.map(headerTitle), exampleRow],
      mutedRows: [1],
      widths: COLUMNS.map((c) => c.width ?? 12),
      dropdowns,
    },
    {
      name: "填写说明",
      header: true,
      wrap: true,
      widths: [12, 8, 70, 22],
      rows: [
        ["列", "是否必填", "填写格式", "示例"],
        ...COLUMNS.map((c) => [headerTitle(c), c.required ? "必填" : "选填", c.format, c.example ?? example[c.key] ?? ""]),
        ["", "", "", ""],
        ["证件类型可选", "", dicts.idTypes.map((o) => o.label).join(" / "), ""],
        ["老人分类可选", "", dicts.memberTypes.map((o) => o.label).join(" / "), ""],
        ["", "", "", ""],
        ["注意事项", "", notes.map((n, i) => `${i + 1}. ${n}`).join("\n"), ""],
      ],
    },
    {
      name: "空床位",
      header: true,
      widths: [16, 10, 16, 20],
      rows: [["楼栋", "楼层", "房间", "床位"], ...free.map((b) => [b.building, b.floor, b.roomName, b.bedName])],
    },
    { name: OPTIONS, hidden: true, header: true, rows: optionRows },
  ];
}
