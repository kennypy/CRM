/**
 * Client-side PDF generation for quotes using jsPDF + jspdf-autotable.
 * Dynamically imported to avoid SSR issues.
 */
import type { Quote } from "./quotes";
import { fmtCurrency, STATUS_LABELS } from "./quotes";

export async function generateQuotePDF(quote: Quote, tenantName = "Your Company"): Promise<void> {
  // Dynamic import so Next.js doesn't try to SSR these browser-only libs
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = 210; // A4 width mm
  const MARGIN = 16;
  const CW = PW - MARGIN * 2;
  const currency = quote.currency;

  // ── Header bar ──────────────────────────────────────────────────────────────
  doc.setFillColor(30, 64, 175); // primary blue
  doc.rect(0, 0, PW, 38, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(tenantName, MARGIN, 17);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("QUOTE", MARGIN, 26);

  // Quote number + status top-right
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(quote.quoteNumber, PW - MARGIN, 17, { align: "right" });
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text(STATUS_LABELS[quote.status], PW - MARGIN, 26, { align: "right" });

  // ── Meta section ────────────────────────────────────────────────────────────
  doc.setTextColor(30, 30, 30);
  let y = 48;

  // Title
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(quote.title, MARGIN, y);
  y += 8;

  // Two-column meta: issued to (left) | details (right)
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 90, 90);

  const leftMeta: [string, string][] = [];
  if (quote.companyName)  leftMeta.push(["Issued to", quote.companyName]);
  if (quote.contactName)  leftMeta.push(["Attention", quote.contactName]);
  if (quote.createdByName) leftMeta.push(["Prepared by", quote.createdByName]);

  const rightMeta: [string, string][] = [
    ["Issue date",  new Date(quote.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })],
  ];
  if (quote.validUntil) rightMeta.push(["Valid until", new Date(quote.validUntil).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })]);

  const metaY = y;
  leftMeta.forEach(([label, val], i) => {
    doc.setFont("helvetica", "bold");   doc.text(label + ":", MARGIN, metaY + i * 6);
    doc.setFont("helvetica", "normal"); doc.text(val, MARGIN + 30, metaY + i * 6);
  });
  rightMeta.forEach(([label, val], i) => {
    doc.setFont("helvetica", "bold");   doc.text(label + ":", PW / 2 + 4, metaY + i * 6);
    doc.setFont("helvetica", "normal"); doc.text(val, PW / 2 + 35, metaY + i * 6);
  });

  y = metaY + Math.max(leftMeta.length, rightMeta.length) * 6 + 8;

  // ── Line items table ────────────────────────────────────────────────────────
  const tableHead = [["#", "Product / Description", "Qty", "Unit Price", "Disc %", "Line Total"]];
  const tableBody = quote.items.map((item, i) => [
    String(i + 1),
    item.description ? `${item.productName}\n${item.description}` : item.productName,
    String(item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(3)),
    fmtCurrency(item.unitPrice, currency),
    item.discountPct > 0 ? `${item.discountPct}%` : "—",
    fmtCurrency(item.lineTotal, currency),
  ]);

  autoTable(doc, {
    startY: y,
    head:   tableHead,
    body:   tableBody,
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 255] },
    columnStyles: {
      0: { cellWidth: 8,  halign: "center" },
      2: { cellWidth: 16, halign: "right" },
      3: { cellWidth: 26, halign: "right" },
      4: { cellWidth: 18, halign: "right" },
      5: { cellWidth: 30, halign: "right", fontStyle: "bold" },
    },
  });

  // ── Totals block ────────────────────────────────────────────────────────────
  const finalY = (doc as any).lastAutoTable.finalY + 6;
  const totW = 80;
  const totX = PW - MARGIN - totW;

  const totals: [string, string, boolean][] = [
    ["Subtotal", fmtCurrency(quote.subtotal, currency), false],
  ];
  if (quote.discountType !== "none" && quote.discountValue > 0) {
    const label = quote.discountType === "percent"
      ? `Order discount (${quote.discountValue}%)`
      : "Order discount";
    const discAmt = quote.discountType === "percent"
      ? quote.subtotal * quote.discountValue / 100
      : quote.discountValue;
    totals.push([label, `−${fmtCurrency(discAmt, currency)}`, false]);
  }
  if (quote.taxRate > 0) {
    const base = quote.subtotal - (quote.discountType === "percent" ? quote.subtotal * quote.discountValue / 100 : quote.discountType === "fixed" ? quote.discountValue : 0);
    totals.push([`Tax (${quote.taxRate}%)`, fmtCurrency(base * quote.taxRate / 100, currency), false]);
  }
  totals.push(["TOTAL", fmtCurrency(quote.total, currency), true]);

  let ty = finalY;
  totals.forEach(([label, val, isBold]) => {
    doc.setFontSize(isBold ? 11 : 9);
    doc.setFont("helvetica", isBold ? "bold" : "normal");
    doc.setTextColor(isBold ? 30 : 80, isBold ? 30 : 80, isBold ? 30 : 80);
    if (isBold) {
      doc.setFillColor(240, 242, 255);
      doc.rect(totX - 2, ty - 4, totW + 4, 9, "F");
    }
    doc.text(label, totX, ty);
    doc.text(val,   PW - MARGIN, ty, { align: "right" });
    ty += isBold ? 10 : 7;
  });

  // ── Notes & Terms ───────────────────────────────────────────────────────────
  let notesY = ty + 8;

  if (quote.notes) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 30);
    doc.text("Notes", MARGIN, notesY);
    notesY += 5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(70, 70, 70);
    const noteLines = doc.splitTextToSize(quote.notes, CW);
    doc.text(noteLines, MARGIN, notesY);
    notesY += noteLines.length * 5 + 6;
  }

  if (quote.terms) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 30);
    doc.text("Terms & Conditions", MARGIN, notesY);
    notesY += 5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    const termLines = doc.splitTextToSize(quote.terms, CW);
    doc.text(termLines, MARGIN, notesY);
  }

  // ── Footer on each page ─────────────────────────────────────────────────────
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `${tenantName} · ${quote.quoteNumber} · Page ${i} of ${pageCount}`,
      PW / 2, 292, { align: "center" }
    );
  }

  doc.save(`${quote.quoteNumber}.pdf`);
}
