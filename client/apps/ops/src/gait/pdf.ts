import { toCanvas } from "html-to-image";

/** A4 按屏幕 96dpi 的尺寸（CSS 像素）；报告页就是这个宽度，页面上看到的和 PDF 一样 */
const PAGE_W = 794;
const PAGE_H = 1123;
/** 分辨率倍数：放大看文字也清楚，文件不大 */
const RATIO = 2.5;
const JPEG_QUALITY = 0.92;
const TOP_MARGIN = 40;
const FOOT_H = 48;
const PT_W = 595.28;
const PT_H = 841.89;

/**
 * 把报告页生成 PDF：整页截成图，按 data-pdf-block 的边界分页（一块内容不会被切开），每页一张 JPEG。
 * 网页端是调系统打印窗口，这里不用选打印机和"另存为 PDF"。图片式 PDF 的文字不能选中。
 */
export async function reportToPdf(el: HTMLElement, footer: string) {
  const full = await toCanvas(el, {
    pixelRatio: RATIO,
    backgroundColor: "#fff",
    skipFonts: true,
    style: { margin: "0", boxShadow: "none" },
    filter: (n) => !(n instanceof HTMLElement && n.dataset.pdfSkip !== undefined),
  });

  const origin = el.getBoundingClientRect().top;
  const blocks = [...el.querySelectorAll<HTMLElement>("[data-pdf-block]")].map((b) => {
    const r = b.getBoundingClientRect();
    return { top: r.top - origin, bottom: r.bottom - origin };
  });
  const slices: { from: number; to: number }[] = [];
  let from = 0;
  const end = blocks[blocks.length - 1].bottom;
  while (from < end) {
    const room = PAGE_H - FOOT_H - (slices.length ? TOP_MARGIN : 0);
    const fit = blocks.filter((b) => b.bottom - from <= room).pop();
    // 一块比一页还高时只能切开
    const to = fit && fit.bottom > from ? fit.bottom : from + room;
    slices.push({ from, to });
    from = blocks.find((b) => b.top >= to - 0.5)?.top ?? to;
  }

  const pages: Uint8Array[] = [];
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const c = document.createElement("canvas");
    c.width = Math.round(PAGE_W * RATIO);
    c.height = Math.round(PAGE_H * RATIO);
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.scale(RATIO, RATIO);
    g.drawImage(full, 0, s.from * RATIO, full.width, (s.to - s.from) * RATIO, 0, i ? TOP_MARGIN : 0, PAGE_W, s.to - s.from);

    g.strokeStyle = "#E3E6EF";
    g.beginPath();
    g.moveTo(36, PAGE_H - FOOT_H + 6);
    g.lineTo(PAGE_W - 36, PAGE_H - FOOT_H + 6);
    g.stroke();
    g.font = `11px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif`;
    g.fillStyle = "#7A8096";
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillText(footer, 36, PAGE_H - FOOT_H / 2 + 2);
    g.textAlign = "right";
    g.fillText(`第 ${i + 1} / ${slices.length} 页`, PAGE_W - 36, PAGE_H - FOOT_H / 2 + 2);

    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("生成图片失败");
    pages.push(new Uint8Array(await blob.arrayBuffer()));
  }
  return buildPdf(pages, Math.round(PAGE_W * RATIO), Math.round(PAGE_H * RATIO));
}

/** 最小的 PDF：每页一张铺满的 JPEG，不引入 PDF 库 */
function buildPdf(jpegs: Uint8Array[], w: number, h: number) {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (b: Uint8Array | string) => {
    const u = typeof b === "string" ? enc.encode(b) : b;
    parts.push(u);
    size += u.length;
  };
  const obj = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = size;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  // 对象编号：1 目录，2 页面树，之后每页 3 个（页面、内容、图片）
  const id = (i: number, k: 0 | 1 | 2) => 3 + i * 3 + k;
  push("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Count ${jpegs.length} /Kids [${jpegs.map((_, i) => `${id(i, 0)} 0 R`).join(" ")}] >>`);
  jpegs.forEach((jpeg, i) => {
    obj(id(i, 0), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PT_W} ${PT_H}] /Resources << /XObject << /Im0 ${id(i, 2)} 0 R >> >> /Contents ${id(i, 1)} 0 R >>`);
    const content = enc.encode(`q ${PT_W} 0 0 ${PT_H} 0 0 cm /Im0 Do Q`);
    obj(id(i, 1), `<< /Length ${content.length} >>`, content);
    obj(id(i, 2), `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  });
  const total = 3 + jpegs.length * 3;
  const xref = size;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
