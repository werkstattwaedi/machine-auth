// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import PDFDocument from "pdfkit";
import { SwissQRBill } from "swissqrbill/pdf";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { resolve } from "node:path";
import { formatInvoiceNumber } from "./types";
import type { InvoiceData, InvoiceCheckout, PaymentConfig } from "./types";
import type { PricingModel } from "../types/firestore_entities";
import { generateScorReference } from "./scor_reference";

const LOGO_PATH = resolve(__dirname, "../../../assets/logo_oww.png");

const MARGIN_LEFT = 60;
const MARGIN_RIGHT = 60;
const PAGE_WIDTH = 595.28; // A4
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const INDENT = 10;

// Column layout: Description | Unit | Qty | Price/Unit | Total
const COL_TOTAL_W = 60;
const COL_PRICE_W = 60;
const COL_QTY_W = 35;
const COL_UNIT_W = 30;
const COL_DESC_W = CONTENT_WIDTH - COL_UNIT_W - COL_QTY_W - COL_PRICE_W - COL_TOTAL_W;

const COL_UNIT_X = MARGIN_LEFT + COL_DESC_W;
const COL_QTY_X = COL_UNIT_X + COL_UNIT_W;
const COL_PRICE_X = COL_QTY_X + COL_QTY_W;
const COL_TOTAL_X = COL_PRICE_X + COL_PRICE_W;

// Swiss QR bill is 105mm = ~297.6pt tall; leave that space at bottom
const QR_BILL_HEIGHT = 297.6;
const PAGE_HEIGHT = 841.89; // A4
const USABLE_HEIGHT = PAGE_HEIGHT - QR_BILL_HEIGHT - 20; // 20pt safety margin

const LOGO_WIDTH = 160;

/** Map pricing model to base unit abbreviation */
const UNIT_LABELS: Record<string, string> = {
  time: "h",
  area: "m²",
  length: "m",
  count: "Stk.",
  weight: "kg",
  direct: "",
};

const PAID_VIA_LABELS: Record<string, string> = {
  twint: " via TWINT",
  ebanking: " via E-Banking",
  cash: " bar",
};

/** Entry fee labels per user type */
const USER_TYPE_LABELS: Record<string, string> = {
  erwachsen: "Erwachsen",
  kind: "Kind (u. 18)",
  firma: "Firma",
};

function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

function formatQty(qty: number): string {
  return qty === Math.floor(qty) ? String(qty) : qty.toFixed(2);
}

function unitLabel(pricingModel?: PricingModel | null): string {
  if (!pricingModel) return "";
  return UNIT_LABELS[pricingModel] ?? "";
}

function formatDate(date: Date): string {
  return format(date, "dd.MM.yyyy HH:mm", { locale: de });
}

function formatDateOnly(date: Date): string {
  return format(date, "dd.MM.yyyy", { locale: de });
}

function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  if (y + needed > USABLE_HEIGHT) {
    doc.addPage();
    return 60;
  }
  return y;
}

/**
 * Build an invoice PDF as a Buffer.
 */
export async function buildInvoicePdf(
  data: InvoiceData,
  payment: PaymentConfig
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const doc = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      size: "A4",
      margins: { top: 60, bottom: 20, left: MARGIN_LEFT, right: MARGIN_RIGHT },
    });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.addPage();
    let y = 60;

    // --- Logo (right-aligned) + sender address ---
    // Logo PNG has ~5% left padding; offset text to visually align with logo content
    const logoX = PAGE_WIDTH - MARGIN_RIGHT - LOGO_WIDTH;
    const logoTextInset = Math.round(LOGO_WIDTH * 0.05);
    try {
      doc.image(LOGO_PATH, logoX, y, { width: LOGO_WIDTH });
    } catch {
      // Logo missing in test environment — skip
    }
    y += 45;
    doc.fontSize(8).font("Helvetica");
    const senderLines = [
      payment.recipientName,
      payment.recipientStreet,
      `${payment.recipientPostalCode} ${payment.recipientCity}`,
    ];
    for (const line of senderLines) {
      doc.text(line, logoX + logoTextInset, y, { width: LOGO_WIDTH - logoTextInset, align: "left" });
      y += 10;
    }
    y += 16;

    // --- Recipient address (left-aligned) ---
    y = ensureSpace(doc, y, 60);
    doc.fontSize(10).font("Helvetica");
    if (data.billingAddress) {
      doc.text(data.billingAddress.company, MARGIN_LEFT, y);
      y += 14;
      doc.text(data.billingAddress.street, MARGIN_LEFT, y);
      y += 14;
      doc.text(`${data.billingAddress.zip} ${data.billingAddress.city}`, MARGIN_LEFT, y);
      y += 14;
    } else {
      doc.text(data.recipientName, MARGIN_LEFT, y);
      y += 14;
    }
    y += 24;

    // --- Title ---
    y = ensureSpace(doc, y, 40);
    doc.fontSize(16).font("Helvetica-Bold");
    doc.text("Rechnung Self Checkout", MARGIN_LEFT, y);
    y += 22;
    doc.fontSize(10).font("Helvetica");
    doc.text(`Rechnungsnummer: ${formatInvoiceNumber(data.referenceNumber)}`, MARGIN_LEFT, y);
    y += 14;
    doc.text(`Datum: ${formatDateOnly(data.invoiceDate)}`, MARGIN_LEFT, y);
    y += 28;

    // --- Per-checkout sections ---
    for (const checkout of data.checkouts) {
      y = renderCheckoutSection(doc, y, checkout, data);
    }

    // --- Grand Total ---
    y = ensureSpace(doc, y, 50);
    doc.moveTo(MARGIN_LEFT, y).lineTo(PAGE_WIDTH - MARGIN_RIGHT, y).lineWidth(1).stroke();
    y += 12;
    doc.fontSize(12).font("Helvetica-Bold");
    doc.text("Total", MARGIN_LEFT, y);
    doc.text(formatAmount(data.grandTotal), COL_TOTAL_X, y, {
      width: COL_TOTAL_W,
      align: "right",
    });
    y += 18;
    doc.fontSize(8).font("Helvetica");
    doc.text("Preise inkl. Material, exkl. MWST (keine MWST)", MARGIN_LEFT, y);
    y += 20;

    const isPaid = !!data.paidAt;

    if (isPaid) {
      // --- Paid notice ---
      y = ensureSpace(doc, y, 40);
      const viaLabel = PAID_VIA_LABELS[data.paidVia ?? ""] ?? "";
      const paidDateStr = formatDateOnly(data.paidAt!);
      doc.fontSize(11).font("Helvetica-Bold");
      doc.text(`Bezahlt${viaLabel} am ${paidDateStr}`, MARGIN_LEFT, y);
      y += 16;
      doc.fontSize(9).font("Helvetica");
      doc.text("Diese Rechnung wurde bereits beglichen. Vielen Dank!", MARGIN_LEFT, y);

      addPageFooters(doc, data, doc.bufferedPageRange().count);
    } else {
      // --- Payment terms ---
      y = ensureSpace(doc, y, 30);
      doc.fontSize(9).font("Helvetica");
      doc.text("Zahlbar innert 30 Tagen. Besten Dank.", MARGIN_LEFT, y);
      y += 20;

      // --- Swiss QR Bill (added on a new page by swissqrbill) ---
      const contentPages = doc.bufferedPageRange().count;
      const qrBill = new SwissQRBill({
        currency: payment.currency as "CHF" | "EUR",
        amount: data.grandTotal,
        creditor: {
          account: payment.iban,
          name: payment.recipientName,
          address: payment.recipientStreet,
          zip: payment.recipientPostalCode,
          city: payment.recipientCity,
          country: payment.recipientCountry,
        },
        reference: generateScorReference(String(data.referenceNumber).padStart(9, "0")),
      }, { language: "DE" });
      qrBill.attachTo(doc);

      // Number only content pages, not the QR bill page
      addPageFooters(doc, data, contentPages);
    }

    doc.end();
  });
}

/**
 * Add page footers with page numbers and carry-over text.
 * @param contentPages Number of content pages (excludes QR bill page)
 */
function addPageFooters(
  doc: PDFKit.PDFDocument,
  data: InvoiceData,
  contentPages: number
): void {
  const totalPages = contentPages;
  const footerY = PAGE_HEIGHT - 40;

  for (let i = 0; i < contentPages; i++) {
    doc.switchToPage(i);

    // Page number + reference in footer (lineBreak: false to prevent auto-pagination)
    doc.fontSize(8).font("Helvetica");
    doc.text(
      `${formatInvoiceNumber(data.referenceNumber)}`,
      MARGIN_LEFT, footerY,
      { width: CONTENT_WIDTH / 2, align: "left", lineBreak: false }
    );
    doc.text(
      `Seite ${i + 1} / ${totalPages}`,
      MARGIN_LEFT + CONTENT_WIDTH / 2, footerY,
      { width: CONTENT_WIDTH / 2, align: "right", lineBreak: false }
    );

    // "Übertrag" on continuation pages (page 2+)
    if (i > 0) {
      doc.fontSize(8).font("Helvetica-Oblique");
      doc.text("Übertrag von vorheriger Seite", MARGIN_LEFT, 50, { lineBreak: false });
    }
  }
}

/** Render column headers for the item table */
function renderTableHeader(doc: PDFKit.PDFDocument, y: number): number {
  y = ensureSpace(doc, y, 20);
  doc.fontSize(8).font("Helvetica-Bold");
  doc.text("Beschreibung", MARGIN_LEFT + INDENT, y, { width: COL_DESC_W - INDENT });
  doc.text("Einh.", COL_UNIT_X, y, { width: COL_UNIT_W, align: "right" });
  doc.text("Anz.", COL_QTY_X, y, { width: COL_QTY_W, align: "right" });
  doc.text("Preis", COL_PRICE_X, y, { width: COL_PRICE_W, align: "right" });
  doc.text("Total", COL_TOTAL_X, y, { width: COL_TOTAL_W, align: "right" });
  y += 12;
  doc.moveTo(MARGIN_LEFT + INDENT, y).lineTo(PAGE_WIDTH - MARGIN_RIGHT, y).lineWidth(0.5).stroke();
  y += 4;
  return y;
}

/** Render a single item row */
function renderItemRow(
  doc: PDFKit.PDFDocument,
  y: number,
  description: string,
  unit: string,
  qty: number | null,
  unitPrice: number | null,
  totalPrice: number
): number {
  y = ensureSpace(doc, y, 14);
  doc.fontSize(9).font("Helvetica");
  doc.text(description, MARGIN_LEFT + INDENT, y, { width: COL_DESC_W - INDENT });
  if (unit) {
    doc.text(unit, COL_UNIT_X, y, { width: COL_UNIT_W, align: "right" });
  }
  if (qty !== null) {
    doc.text(formatQty(qty), COL_QTY_X, y, { width: COL_QTY_W, align: "right" });
  }
  if (unitPrice !== null) {
    doc.text(formatAmount(unitPrice), COL_PRICE_X, y, { width: COL_PRICE_W, align: "right" });
  }
  doc.text(formatAmount(totalPrice), COL_TOTAL_X, y, { width: COL_TOTAL_W, align: "right" });
  y += 14;
  return y;
}

/** Render a subtotal row */
function renderSubtotalRow(doc: PDFKit.PDFDocument, y: number, total: number): number {
  y = ensureSpace(doc, y, 14);
  doc.fontSize(9).font("Helvetica-Bold");
  doc.text("Zwischentotal", MARGIN_LEFT + INDENT, y, { width: COL_DESC_W - INDENT });
  doc.text(formatAmount(total), COL_TOTAL_X, y, { width: COL_TOTAL_W, align: "right" });
  y += 16;
  doc.font("Helvetica");
  return y;
}

function renderCheckoutSection(
  doc: PDFKit.PDFDocument,
  y: number,
  checkout: InvoiceCheckout,
  data: InvoiceData
): number {
  // Visit date header
  y = ensureSpace(doc, y, 30);
  doc.fontSize(11).font("Helvetica-Bold");
  doc.text(`Besuch vom ${formatDate(checkout.date)}`, MARGIN_LEFT, y);
  y += 20;

  // Entry fees (Nutzungsgebühren)
  if (checkout.entryFees > 0) {
    y = ensureSpace(doc, y, 20 + checkout.persons.length * 14 + 30);
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("Nutzungsgebühren", MARGIN_LEFT, y);
    y += 16;

    y = renderTableHeader(doc, y);

    for (const pf of checkout.personEntryFees) {
      const label = `${pf.name} (${USER_TYPE_LABELS[pf.userType] ?? pf.userType})`;
      y = renderItemRow(doc, y, label, "", 1, pf.fee, pf.fee);
    }
    y = renderSubtotalRow(doc, y, checkout.entryFees);
  }

  // Items grouped by workshop
  const itemsByWorkshop = groupItemsByWorkshop(checkout);
  const sortedWorkshops = Object.keys(itemsByWorkshop).sort((a, b) => {
    const orderA = data.workshops[a]?.order ?? 999;
    const orderB = data.workshops[b]?.order ?? 999;
    return orderA - orderB;
  });

  for (const workshopId of sortedWorkshops) {
    const items = itemsByWorkshop[workshopId];
    const workshopLabel = data.workshops[workshopId]?.label ?? workshopId;

    y = ensureSpace(doc, y, 20 + items.length * 14 + 30);
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text(workshopLabel, MARGIN_LEFT, y);
    y += 16;

    y = renderTableHeader(doc, y);

    let workshopTotal = 0;
    for (const item of items) {
      const unit = unitLabel(item.pricingModel);
      y = renderItemRow(doc, y, item.description, unit, item.quantity, item.unitPrice, item.totalPrice);
      workshopTotal += item.totalPrice;
    }
    y = renderSubtotalRow(doc, y, workshopTotal);
  }

  // Tip
  if (checkout.tip > 0) {
    y = ensureSpace(doc, y, 30);
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("Trinkgeld", MARGIN_LEFT, y);
    y += 16;
    doc.font("Helvetica").fontSize(9);
    doc.text(formatAmount(checkout.tip), COL_TOTAL_X, y, {
      width: COL_TOTAL_W,
      align: "right",
    });
    y += 18;
  }

  return y;
}

function groupItemsByWorkshop(
  checkout: InvoiceCheckout
): Record<string, InvoiceCheckout["items"]> {
  const groups: Record<string, InvoiceCheckout["items"]> = {};
  for (const item of checkout.items) {
    const ws = item.workshop;
    if (!groups[ws]) groups[ws] = [];
    groups[ws].push(item);
  }
  return groups;
}

