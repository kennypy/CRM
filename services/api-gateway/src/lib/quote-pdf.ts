/**
 * Server-side quote PDF rendering (pdf-lib, pure JS — no headless browser).
 *
 * Produces a customer-facing document: header, parties, line items with
 * pagination, totals, terms and notes. Standard fonts only support WinAnsi,
 * so text is sanitised to that charset.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface PdfQuote {
  quoteNumber: string;
  title: string;
  status: string;
  currency: string;
  subtotal: number;
  discountType: string;
  discountValue: number;
  taxRate: number;
  total: number;
  companyName?: string | null;
  contactName?: string | null;
  validUntil?: string | Date | null;
  createdAt?: string | Date | null;
  notes?: string | null;
  terms?: string | null;
  preparedBy?: string | null;
  items: {
    productName: string;
    description?: string | null;
    quantity: number;
    unitPrice: number;
    discountPct: number;
    lineTotal: number;
  }[];
}

export interface PdfBranding {
  sellerName: string;
}

/** Replace characters outside WinAnsi so StandardFonts can encode them. */
export function sanitize(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[\t\r]/g, " ")
    .replace(/[^\x20-\x7E\n\u00A0-\u00FF]/g, "?");
}

export function formatMoney(n: number, currency: string): string {
  const v = Number.isFinite(n) ? n : 0;
  const s = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${s}`;
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toISOString().slice(0, 10);
}

/** Greedy word wrap to a max width in points. */
export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of sanitize(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) out.push(line);
        // Hard-break words longer than the column.
        let w = word;
        while (font.widthOfTextAtSize(w, size) > maxWidth && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut--;
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

const PAGE_W = 612;  // US Letter
const PAGE_H = 792;
const M = 50;

export async function renderQuotePdf(q: PdfQuote, brand: PdfBranding): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(sanitize(`${q.quoteNumber} - ${q.title}`));
  doc.setProducer("NexCRM");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const grey = rgb(0.4, 0.4, 0.4);
  const ink = rgb(0.1, 0.1, 0.12);

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;

  const text = (t: string, x: number, size = 10, f = font, color = ink) => {
    page.drawText(sanitize(t), { x, y, size, font: f, color });
  };
  const right = (t: string, xRight: number, size = 10, f = font, color = ink) => {
    const s = sanitize(t);
    page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, size), y, size, font: f, color });
  };
  const newPage = () => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - M;
  };
  const ensure = (needed: number) => {
    if (y - needed < M + 20) newPage();
  };

  // ── Header ────────────────────────────────────────────────────────────────
  text(brand.sellerName, M, 18, bold);
  right("QUOTE", PAGE_W - M, 18, bold);
  y -= 22;
  text(q.title, M, 12, font, grey);
  right(q.quoteNumber, PAGE_W - M, 11, bold);
  y -= 16;
  right(`Date: ${fmtDate(q.createdAt) || fmtDate(new Date())}`, PAGE_W - M, 9, font, grey);
  y -= 12;
  if (q.validUntil) { right(`Valid until: ${fmtDate(q.validUntil)}`, PAGE_W - M, 9, font, grey); y -= 12; }
  if (q.status === "draft" || q.status === "pending_approval") {
    right(q.status === "draft" ? "DRAFT" : "PENDING APPROVAL", PAGE_W - M, 9, bold, rgb(0.75, 0.2, 0.2));
    y -= 12;
  }

  y -= 10;
  text("Prepared for", M, 9, bold, grey);
  if (q.preparedBy) right("Prepared by", PAGE_W - M, 9, bold, grey);
  y -= 13;
  text(q.companyName || "-", M, 11, bold);
  if (q.preparedBy) right(q.preparedBy, PAGE_W - M, 10);
  y -= 13;
  if (q.contactName) { text(q.contactName, M, 10); y -= 13; }

  // ── Line items ────────────────────────────────────────────────────────────
  y -= 14;
  const cols = { item: M, qty: 340, price: 420, disc: 470, total: PAGE_W - M };
  const header = () => {
    page.drawRectangle({ x: M - 4, y: y - 4, width: PAGE_W - 2 * M + 8, height: 18, color: rgb(0.94, 0.94, 0.96) });
    y += 2;
    text("Item", cols.item, 9, bold);
    right("Qty", cols.qty + 30, 9, bold);
    right("Unit price", cols.price + 30, 9, bold);
    right("Disc.", cols.disc + 25, 9, bold);
    right("Amount", cols.total, 9, bold);
    y -= 20;
  };
  header();

  for (const it of q.items) {
    const nameLines = wrap(it.productName, bold, 10, cols.qty - cols.item - 20);
    const descLines = it.description ? wrap(it.description, font, 8.5, cols.qty - cols.item - 20) : [];
    const h = nameLines.length * 13 + descLines.length * 11 + 6;
    if (y - h < M + 20) { newPage(); header(); }
    text(nameLines[0], cols.item, 10, bold);
    right(String(it.quantity), cols.qty + 30);
    right(formatMoney(it.unitPrice, q.currency), cols.price + 30, 9);
    right(it.discountPct ? `${it.discountPct}%` : "-", cols.disc + 25, 9);
    right(formatMoney(it.lineTotal, q.currency), cols.total, 10);
    y -= 13;
    for (const l of nameLines.slice(1)) { text(l, cols.item, 10, bold); y -= 13; }
    for (const l of descLines) { text(l, cols.item, 8.5, font, grey); y -= 11; }
    y -= 6;
    page.drawLine({ start: { x: M, y: y + 3 }, end: { x: PAGE_W - M, y: y + 3 }, thickness: 0.4, color: rgb(0.85, 0.85, 0.88) });
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  ensure(90);
  y -= 8;
  const label = PAGE_W - M - 170;
  const row = (l: string, v: string, f = font, size = 10) => {
    text(l, label, size, f);
    right(v, PAGE_W - M, size, f);
    y -= 15;
  };
  row("Subtotal", formatMoney(q.subtotal, q.currency));
  if (q.discountType !== "none" && q.discountValue > 0) {
    const disc = q.discountType === "percent"
      ? q.subtotal * q.discountValue / 100
      : Math.min(q.discountValue, q.subtotal);
    row(q.discountType === "percent" ? `Discount (${q.discountValue}%)` : "Discount", `-${formatMoney(disc, q.currency)}`);
  }
  if (q.taxRate > 0) {
    const pre = q.total / (1 + q.taxRate / 100);
    row(`Tax (${q.taxRate}%)`, formatMoney(q.total - pre, q.currency));
  }
  page.drawLine({ start: { x: label, y: y + 10 }, end: { x: PAGE_W - M, y: y + 10 }, thickness: 0.8, color: ink });
  y -= 2;
  row("Total", formatMoney(q.total, q.currency), bold, 12);

  // ── Terms / notes ─────────────────────────────────────────────────────────
  for (const [heading, body] of [["Terms & conditions", q.terms], ["Notes", q.notes]] as const) {
    if (!body) continue;
    y -= 12;
    ensure(30);
    text(heading, M, 10, bold);
    y -= 14;
    for (const l of wrap(body, font, 9, PAGE_W - 2 * M)) {
      ensure(12);
      text(l, M, 9, font, grey);
      y -= 12;
    }
  }

  // ── Footer with page numbers ──────────────────────────────────────────────
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const s = sanitize(`${q.quoteNumber}  |  Page ${i + 1} of ${pages.length}`);
    p.drawText(s, { x: PAGE_W - M - font.widthOfTextAtSize(s, 8), y: 25, size: 8, font, color: grey });
  });

  return doc.save();
}
