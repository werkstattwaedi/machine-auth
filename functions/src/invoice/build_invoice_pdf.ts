// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import PDFDocument from "pdfkit";
import { SwissQRBill } from "swissqrbill/pdf";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { resolve } from "node:path";
import type { InvoiceData, InvoiceCheckout, PaymentConfig } from "./types";

const LOGO_PATH = resolve(__dirname, "../../assets/logo_oww.png");

const MARGIN_LEFT = 60;
const MARGIN_RIGHT = 60;
const PAGE_WIDTH = 595.28; // A4
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const COL_PRICE_WIDTH = 70;
const COL_DESC_WIDTH = CONTENT_WIDTH - COL_PRICE_WIDTH;

// Swiss QR bill is 105mm = ~297.6pt tall; leave that space at bottom
const QR_BILL_HEIGHT = 297.6;
const PAGE_HEIGHT = 841.89; // A4
const USABLE_HEIGHT = PAGE_HEIGHT - QR_BILL_HEIGHT - 20; // 20pt safety margin

/** Entry fee labels per user type */
const USER_TYPE_LABELS: Record<string, string> = {
  erwachsen: "Erwachsen",
  kind: "Kind (u. 18)",
  firma: "Firma",
};

function formatCHF(amount: number): string {
  return `CHF ${amount.toFixed(2)}`;
}

function formatDate(date: Date): string {
  return format(date, "dd.MM.yyyy HH:mm", { locale: de });
}

function formatDateOnly(date: Date): string {
  return format(date, "dd.MM.yyyy", { locale: de });
}

/**
 * Ensure there's enough vertical space; if not, add a new page and return the new Y.
 */
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
      size: "A4",
      margins: { top: 60, bottom: 60, left: MARGIN_LEFT, right: MARGIN_RIGHT },
    });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.addPage();
    let y = 60;

    // --- Logo ---
    try {
      doc.image(LOGO_PATH, MARGIN_LEFT, y, { width: 120 });
    } catch {
      // Logo missing in test environment — skip
    }
    y += 70;

    // --- Recipient address ---
    y = ensureSpace(doc, y, 80);
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
    y += 20;

    // --- Title ---
    y = ensureSpace(doc, y, 40);
    doc.fontSize(16).font("Helvetica-Bold");
    doc.text("Rechnung", MARGIN_LEFT, y);
    y += 22;
    doc.fontSize(10).font("Helvetica");
    doc.text(`Referenz: ${data.referenceNumber}`, MARGIN_LEFT, y);
    y += 14;
    doc.text(`Datum: ${formatDateOnly(data.invoiceDate)}`, MARGIN_LEFT, y);
    y += 28;

    // --- Per-checkout sections ---
    for (const checkout of data.checkouts) {
      y = renderCheckoutSection(doc, y, checkout, data);
    }

    // --- Grand Total ---
    y = ensureSpace(doc, y, 50);
    // Separator line
    doc.moveTo(MARGIN_LEFT, y).lineTo(PAGE_WIDTH - MARGIN_RIGHT, y).lineWidth(1).stroke();
    y += 12;
    doc.fontSize(12).font("Helvetica-Bold");
    doc.text("Total", MARGIN_LEFT, y);
    doc.text(formatCHF(data.grandTotal), MARGIN_LEFT + COL_DESC_WIDTH, y, {
      width: COL_PRICE_WIDTH,
      align: "right",
    });
    y += 18;
    doc.fontSize(8).font("Helvetica");
    doc.text("Preise inkl. Material, exkl. MWST (keine MWST)", MARGIN_LEFT, y);
    y += 20;

    // --- Swiss QR Bill ---
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
      reference: data.referenceNumber,
    }, { language: "DE" });
    qrBill.attachTo(doc);

    doc.end();
  });
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
    y = ensureSpace(doc, y, 20 + checkout.persons.length * 14);
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("Nutzungsgebühren", MARGIN_LEFT, y);
    y += 16;
    doc.font("Helvetica").fontSize(9);

    for (const person of checkout.persons) {
      y = ensureSpace(doc, y, 14);
      const feePerPerson = calculatePersonEntryFee(person.userType, checkout);
      const label = `${person.name} (${USER_TYPE_LABELS[person.userType] ?? person.userType})`;
      doc.text(label, MARGIN_LEFT + 10, y, { width: COL_DESC_WIDTH - 10 });
      doc.text(formatCHF(feePerPerson), MARGIN_LEFT + COL_DESC_WIDTH, y, {
        width: COL_PRICE_WIDTH,
        align: "right",
      });
      y += 14;
    }
    // Entry fees subtotal
    y = ensureSpace(doc, y, 14);
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Zwischentotal", MARGIN_LEFT + 10, y, { width: COL_DESC_WIDTH - 10 });
    doc.text(formatCHF(checkout.entryFees), MARGIN_LEFT + COL_DESC_WIDTH, y, {
      width: COL_PRICE_WIDTH,
      align: "right",
    });
    y += 18;
    doc.font("Helvetica");
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

    y = ensureSpace(doc, y, 20 + items.length * 14);
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text(workshopLabel, MARGIN_LEFT, y);
    y += 16;
    doc.font("Helvetica").fontSize(9);

    let workshopTotal = 0;
    for (const item of items) {
      y = ensureSpace(doc, y, 14);
      doc.text(item.description, MARGIN_LEFT + 10, y, { width: COL_DESC_WIDTH - 10 });
      doc.text(formatCHF(item.totalPrice), MARGIN_LEFT + COL_DESC_WIDTH, y, {
        width: COL_PRICE_WIDTH,
        align: "right",
      });
      workshopTotal += item.totalPrice;
      y += 14;
    }

    // Workshop subtotal
    y = ensureSpace(doc, y, 14);
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Zwischentotal", MARGIN_LEFT + 10, y, { width: COL_DESC_WIDTH - 10 });
    doc.text(formatCHF(workshopTotal), MARGIN_LEFT + COL_DESC_WIDTH, y, {
      width: COL_PRICE_WIDTH,
      align: "right",
    });
    y += 18;
    doc.font("Helvetica");
  }

  // Tip
  if (checkout.tip > 0) {
    y = ensureSpace(doc, y, 30);
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("Trinkgeld", MARGIN_LEFT, y);
    y += 16;
    doc.font("Helvetica").fontSize(9);
    doc.text(formatCHF(checkout.tip), MARGIN_LEFT + COL_DESC_WIDTH, y, {
      width: COL_PRICE_WIDTH,
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

/**
 * Calculate entry fee for a single person based on the checkout's total entry fees
 * and person distribution. Simple proportional split.
 */
function calculatePersonEntryFee(
  _userType: string,
  checkout: InvoiceCheckout
): number {
  if (checkout.persons.length === 0) return 0;
  // Entry fees are pre-computed per checkout; distribute evenly for display
  // (actual fee calculation happens in the cloud function)
  return checkout.entryFees / checkout.persons.length;
}
