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
import type {
  PriceListCategory,
  PriceListRenderData,
  PriceListRow,
} from "./types";

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

// Column layout of a single-price table: Code 58px · Produkt (flex) · Mass
// 110px · Preis 110px. Tables with several prices fit Mass and Preis to their
// content instead (layoutTable).
const COL_CODE_W = 58 * PX;
const COL_MASS_W = 110 * PX;
const COL_PRICE_W = 110 * PX;
const CELL_PAD_R = 10 * PX;
const PRICE_COL_GAP = 12 * PX;
// Below this Produkt, the price headings wrap rather than squeeze it further.
const MIN_PROD_W = 150;

const X_CODE = MARGIN;
const X_PROD = X_CODE + COL_CODE_W;

// Table rhythm (px → pt): 15px text in a 1.4 line box, 5px cell padding,
// 1px hairline ⇒ 24 pt per one-line row. Rows are measured up front (the
// product name wraps), which keeps the break-budget math below exact.
const ROW_FONT = 15 * PX;
const ROW_LINE = 15 * 1.4 * PX; // 15.75
const CELL_PAD_Y = 5 * PX;
const MAX_PROD_LINES = 2;

const HEAD_FONT = 12 * PX;
const HEAD_LINE = 12 * 1.4 * PX;
const HEAD_RULE_H = 5 * PX + 2 * PX; // padding + 2px rule
const PRICE_HEAD = "Preis CHF";

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

/**
 * Greedy word wrap at the document's current font and size; whatever doesn't
 * fit in `maxLines` is truncated into the last line.
 */
function wrapLines(
  doc: PDFKit.PDFDocument,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const candidate = line ? `${line} ${words[i]}` : words[i];
    if (line && doc.widthOfString(candidate) > maxWidth) {
      if (lines.length === maxLines - 1) {
        line = words.slice(i - line.split(" ").length, words.length).join(" ");
        break;
      }
      lines.push(truncateToWidth(doc, line, maxWidth));
      line = words[i];
    } else {
      line = candidate;
    }
  }
  lines.push(truncateToWidth(doc, line, maxWidth));
  return lines;
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

/** Where a category's columns sit, and what its rows look like laid out. */
interface TableLayout {
  xMass: number;
  massMax: number;
  priceCols: { x: number; w: number; headLines: string[] }[];
  /** Header text + padding + rule. */
  headH: number;
  /** Wrapped product name per row, parallel to `cat.rows`. */
  produkt: string[][];
}

function rowHeight(lines: number): number {
  return lines * ROW_LINE + 2 * CELL_PAD_Y + 1 * PX;
}

/**
 * Column geometry of one category. A single-price table keeps the fixed design
 * columns; with several prices Mass and the prices shrink to their content, so
 * that only the tables that need the room give up Produkt width for it.
 */
function layoutTable(
  doc: PDFKit.PDFDocument,
  cat: PriceListCategory,
): TableLayout {
  const headings = cat.priceColumns.map((col) => sanitize(col.heading));

  let massW = COL_MASS_W;
  let priceWs = [COL_PRICE_W];
  // The mass column may run into the price column's padding: the price is
  // right-aligned, so its left half is always empty, and realistic mass
  // strings ("20 × 20 × 2 mm" ≈ 79pt) overflow the CSS-padded 75pt.
  let massMax = COL_MASS_W - 2;

  if (cat.priceColumns.length > 1) {
    doc.font(FONTS.body).fontSize(ROW_FONT);
    const massText = Math.max(
      0,
      ...cat.rows.map((row) => doc.widthOfString(sanitize(row.mass))),
    );
    massW = massText > 0 ? Math.min(COL_MASS_W, massText + CELL_PAD_R) : 0;
    massMax = massW;

    doc.font(FONTS.bodySemi).fontSize(ROW_FONT);
    const priceText = cat.priceColumns.map((_, c) =>
      Math.max(
        0,
        ...cat.rows.map((row) => doc.widthOfString(row.prices[c] ?? "–")),
      ),
    );
    doc.fontSize(HEAD_FONT);
    // Narrowest a column can get: its longest unbreakable piece.
    const floorWs = headings.map((heading, c) =>
      Math.max(
        priceText[c],
        doc.widthOfString(PRICE_HEAD),
        ...heading.split(/\s+/).map((word) => doc.widthOfString(word)),
      ),
    );
    const fullWs = headings.map((heading, c) =>
      Math.max(floorWs[c], doc.widthOfString(heading)),
    );
    const gaps = (cat.priceColumns.length - 1) * PRICE_COL_GAP;
    const prodLeft = (ws: number[]) =>
      CONTENT_W -
      COL_CODE_W -
      massW -
      gaps -
      ws.reduce((sum, w) => sum + w, 0);
    priceWs = prodLeft(fullWs) >= MIN_PROD_W ? fullWs : floorWs;
  }

  const priceTotal =
    priceWs.reduce((sum, w) => sum + w, 0) +
    (priceWs.length - 1) * PRICE_COL_GAP;
  const xFirstPrice = PAGE_W - MARGIN - priceTotal;
  const xMass = xFirstPrice - massW;

  doc.font(FONTS.bodySemi).fontSize(HEAD_FONT);
  let x = xFirstPrice;
  const priceCols = priceWs.map((w, c) => {
    const col = {
      x,
      w,
      headLines: [
        PRICE_HEAD,
        ...(headings[c] ? wrapLines(doc, headings[c], w, 3) : []),
      ],
    };
    x += w + PRICE_COL_GAP;
    return col;
  });
  const headLineCount = Math.max(
    1,
    ...priceCols.map((col) => col.headLines.length),
  );

  doc.font(FONTS.body).fontSize(ROW_FONT);
  const prodMax = xMass - X_PROD - CELL_PAD_R;
  const produkt = cat.rows.map((row) =>
    wrapLines(doc, sanitize(row.produkt), prodMax, MAX_PROD_LINES),
  );

  return {
    xMass,
    massMax,
    priceCols,
    headH: headLineCount * HEAD_LINE + HEAD_RULE_H,
    produkt,
  };
}

/** Column-header row (repeats after page breaks). Returns y below it. */
function renderTableHead(
  doc: PDFKit.PDFDocument,
  y: number,
  cat: PriceListCategory,
  layout: TableLayout,
): number {
  doc.font(FONTS.bodySemi).fontSize(HEAD_FONT).fillColor(MUTED);
  const textBottom = y + layout.headH - HEAD_RULE_H;
  // Everything sits on the header's last line; price columns stack upwards.
  const textY = centerInLine(doc, textBottom - HEAD_LINE, HEAD_LINE);
  doc.text("Code", X_CODE, textY, { lineBreak: false });
  doc.text("Produkt", X_PROD, textY, { lineBreak: false });
  // A category where no row has a mass drops the floating "Mass" header
  // above the empty column.
  if (cat.rows.some((row) => row.mass)) {
    doc.text("Mass", layout.xMass, textY, { lineBreak: false });
  }
  for (const col of layout.priceCols) {
    col.headLines.forEach((line, i) => {
      const fromBottom = col.headLines.length - 1 - i;
      doc.text(line, col.x, textY - fromBottom * HEAD_LINE, {
        width: col.w,
        align: "right",
        lineBreak: false,
      });
    });
  }
  const ruleY = textBottom + 5 * PX;
  doc.rect(MARGIN, ruleY, CONTENT_W, 2 * PX).fill(HEAD_RULE);
  return ruleY + 2 * PX;
}

/** One table row with bottom hairline; prices and mass stay on its first line. */
function renderRow(
  doc: PDFKit.PDFDocument,
  y: number,
  row: PriceListRow,
  produkt: string[],
  layout: TableLayout,
): void {
  doc.font(FONTS.body).fontSize(ROW_FONT);
  const textY = centerInLine(doc, y + CELL_PAD_Y, ROW_LINE);

  doc.fillColor(MUTED);
  doc.text(row.code, X_CODE, textY, { lineBreak: false });

  doc.fillColor(TEXT);
  produkt.forEach((line, i) => {
    doc.text(line, X_PROD, textY + i * ROW_LINE, { lineBreak: false });
  });
  doc.text(
    truncateToWidth(doc, sanitize(row.mass), layout.massMax),
    layout.xMass,
    textY,
    { lineBreak: false },
  );

  doc.font(FONTS.bodySemi);
  layout.priceCols.forEach((col, c) => {
    const price = row.prices[c];
    doc.fillColor(price == null ? MUTED : TEXT);
    doc.text(price ?? "–", col.x, textY, {
      width: col.w,
      align: "right",
      lineBreak: false,
    });
  });

  const h = rowHeight(produkt.length);
  doc.rect(MARGIN, y + h - 1 * PX, CONTENT_W, 1 * PX).fill(HAIRLINE);
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
      const layout = layoutTable(doc, cat);
      const heights = layout.produkt.map((lines) => rowHeight(lines.length));
      const h2H = headingH(doc, cat);
      // Space the category needs before its first row can render.
      const leadH = SECTION_PAD + h2H + layout.headH;
      // ≤12 rows: the whole block moves to the next page if it doesn't fit.
      // Longer categories may split, but never with fewer than 3 rows on
      // either side of the break, so the lead-in requires 3 rows too.
      const keepRows =
        rows.length <= KEEP_TOGETHER_MAX_ROWS ? rows.length : MIN_SPLIT_ROWS;
      const keepH = heights
        .slice(0, keepRows)
        .reduce((sum, h) => sum + h, 0);
      if (y + leadH + keepH > CONTENT_BOTTOM) {
        y = newPage();
      }

      y += SECTION_PAD;
      if (cat.showTitle) {
        doc.font(FONTS.heading).fontSize(H2_FONT).fillColor(TEXT);
        doc.text(sanitize(cat.name), MARGIN, y, { lineBreak: false });
        y += h2H;
      }
      y = renderTableHead(doc, y, cat, layout);

      let i = 0;
      while (i < rows.length) {
        let fit = 0;
        let fitBottom = y;
        while (
          i + fit < rows.length &&
          fitBottom + heights[i + fit] <= CONTENT_BOTTOM
        ) {
          fitBottom += heights[i + fit];
          fit++;
        }
        const remaining = rows.length - i;
        if (fit < remaining) {
          // Widow rule: the continuation must receive at least 3 rows.
          if (remaining - fit < MIN_SPLIT_ROWS) {
            fit = remaining - MIN_SPLIT_ROWS;
          }
        } else {
          fit = remaining;
        }
        for (let r = i; r < i + fit; r++) {
          renderRow(doc, y, rows[r], layout.produkt[r], layout);
          y += heights[r];
        }
        i += fit;
        if (i < rows.length) {
          y = newPage();
          y = renderTableHead(doc, y, cat, layout);
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
