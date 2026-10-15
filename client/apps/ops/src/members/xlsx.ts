/**
 * 最小的 xlsx 读写（不引第三方库）：
 * - 读：解 zip（deflate 用浏览器自带的 DecompressionStream），取第一个工作表，单元格一律按文本返回
 * - 写：zip 不压缩（store），单元格写成 inlineStr，可把整列设成"文本"格式，避免 Excel 把手机号、证件号转成科学计数
 */

// ---------- 读 ----------

const td = new TextDecoder();

async function inflateRaw(data: Uint8Array) {
  const ds = new DecompressionStream("deflate-raw");
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** 解 zip，返回 文件名 → 解压函数 */
function unzip(buf: Uint8Array) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 xlsx 文件");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map<string, () => Promise<Uint8Array>>();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    files.set(name, () => (method === 0 ? Promise.resolve(data) : inflateRaw(data)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const parseXml = (s: string) => new DOMParser().parseFromString(s, "application/xml");
/** 按本地名取元素（忽略命名空间前缀） */
const byTag = (root: Document | Element, tag: string) => Array.from(root.getElementsByTagNameNS("*", tag));

/** "AB12" → 列序号 27（从 0 开始） */
function colIndex(ref: string) {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** 读 xlsx 第一个工作表，返回二维文本数组 */
export async function readXlsx(file: Blob): Promise<string[][]> {
  const files = unzip(new Uint8Array(await file.arrayBuffer()));
  const text = async (name: string) => {
    const f = files.get(name);
    return f ? td.decode(await f()) : undefined;
  };

  // 第一个工作表的路径
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = await text("xl/workbook.xml");
  const rels = await text("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const first = byTag(parseXml(wb), "sheet")[0];
    const rid = first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? first?.getAttribute("r:id");
    const rel = byTag(parseXml(rels), "Relationship").find((r) => r.getAttribute("Id") === rid);
    const target = rel?.getAttribute("Target");
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  }

  const ssXml = await text("xl/sharedStrings.xml");
  const shared = ssXml ? byTag(parseXml(ssXml), "si").map((si) => byTag(si, "t").map((t) => t.textContent ?? "").join("")) : [];

  const sheetXml = await text(sheetPath);
  if (!sheetXml) throw new Error("文件里没有工作表");
  const rows: string[][] = [];
  for (const row of byTag(parseXml(sheetXml), "row")) {
    const r = Number(row.getAttribute("r") ?? rows.length + 1) - 1;
    const out: string[] = [];
    let next = 0;
    for (const c of byTag(row, "c")) {
      const ref = c.getAttribute("r");
      const i = ref ? colIndex(ref) : next;
      next = i + 1;
      const t = c.getAttribute("t");
      const v = byTag(c, "v")[0]?.textContent ?? "";
      out[i] =
        t === "s" ? shared[Number(v)] ?? "" : t === "inlineStr" ? byTag(c, "t").map((x) => x.textContent ?? "").join("") : t === "b" ? (v === "1" ? "TRUE" : "FALSE") : v;
    }
    rows[r] = Array.from(out, (x) => (x ?? "").trim());
  }
  return Array.from(rows, (r) => r ?? []);
}

/** 读 CSV：先按 UTF-8 解，出现乱码再按 GBK（中文版 Excel 另存的 CSV 默认是 GBK） */
export async function readCsv(file: Blob): Promise<string[][]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = new TextDecoder("utf-8").decode(buf);
  if (s.includes("�")) s = new TextDecoder("gbk").decode(buf);
  s = s.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

export function readTable(file: File) {
  return /\.csv$/i.test(file.name) ? readCsv(file) : readXlsx(file);
}

// ---------- 写 ----------

const te = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array) {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 不压缩的 zip */
function zip(entries: [string, string][]) {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nb = te.encode(name);
    const data = te.encode(content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nb.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // 文件名 UTF-8
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nb.length, true);
    local.set(nb, 30);
    const cen = new Uint8Array(46 + nb.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nb.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nb, 46);
    parts.push(local, data);
    central.push(cen);
    offset += local.length + data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end] as BlobPart[], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export interface SheetSpec {
  name: string;
  rows: string[][];
  /** 列宽（字符数） */
  widths?: number[];
  /** 首行加粗、冻结 */
  header?: boolean;
  /** 整列设为文本格式 */
  textColumns?: boolean;
  /** 灰色斜体显示的行（例如示例行），行号从 0 开始 */
  mutedRows?: number[];
  /** 单元格自动换行、顶端对齐 */
  wrap?: boolean;
  /** 隐藏这个工作表（例如放下拉选项的表） */
  hidden?: boolean;
  /** 下拉选择 */
  dropdowns?: Dropdown[];
}

export interface Dropdown {
  /** 列序号，从 0 开始 */
  col: number;
  /** 作用的行范围（从 0 开始，含两端） */
  rows: [number, number];
  /** 选项来源，例如 '选项'!$A$2:$A$7 */
  source: string;
  /** true：只能从列表里选；false：列表只是提示，也可以手动填写 */
  strict: boolean;
  title?: string;
  message?: string;
}

/** 某表某列第 2 行起 n 个单元格的引用，用作下拉来源 */
export const rangeRef = (sheet: string, col: number, n: number) => `'${sheet.replace(/'/g, "''")}'!$${colName(col)}$2:$${colName(col)}$${Math.max(2, n + 1)}`;

/** 样式：0 默认，1 文本，2 加粗表头，3 灰色斜体（示例行），4 自动换行 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="等线"/></font><font><b/><sz val="11"/><name val="等线"/></font><font><i/><sz val="11"/><color rgb="FF8A8FA8"/><name val="等线"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF1FF"/></patternFill></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/><xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(s: SheetSpec) {
  const ncol = Math.max(1, ...s.rows.map((r) => r.length), s.widths?.length ?? 0);
  const cols = Array.from({ length: ncol }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${s.widths?.[i] ?? 14}"${s.textColumns ? ' style="1"' : ""} customWidth="1"/>`).join("");
  const rows = s.rows
    .map((r, ri) => {
      const st = s.header && ri === 0 ? 2 : s.mutedRows?.includes(ri) ? 3 : s.wrap ? 4 : s.textColumns ? 1 : 0;
      const cells = r.map((v, ci) => (v === "" ? "" : `<c r="${colName(ci)}${ri + 1}" t="inlineStr" s="${st}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`)).join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  const freeze = s.header ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}<cols>${cols}</cols><sheetData>${rows}</sheetData>${dropdownXml(s.dropdowns)}</worksheet>`;
}

function dropdownXml(list?: Dropdown[]) {
  if (!list?.length) return "";
  const items = list.map((d) => {
    const ref = `${colName(d.col)}${d.rows[0] + 1}:${colName(d.col)}${d.rows[1] + 1}`;
    const msg = d.message ? ` promptTitle="${esc(d.title ?? "")}" prompt="${esc(d.message)}"` : "";
    const err = d.strict ? ` errorStyle="stop" errorTitle="${esc(d.title ?? "填写有误")}" error="请从下拉列表里选择"` : "";
    return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="${d.strict ? 1 : 0}"${err}${msg} sqref="${ref}"><formula1>${esc(d.source)}</formula1></dataValidation>`;
  });
  return `<dataValidations count="${items.length}">${items.join("")}</dataValidations>`;
}

/** 生成 xlsx */
export function writeXlsx(sheets: SheetSpec[]) {
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("")}</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`)
    .join("")}</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return zip([
    ["[Content_Types].xml", ct],
    ["_rels/.rels", rootRels],
    ["xl/workbook.xml", wb],
    ["xl/_rels/workbook.xml.rels", wbRels],
    ["xl/styles.xml", STYLES],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)] as [string, string]),
  ]);
}

/** 让浏览器 / 客户端下载一个 Blob */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
