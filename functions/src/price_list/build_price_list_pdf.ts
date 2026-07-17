// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Werkstatt price-list PDF, following the design handoff
 * ("Werkstatt-Preislisten", Stand 14.07.2026): A4 portrait, 14 mm margins,
 * Bitter/Roboto Slab, first-page header with logo, rotated title highlight
 * bar and QR code, one table per category, footer on every page.
 *
 * The reference layout is authored in CSS pixels; PDF geometry below uses
 * points (1 px = 0.75 pt) so the printed sheet matches the design 1:1.
 */

import path from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { PriceListCategory, PriceListRenderData } from "./types";

const PX = 0.75; // CSS px → pt

// A4 in points.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 39.69; // 14 mm
const CONTENT_W = PAGE_W - 2 * MARGIN;

// Design neutrals.
const TEXT = "#1a1a1a";
const MUTED = "#737373";
const CAPTION = "#525252";
const HAIRLINE = "#e5e5e5";
const HEAD_RULE = "#d4d4d4";

// Column layout: Code 58px · Produkt (flex) · Mass 110px · Preis 110px.
const COL_CODE_W = 58 * PX;
const COL_MASS_W = 110 * PX;
const COL_PRICE_W = 110 * PX;
const COL_PROD_W = CONTENT_W - COL_CODE_W - COL_MASS_W - COL_PRICE_W;
const CELL_PAD_R = 10 * PX;

const X_CODE = MARGIN;
const X_PROD = X_CODE + COL_CODE_W;
const X_MASS = X_PROD + COL_PROD_W;
const X_PRICE = X_MASS + COL_MASS_W;

// Table rhythm (px → pt): 15px text in a 1.4 line box, 5px cell padding,
// 1px hairline ⇒ deterministic 24 pt row height, which is what makes the
// break-budget math below exact.
const ROW_FONT = 15 * PX;
const ROW_LINE = 15 * 1.4 * PX; // 15.75
const CELL_PAD_Y = 5 * PX;
const ROW_H = ROW_LINE + 2 * CELL_PAD_Y + 1 * PX; // 24

const HEAD_FONT = 12 * PX;
const HEAD_LINE = 12 * 1.4 * PX;
const HEAD_H = HEAD_LINE + 5 * PX + 2 * PX; // text + padding + 2px rule

const H2_FONT = 19 * PX;
const H2_GAP = 8 * PX; // margin below heading
const SECTION_PAD = 22 * PX; // padding above every category block

// Pagination rules from the handoff: categories up to this many rows are
// kept on one page; longer ones may split with at least MIN_SPLIT_ROWS on
// each side of the break.
const KEEP_TOGETHER_MAX_ROWS = 12;
const MIN_SPLIT_ROWS = 3;

// Footer band (every page).
const FOOTER_FONT = 11 * PX;
const FOOTER_PAD_TOP = 6 * PX;
const FOOTER_RULE_H = 1 * PX;
const FOOTER_TEXT_H = FOOTER_FONT * 1.2;
const FOOTER_RULE_Y =
  PAGE_H - MARGIN - FOOTER_TEXT_H - FOOTER_PAD_TOP - FOOTER_RULE_H;
// Body content must stop above the footer with a little breathing room.
const CONTENT_BOTTOM = FOOTER_RULE_Y - 16;

// Header (first page only).
const LOGO_H = 40 * PX;
const LOGO_W = LOGO_H * (500 / 143); // logo_oww.png aspect ratio
const QR_BOX = 118 * PX; // right column width
const QR_SIZE = 98 * PX; // ≈26 mm
const H1_FONT = 36 * PX;
const H1_LINE = 36 * 1.1 * PX; // 29.7
const BAR_PAD_X = 12 * PX;
const BAR_TILT_DEG = -1.2;

const ASSET_DIR = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "assets",
  "price_list",
);

const FONTS = {
  heading: "Bitter-Bold",
  headingX: "Bitter-ExtraBold",
  body: "RobotoSlab",
  bodyMedium: "RobotoSlab-Medium",
  bodySemi: "RobotoSlab-SemiBold",
} as const;

function registerFonts(doc: PDFKit.PDFDocument): void {
  const dir = path.join(ASSET_DIR, "fonts");
  doc.registerFont(FONTS.heading, path.join(dir, "Bitter-Bold.ttf"));
  doc.registerFont(FONTS.headingX, path.join(dir, "Bitter-ExtraBold.ttf"));
  doc.registerFont(FONTS.body, path.join(dir, "RobotoSlab-Regular.ttf"));
  doc.registerFont(FONTS.bodyMedium, path.join(dir, "RobotoSlab-Medium.ttf"));
  doc.registerFont(FONTS.bodySemi, path.join(dir, "RobotoSlab-SemiBold.ttf"));
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
  maxWidth: number,
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

/** Vertically center the current font inside a CSS line box of `lineH`. */
function centerInLine(
  doc: PDFKit.PDFDocument,
  top: number,
  lineH: number,
): number {
  return top + (lineH - doc.currentLineHeight()) / 2;
}

/**
 * Replace characters the vendored fonts have no glyph for (they render as
 * tofu). Catalog data uses the technical diameter sign ⌀ (U+2300), which
 * neither Bitter nor Roboto Slab covers — Latin Ø is visually equivalent
 * and present in both.
 */
function sanitize(text: string): string {
  return text.replace(/[⌀∅]/g, "Ø");
}

/**
 * Whether white text has better WCAG contrast than black on this color.
 * The crossover is relative luminance ≈ 0.179 ((L+0.05)² = 0.05·1.05);
 * of the Farbkonzept colors only makerspace #a44d6e (L ≈ 0.14) is below it.
 */
function isDarkColor(hex: string): boolean {
  const n = parseInt(hex.replace("#", ""), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff);
  return luminance < 0.179;
}

/**
 * First-page header: logo + kicker + highlighted title on the left, QR code
 * with caption on the right, closed by a 4px rule in the workshop color.
 * Returns the y where body content starts.
 */
function renderHeader(
  doc: PDFKit.PDFDocument,
  data: PriceListRenderData,
  qrPng: Buffer,
): number {
  // Left column: logo, kicker, title.
  doc.image(path.join(ASSET_DIR, "logo_oww.png"), MARGIN, MARGIN, {
    width: LOGO_W,
    height: LOGO_H,
  });

  const kickerY = MARGIN + LOGO_H + 14 * PX;
  doc
    .font(FONTS.bodyMedium)
    .fontSize(13 * PX)
    .fillColor(MUTED);
  doc.text("PREISLISTE", MARGIN, kickerY, {
    characterSpacing: 13 * PX * 0.08,
    lineBreak: false,
  });
  const kickerBottom = kickerY + doc.currentLineHeight();

  // Title with the brand highlighter gesture: the bar tilts −1.2°, the text
  // stays straight. Span box = text + 12px side padding, 1px/3px top/bottom.
  const titleTop = kickerBottom + 4 * PX;
  const spanH = H1_LINE + 1 * PX + 3 * PX;
  doc.font(FONTS.headingX).fontSize(H1_FONT);
  const title = sanitize(data.title);
  const titleCS = -0.01 * H1_FONT;
  const titleW = doc.widthOfString(title, { characterSpacing: titleCS });
  const barW = titleW + 2 * BAR_PAD_X;
  const barH = spanH - 2 * 2 * PX; // inset 2px top and bottom
  const barX = MARGIN;
  const barY = titleTop + 2 * PX;
  doc.save();
  doc.rotate(BAR_TILT_DEG, { origin: [barX + barW / 2, barY + barH / 2] });
  doc.rect(barX, barY, barW, barH).fill(data.color);
  doc.restore();
  // Most workshop colors are light enough for near-black text; the dark
  // ones (makerspace) flip to white.
  doc.fillColor(isDarkColor(data.color) ? "#ffffff" : TEXT);
  const titleTextY = centerInLine(doc, titleTop + 1 * PX, H1_LINE);
  doc.text(title, MARGIN + BAR_PAD_X, titleTextY, {
    characterSpacing: titleCS,
    lineBreak: false,
  });
  doc.fillColor(TEXT);
  const leftBottom = titleTop + spanH;

  // Right column: QR code + caption (borderless — the quiet zone is enough).
  const boxX = PAGE_W - MARGIN - QR_BOX;
  const qrX = boxX + (QR_BOX - QR_SIZE) / 2;
  doc.image(qrPng, qrX, MARGIN, { width: QR_SIZE, height: QR_SIZE });
  const captionY = MARGIN + QR_SIZE + 1 * PX + 5 * PX;
  doc
    .font(FONTS.body)
    .fontSize(10 * PX)
    .fillColor(CAPTION);
  const caption = "Scannen, um Material zu deinem Besuch hinzuzufügen";
  doc.text(caption, boxX, captionY, { width: QR_BOX, align: "center" });
  const rightBottom = captionY + doc.heightOfString(caption, { width: QR_BOX });

  // 4px rule in the workshop color under the whole header.
  const ruleY = Math.max(leftBottom, rightBottom) + 16 * PX;
  doc.rect(MARGIN, ruleY, CONTENT_W, 4 * PX).fill(data.color);
  return ruleY + 4 * PX;
}

/** Column-header row (repeats after page breaks). Returns y below it. */
function renderTableHead(
  doc: PDFKit.PDFDocument,
  y: number,
  cat: PriceListCategory,
): number {
  doc.font(FONTS.bodySemi).fontSize(HEAD_FONT).fillColor(MUTED);
  const textY = centerInLine(doc, y, HEAD_LINE);
  doc.text("Code", X_CODE, textY, { lineBreak: false });
  doc.text("Produkt", X_PROD, textY, { lineBreak: false });
  // A category where no row has a mass drops the floating "Mass" header
  // above the empty column.
  if (cat.rows.some((row) => row.mass)) {
    doc.text("Mass", X_MASS, textY, { lineBreak: false });
  }
  const priceLabel = cat.unit ? `Preis CHF/${cat.unit}` : "Preis CHF";
  doc.text(priceLabel, X_PRICE, textY, {
    width: COL_PRICE_W,
    align: "right",
    lineBreak: false,
  });
  const ruleY = y + HEAD_LINE + 5 * PX;
  doc.rect(MARGIN, ruleY, CONTENT_W, 2 * PX).fill(HEAD_RULE);
  return ruleY + 2 * PX;
}

/** One table row (fixed ROW_H) with bottom hairline. */
function renderRow(
  doc: PDFKit.PDFDocument,
  y: number,
  row: PriceListCategory["rows"][number],
): void {
  doc.font(FONTS.body).fontSize(ROW_FONT);
  const textY = centerInLine(doc, y + CELL_PAD_Y, ROW_LINE);

  doc.fillColor(MUTED);
  doc.text(row.code, X_CODE, textY, { lineBreak: false });

  doc.fillColor(TEXT);
  const prodMax = COL_PROD_W - CELL_PAD_R;
  doc.text(
    truncateToWidth(doc, sanitize(row.produkt), prodMax),
    X_PROD,
    textY,
    {
      lineBreak: false,
    },
  );
  // The mass column may run into the price column's padding: the price is
  // right-aligned, so its left half is always empty, and realistic mass
  // strings ("20 × 20 × 2 mm" ≈ 79pt) overflow the CSS-padded 75pt.
  const massMax = COL_MASS_W - 2;
  doc.text(truncateToWidth(doc, sanitize(row.mass), massMax), X_MASS, textY, {
    lineBreak: false,
  });

  doc.font(FONTS.bodySemi);
  doc.text(row.preis, X_PRICE, textY, {
    width: COL_PRICE_W,
    align: "right",
    lineBreak: false,
  });

  doc.rect(MARGIN, y + ROW_H - 1 * PX, CONTENT_W, 1 * PX).fill(HAIRLINE);
}

/** Category heading height + gap (0 when the heading is suppressed). */
function headingH(doc: PDFKit.PDFDocument, cat: PriceListCategory): number {
  if (!cat.showTitle) return 0;
  doc.font(FONTS.heading).fontSize(H2_FONT);
  return doc.currentLineHeight() + H2_GAP;
}

/** Footer on every page: Stand left, attribution (+ page count) right. */
function renderFooter(
  doc: PDFKit.PDFDocument,
  data: PriceListRenderData,
  page: number,
  pageCount: number,
): void {
  doc.rect(MARGIN, FOOTER_RULE_Y, CONTENT_W, FOOTER_RULE_H).fill(HAIRLINE);
  const textY = FOOTER_RULE_Y + FOOTER_RULE_H + FOOTER_PAD_TOP;
  doc.font(FONTS.body).fontSize(FOOTER_FONT).fillColor(MUTED);
  doc.text(`Stand: ${data.stand}`, MARGIN, textY, { lineBreak: false });
  // Page numbers only when there is something to order (see Richtlinien:
  // stamped post-render into the right side of the footer).
  const right =
    pageCount > 1
      ? `Offene Werkstatt Wädenswil · Seite ${page} von ${pageCount}`
      : "Offene Werkstatt Wädenswil";
  doc.text(right, MARGIN, textY, {
    width: CONTENT_W,
    align: "right",
    lineBreak: false,
  });
}

/** Build a price-list PDF as a Buffer. */
export async function buildPriceListPdf(
  data: PriceListRenderData,
): Promise<Buffer> {
  // Generate the QR up front so we can fail fast (and so the PDF stream
  // stays clean — pdfkit can't easily await mid-stream). ECC level M and a
  // 2-module quiet zone per the handoff.
  const qrPng = await QRCode.toBuffer(data.qrUrl, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: Math.round(QR_SIZE * 4), // 4x for crisp rasterisation
  });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const doc = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true, // footers (incl. "Seite n von N") are stamped last
      size: "A4",
      margin: 0,
    });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    registerFonts(doc);
    doc.addPage();
    let y = renderHeader(doc, data, qrPng);

    const newPage = (): number => {
      doc.addPage();
      return MARGIN;
    };

    for (const cat of data.categories) {
      const rows = cat.rows;
      const h2H = headingH(doc, cat);
      // Space the category needs before its first row can render.
      const leadH = SECTION_PAD + h2H + HEAD_H;
      // ≤12 rows: the whole block moves to the next page if it doesn't fit.
      // Longer categories may split, but never with fewer than 3 rows on
      // either side of the break, so the lead-in requires 3 rows too.
      const keepRows =
        rows.length <= KEEP_TOGETHER_MAX_ROWS ? rows.length : MIN_SPLIT_ROWS;
      if (y + leadH + keepRows * ROW_H > CONTENT_BOTTOM) {
        y = newPage();
      }

      y += SECTION_PAD;
      if (cat.showTitle) {
        doc.font(FONTS.heading).fontSize(H2_FONT).fillColor(TEXT);
        doc.text(sanitize(cat.name), MARGIN, y, { lineBreak: false });
        y += h2H;
      }
      y = renderTableHead(doc, y, cat);

      let i = 0;
      while (i < rows.length) {
        let fit = Math.floor((CONTENT_BOTTOM - y) / ROW_H);
        const remaining = rows.length - i;
        if (fit < remaining) {
          // Widow rule: the continuation must receive at least 3 rows.
          if (remaining - fit < MIN_SPLIT_ROWS) {
            fit = remaining - MIN_SPLIT_ROWS;
          }
        } else {
          fit = remaining;
        }
        for (const row of rows.slice(i, i + fit)) {
          renderRow(doc, y, row);
          y += ROW_H;
        }
        i += fit;
        if (i < rows.length) {
          y = newPage();
          y = renderTableHead(doc, y, cat);
        }
      }
    }

    // Stamp the footer on every buffered page now that the count is known.
    const range = doc.bufferedPageRange();
    for (let p = 0; p < range.count; p++) {
      doc.switchToPage(range.start + p);
      renderFooter(doc, data, p + 1, range.count);
    }

    doc.end();
  });
}

/** Build a download-friendly filename for a price list. */
export function priceListFilename(name: string): string {
  const safe = name.replace(/[/\\:*?"<>|]/g, "_").trim() || "Preisliste";
  return `Preisliste ${safe}.pdf`;
}
