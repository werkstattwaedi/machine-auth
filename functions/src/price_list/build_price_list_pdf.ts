// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { shortUnit } from "./types";
import type { PriceListRenderData } from "./types";

// A4 dimensions in points (pdfkit native unit).
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56.69; // 20 mm
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

// Column layout (right-aligned price columns, left-aligned code/name).
const COL_CODE_W = 50;
const COL_PRICE_W = 75;
const COL_MEMBER_W = 75;
const COL_UNIT_W = 40;
const COL_NAME_W = CONTENT_WIDTH - COL_CODE_W - COL_PRICE_W - COL_MEMBER_W - COL_UNIT_W;

const COL_CODE_X = MARGIN;
const COL_NAME_X = COL_CODE_X + COL_CODE_W;
const COL_PRICE_X = COL_NAME_X + COL_NAME_W;
const COL_MEMBER_X = COL_PRICE_X + COL_PRICE_W;
const COL_UNIT_X = COL_MEMBER_X + COL_MEMBER_W;

const ROW_HEIGHT = 17;
const FOOTER_RESERVE = 130; // QR + footer text live in this bottom band
const QR_SIZE = 85; // ~30 mm
const FOOTER_TEXT_OFFSET = 10;

function formatPrice(amount: number): string {
  return `CHF ${amount.toFixed(2)}`;
}

/**
 * Trim `text` so it fits in `maxWidth` at the document's current font and
 * size, appending an ellipsis if anything was removed. Avoids relying on
 * pdfkit's `ellipsis` option, which silently no-ops in some font/lineBreak
 * combinations and lets the text overflow into the next column.
 */
function truncateToWidth(
  doc: PDFKit.PDFDocument,
  text: string,
  maxWidth: number
): string {
  if (doc.widthOfString(text) <= maxWidth) return text;
  const ELLIPSIS = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (doc.widthOfString(text.slice(0, mid) + ELLIPSIS) <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(0, lo) + ELLIPSIS;
}

/**
 * Returns `{ y, addedPage }`. `addedPage` lets the caller re-render the
 * column header after a forced page break (pdfkit's bufferedPageRange()
 * only tracks pages added when bufferPages: true, which we don't enable).
 */
function ensureRowSpace(
  doc: PDFKit.PDFDocument,
  y: number,
  bottomLimit: number,
  needed: number
): { y: number; addedPage: boolean } {
  if (y + needed <= bottomLimit) return { y, addedPage: false };
  doc.addPage();
  return { y: MARGIN, addedPage: true };
}

/**
 * Render the column header on the current page. Returns the new y after the
 * underline.
 */
function renderHeader(doc: PDFKit.PDFDocument, y: number): number {
  doc.fontSize(9).font("Helvetica-Bold");
  doc.text("Code", COL_CODE_X, y, { width: COL_CODE_W, align: "left" });
  doc.text("Name", COL_NAME_X, y, { width: COL_NAME_W, align: "left" });
  doc.text("Preis", COL_PRICE_X, y, { width: COL_PRICE_W, align: "right" });
  doc.text("Mitglieder", COL_MEMBER_X, y, { width: COL_MEMBER_W, align: "right" });
  doc.text("Einheit", COL_UNIT_X, y, { width: COL_UNIT_W, align: "right" });
  y += 12;
  doc.lineWidth(0.5).moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).stroke();
  y += 6;
  doc.font("Helvetica");
  return y;
}

/**
 * Build a price-list PDF as a Buffer.
 *
 * Layout mirrors the previous client-side version: title, item table
 * with code/name/two prices/unit columns, then a QR code + footer text band
 * at the bottom of the last page.
 */
export async function buildPriceListPdf(
  data: PriceListRenderData
): Promise<Buffer> {
  // Generate QR up front so we can fail fast (and so the PDF stream stays
  // clean — pdfkit can't easily await mid-stream).
  const qrPngBuffer = await QRCode.toBuffer(data.qrUrl, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: QR_SIZE * 4, // render at 4x for crisp rasterisation
  });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const doc = new PDFDocument({
      autoFirstPage: false,
      size: "A4",
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.addPage();
    let y = MARGIN;

    // Title
    doc.fontSize(18).font("Helvetica-Bold");
    doc.text(data.name, MARGIN, y, { width: CONTENT_WIDTH });
    y += 34;
    doc.font("Helvetica");

    y = renderHeader(doc, y);

    // Reserve footer band on every page: simpler than predicting the last
    // page, and the small loss in capacity (a few extra rows per page) is
    // worth the deterministic layout.
    const pageBottom = PAGE_HEIGHT - MARGIN - FOOTER_RESERVE;

    doc.fontSize(9).font("Helvetica");

    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      const ensured = ensureRowSpace(doc, y, pageBottom, ROW_HEIGHT);
      y = ensured.y;
      // Re-render the header on continuation pages.
      if (ensured.addedPage) {
        y = renderHeader(doc, y);
        doc.fontSize(9).font("Helvetica");
      }

      doc.text(item.code, COL_CODE_X, y, { width: COL_CODE_W, align: "left" });

      const maxNameWidth = COL_NAME_W - 6;
      const truncated = truncateToWidth(doc, item.name, maxNameWidth);
      doc.text(truncated, COL_NAME_X, y, {
        width: maxNameWidth,
        align: "left",
        lineBreak: false,
      });

      const priceNone = item.unitPrice?.none ?? 0;
      const priceMember = item.unitPrice?.member ?? 0;
      doc.text(formatPrice(priceNone), COL_PRICE_X, y, {
        width: COL_PRICE_W,
        align: "right",
        lineBreak: false,
      });
      doc.text(formatPrice(priceMember), COL_MEMBER_X, y, {
        width: COL_MEMBER_W,
        align: "right",
        lineBreak: false,
      });
      doc.text(shortUnit(item.pricingModel), COL_UNIT_X, y, {
        width: COL_UNIT_W,
        align: "right",
        lineBreak: false,
      });

      y += ROW_HEIGHT;
    }

    // Footer band: QR code + footer text on the bottom of the current page.
    const footerY = PAGE_HEIGHT - MARGIN - FOOTER_RESERVE + 20;
    const qrX = MARGIN;

    doc.image(qrPngBuffer, qrX, footerY, { width: QR_SIZE, height: QR_SIZE });

    if (data.footer) {
      doc.fontSize(8).fillColor("#555555").font("Helvetica");
      doc.text(
        data.footer,
        qrX + QR_SIZE + FOOTER_TEXT_OFFSET,
        footerY + QR_SIZE / 2 - 4,
        {
          width: CONTENT_WIDTH - QR_SIZE - FOOTER_TEXT_OFFSET,
          align: "left",
        }
      );
      doc.fillColor("#000000");
    }

    doc.end();
  });
}

/** Build a download-friendly filename for a price list. */
export function priceListFilename(name: string): string {
  const safe = name.replace(/[/\\:*?"<>|]/g, "_").trim() || "Preisliste";
  return `${safe}.pdf`;
}
