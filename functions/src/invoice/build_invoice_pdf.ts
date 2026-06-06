// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import PDFDocument from "pdfkit";
import { SwissQRBill } from "swissqrbill/pdf";
import { resolve } from "node:path";
import { formatWorkshopDateTime } from "../util/workshop_timezone";
import { formatBillReference } from "./types";
import type { InvoiceData, InvoiceCheckout, PaymentConfig } from "./types";
import type { PricingModel } from "../types/firestore_entities";
import { generateScorReference } from "./scor_reference";
import {
  partitionMembership,
  usageDiscount,
  isMachineItem,
  USAGE_DISCOUNT_LABELS,
  type UsageType,
} from "@oww/shared";

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
  sla: "l",
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
  return formatWorkshopDateTime(date, "dd.MM.yyyy HH:mm");
}

function formatDateOnly(date: Date): string {
  return formatWorkshopDateTime(date, "dd.MM.yyyy");
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
    // Standard Swiss invoice convention: full postal address block. For
    // firma the company line identifies the recipient and stands alone.
    // For a registered (logged-in) non-firma user we render the person
    // name above their stored street/zip/city (issue #269). Anonymous
    // walk-ins have no recipient block — the person already appears in
    // the Nutzungsgebühren table further down, and a stray name above
    // the title looked like a layout glitch (issue #269 review).
    y = ensureSpace(doc, y, 60);
    doc.fontSize(10).font("Helvetica");
    if (data.billingAddress) {
      const { company, street, zip, city } = data.billingAddress;
      if (company) {
        doc.text(company, MARGIN_LEFT, y);
        y += 14;
      } else {
        doc.text(data.recipientName, MARGIN_LEFT, y);
        y += 14;
      }
      doc.text(street, MARGIN_LEFT, y);
      y += 14;
      doc.text(`${zip} ${city}`, MARGIN_LEFT, y);
      y += 14;
    }
    y += 24;

    // --- Title ---
    // "Beleg" is the per-visit Sammelrechnung record (issue #245); the
    // QR-bill is emitted as the aggregated monthly Sammelrechnung. For a
    // multi-checkout invoice (the monthlyBillRun output) append the
    // earliest-checkout's month so the customer reads "Sammelrechnung —
    // Mai 2026" rather than the bare title.
    //
    // Catch-up runs (a stale prior-month Beleg swept into a later
    // month's aggregation — see monthly_bill_run.ts self-heal docs)
    // produce a multi-month invoice. The title shows the earliest
    // visit's month, which is honest but understates the range. Acceptable
    // because: (a) the per-checkout sections inside the PDF list the real
    // dates; (b) catch-up runs only happen after a cron failure, which
    // is rare enough not to justify a "Mai–Juni 2026" label.
    const isBeleg = data.kind === "beleg";
    let title: string;
    if (isBeleg) {
      title = "Beleg Self Checkout";
    } else if (data.checkouts.length > 1) {
      const earliest = data.checkouts.reduce(
        (a, b) => (a.date.getTime() < b.date.getTime() ? a : b),
      );
      title = `Sammelrechnung — ${formatWorkshopDateTime(earliest.date, "MMMM yyyy")}`;
    } else {
      // Single-checkout aggregated invoice (a member who visited once in
      // the prior month). Keeps the standard "Rechnung Self Checkout"
      // title rather than a "Sammelrechnung" label — a single line item
      // doesn't read as an aggregation, and the per-visit Beleg the
      // member received earlier already mentioned the upcoming
      // Sammelrechnung. Accounting treats it as a regular Rechnung.
      title = "Rechnung Self Checkout";
    }
    y = ensureSpace(doc, y, 40);
    doc.fontSize(16).font("Helvetica-Bold");
    doc.text(title, MARGIN_LEFT, y);
    y += 22;
    doc.fontSize(10).font("Helvetica");
    const numberLabel = isBeleg ? "Belegnummer" : "Rechnungsnummer";
    doc.text(
      `${numberLabel}: ${formatBillReference(data.referenceNumber, data.kind)}`,
      MARGIN_LEFT,
      y,
    );
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
    doc.text("keine MWST", MARGIN_LEFT, y);
    y += 20;

    const isPaid = !!data.paidAt;
    // Issue #237: a zero-amount "free" bill (e.g. Interne Nutzung) is
    // recorded for the books but has no payable balance — replace the
    // QR-bill section and the regular "Bezahlt via …" notice with a
    // dedicated nothing-to-pay block.
    const isFreeZero =
      data.paidVia === "free" && data.grandTotal === 0;

    if (isFreeZero) {
      // --- Nothing-to-pay notice (zero-amount bill) ---
      y = ensureSpace(doc, y, 40);
      doc.fontSize(11).font("Helvetica-Bold");
      doc.text("Keine Zahlung erforderlich", MARGIN_LEFT, y);
      y += 16;
      doc.fontSize(9).font("Helvetica");
      doc.text(
        `Für diesen Besuch ist nichts zu bezahlen (Betrag ${data.currency} 0.00).`,
        MARGIN_LEFT,
        y,
      );

      addPageFooters(doc, data, doc.bufferedPageRange().count);
    } else if (isPaid) {
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
    } else if (data.paymentMethod === "twint") {
      // --- TWINT-selected notice (issue #251) ---
      // The user said TWINT in the UI; we have no bank-side confirmation
      // yet, so the PDF doesn't claim "Bezahlt". The QR-bill payment slip
      // is intentionally omitted — folks who already paid via TWINT in
      // the app shouldn't think they need to pay again. The email
      // surfaces the kasse@ contact for the "TWINT didn't go through"
      // recovery path.
      y = ensureSpace(doc, y, 40);
      doc.fontSize(11).font("Helvetica-Bold");
      doc.text("Zahlweise: TWINT", MARGIN_LEFT, y);
      y += 16;
      doc.fontSize(9).font("Helvetica");
      doc.text(
        "Du hast deinen Self-Checkout mit TWINT abgeschlossen. Falls die Zahlung nicht durchgegangen ist, melde dich bitte bei der Kasse.",
        MARGIN_LEFT,
        y,
        { width: CONTENT_WIDTH },
      );

      addPageFooters(doc, data, doc.bufferedPageRange().count);
    } else if (data.paymentMethod === "monthly") {
      // --- Sammelrechnung notice (issue #251) ---
      // Goes onto next month's Sammelrechnung — no QR slip needed.
      y = ensureSpace(doc, y, 40);
      doc.fontSize(11).font("Helvetica-Bold");
      doc.text("Zahlweise: Sammelrechnung", MARGIN_LEFT, y);
      y += 16;
      doc.fontSize(9).font("Helvetica");
      doc.text(
        "Dieser Betrag wird der nächsten Sammelrechnung am 1. des nächsten Monats hinzugefügt.",
        MARGIN_LEFT,
        y,
        { width: CONTENT_WIDTH },
      );

      addPageFooters(doc, data, doc.bufferedPageRange().count);
    } else {
      // --- Payment terms (rechnung or pre-ack default) ---
      y = ensureSpace(doc, y, 30);
      doc.fontSize(9).font("Helvetica");
      doc.text("Zahlbar innert 30 Tagen. Besten Dank.", MARGIN_LEFT, y);
      y += 20;

      // --- Swiss QR Bill (added on a new page by swissqrbill) ---
      const contentPages = doc.bufferedPageRange().count;
      // Issue #269: pre-fill the "Zahlbar durch" debtor section when we
      // have a billing address. Anonymous walk-ins (no billingAddress)
      // intentionally omit the debtor so the printed QR bill leaves the
      // box empty for handwriting. Country is hardcoded "CH" — the
      // billingAddress shape doesn't carry a country and the whole
      // product is Swiss-only (creditor.country is hardcoded upstream).
      const billingAddr = data.billingAddress;
      const debtor = billingAddr
        ? {
            // Firma → use the company line; registered users → person name.
            name: billingAddr.company || data.recipientName,
            address: billingAddr.street,
            zip: billingAddr.zip,
            city: billingAddr.city,
            country: "CH",
          }
        : undefined;
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
        ...(debtor && { debtor }),
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
      `${formatBillReference(data.referenceNumber, data.kind)}`,
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

/**
 * Render a per-section discount row spelling out *why* an amount was
 * waived (issue #284). Marco's bill silently showed full prices but a 0.00
 * total — this makes the waiver explicit on the section it applies to,
 * e.g. "Freiwilligengruppe: keine Maschinengebühren   -25.00".
 *
 * `waived` is a positive amount; it's rendered as a negative figure.
 */
function renderDiscountRow(
  doc: PDFKit.PDFDocument,
  y: number,
  label: string,
  waived: number,
): number {
  y = ensureSpace(doc, y, 14);
  doc.fontSize(9).font("Helvetica-Oblique");
  doc.text(label, MARGIN_LEFT + INDENT, y, { width: COL_DESC_W + COL_UNIT_W + COL_QTY_W + COL_PRICE_W - INDENT });
  doc.text(`-${formatAmount(waived)}`, COL_TOTAL_X, y, { width: COL_TOTAL_W, align: "right" });
  y += 14;
  doc.font("Helvetica");
  return y;
}

/** Round to centimes for display sums. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function renderCheckoutSection(
  doc: PDFKit.PDFDocument,
  y: number,
  checkout: InvoiceCheckout,
  data: InvoiceData
): number {
  // Per-usage-type discount multipliers (issue #284). Section amounts in
  // InvoiceCheckout are RAW (pre-discount); the multipliers say how much of
  // each section is actually billed. `regular` has all-1 multipliers, so
  // no discount rows are rendered for it.
  const discount = usageDiscount(checkout.usageType as UsageType);
  const discountLabel = USAGE_DISCOUNT_LABELS[checkout.usageType as UsageType];

  // Visit date header
  y = ensureSpace(doc, y, 30);
  doc.fontSize(11).font("Helvetica-Bold");
  doc.text(`Besuch vom ${formatDate(checkout.date)}`, MARGIN_LEFT, y);
  y += 20;

  // Issue #262/#263: break the Vereinsmitgliedschaft SKU out of the workshop
  // groups into a dedicated "Mitgliedschaft" block at the very top of the
  // checkout's items. Marco's complaint was that the membership read as a
  // "Diverses" material purchase. When no membership SKU is configured (or
  // none is present) the partition leaves `otherItems` as the full set and
  // the workshop loop renders exactly as before.
  //
  // Computed here (before Nutzungsgebühren) because the membership-only case
  // suppresses the Nutzungsgebühren block — see below.
  const { membershipItems, otherItems } = partitionMembership(checkout.items, {
    membershipCatalogId: data.membershipCatalogId,
  });

  // Issue #262/#263: a membership-only checkout (membership item present, no
  // other items, no entry fee) suppresses the Nutzungsgebühren block, mirroring
  // the checkout summary's `membershipOnly` view (step-checkout.tsx) which hides
  // the three regular buckets and shows only the Vereinsmitgliedschaft section.
  // CRITICAL: this is scoped to membership-only — a non-membership zero-fee bill
  // (e.g. interne Nutzung, materialbezug without a membership) must STILL render
  // Nutzungsgebühren so the recipient is identified (issue #269).
  //
  // `checkout.entryFees` is the RAW (standard) fee under issue #284, so a
  // waived usage type (materialbezug, Freiwilligengruppe, intern) has a
  // non-zero raw fee. Gate on the NET entry fee (raw × the discount
  // multiplier) — that is what "no entry fee billed" actually means.
  const isMembershipOnly =
    membershipItems.length > 0 &&
    otherItems.length === 0 &&
    round2(checkout.entryFees * discount.entryFee) === 0;

  // Nutzungsgebühren (entry fees). Always rendered when persons are
  // present so the invoice shows who attended — even for usage types
  // where the per-person fee is 0 (e.g. interne Nutzung, materialbezug).
  // See issue #269: Marco's bill omitted the user line because the fee
  // was zero, leaving the recipient unclear. The membership-only carve-out
  // above is the one exception.
  if (checkout.personEntryFees.length > 0 && !isMembershipOnly) {
    y = ensureSpace(doc, y, 20 + checkout.persons.length * 14 + 30);
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("Nutzungsgebühren", MARGIN_LEFT, y);
    y += 16;

    y = renderTableHeader(doc, y);

    for (const pf of checkout.personEntryFees) {
      // Issue #268: a person who already paid the daily usage fee earlier
      // the same business day is billed 0 here — spell out *why* so the
      // zero doesn't read as an error.
      const baseLabel = `${pf.name} (${USER_TYPE_LABELS[pf.userType] ?? pf.userType})`;
      const label = pf.waivedToday
        ? `${baseLabel} — heute bereits abgerechnet`
        : baseLabel;
      y = renderItemRow(doc, y, label, "", 1, pf.fee, pf.fee);
    }
    y = renderSubtotalRow(doc, y, checkout.entryFees);
    // Waive entry fees per the usage-type discount (e.g. Freiwilligengruppe,
    // interne Nutzung, Hangenmoos). ermaessigt waives half.
    const entryWaived = round2(checkout.entryFees * (1 - discount.entryFee));
    if (entryWaived > 0 && discountLabel) {
      y = renderDiscountRow(
        doc,
        y,
        `${discountLabel}: Eintritt ${
          discount.entryFee === 0 ? "wird nicht verrechnet" : "ermässigt"
        }`,
        entryWaived,
      );
    }
  }

  if (membershipItems.length > 0) {
    y = renderItemGroup(doc, y, "Mitgliedschaft", membershipItems);
  }

  // Items grouped by workshop (membership items already removed).
  const itemsByWorkshop = groupItemsByWorkshop(otherItems);
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
    let machineRaw = 0;
    let materialRaw = 0;
    for (const item of items) {
      if (item.pricingModel === "sla") {
        // SLA has two pricing axes (resin volume + layer count); the single
        // quantity × unitPrice column pair can't express that without reading
        // as an arithmetic falsehood. Render the axes in the description and
        // skip the middle columns — only totalPrice stays.
        const axes = (item.formInputs ?? [])
          .map((fi) => `${formatQty(fi.quantity)} ${fi.unit}`)
          .join(" · ");
        const desc = axes ? `${item.description} (${axes})` : item.description;
        y = renderItemRow(doc, y, desc, "", null, null, item.totalPrice);
      } else {
        const unit = unitLabel(item.pricingModel);
        y = renderItemRow(doc, y, item.description, unit, item.quantity, item.unitPrice, item.totalPrice);
      }
      workshopTotal += item.totalPrice;
      // Split by section so the right discount multiplier applies:
      // type "machine" = machine usage, everything else = material.
      if (isMachineItem(item)) machineRaw += item.totalPrice;
      else materialRaw += item.totalPrice;
    }
    y = renderSubtotalRow(doc, y, workshopTotal);

    // Per-section waivers within the workshop (issue #284). volunteering and
    // intern waive machine usage; intern also waives material.
    const machineWaived = round2(machineRaw * (1 - discount.machine));
    if (machineWaived > 0 && discountLabel) {
      y = renderDiscountRow(
        doc,
        y,
        `${discountLabel}: keine Maschinengebühren`,
        machineWaived,
      );
    }
    const materialWaived = round2(materialRaw * (1 - discount.material));
    if (materialWaived > 0 && discountLabel) {
      y = renderDiscountRow(
        doc,
        y,
        `${discountLabel}: kein Materialbezug verrechnet`,
        materialWaived,
      );
    }
  }

  // Donation (label: "Spende"). The underlying field is still named `tip`
  // for back-compat with already-issued bills and the persisted
  // `checkout.summary.tip` shape; only the rendered label changed — see
  // issue #250.
  if (checkout.tip > 0) {
    y = ensureSpace(doc, y, 30);
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("Spende", MARGIN_LEFT, y);
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
  items: InvoiceCheckout["items"]
): Record<string, InvoiceCheckout["items"]> {
  const groups: Record<string, InvoiceCheckout["items"]> = {};
  for (const item of items) {
    const ws = item.workshop;
    if (!groups[ws]) groups[ws] = [];
    groups[ws].push(item);
  }
  return groups;
}

/**
 * Render a labeled group of checkout items: a bold heading, the column
 * header, one row per item (SLA items render their pricing axes inline),
 * and a Zwischentotal. Shared by the per-workshop groups and the
 * Vereinsmitgliedschaft block (issue #262/#263) so they look identical.
 */
function renderItemGroup(
  doc: PDFKit.PDFDocument,
  y: number,
  label: string,
  items: InvoiceCheckout["items"]
): number {
  y = ensureSpace(doc, y, 20 + items.length * 14 + 30);
  doc.fontSize(10).font("Helvetica-Bold");
  doc.text(label, MARGIN_LEFT, y);
  y += 16;

  y = renderTableHeader(doc, y);

  let groupTotal = 0;
  for (const item of items) {
    if (item.pricingModel === "sla") {
      // SLA has two pricing axes (resin volume + layer count); the single
      // quantity × unitPrice column pair can't express that without reading
      // as an arithmetic falsehood. Render the axes in the description and
      // skip the middle columns — only totalPrice stays.
      const axes = (item.formInputs ?? [])
        .map((fi) => `${formatQty(fi.quantity)} ${fi.unit}`)
        .join(" · ");
      const desc = axes ? `${item.description} (${axes})` : item.description;
      y = renderItemRow(doc, y, desc, "", null, null, item.totalPrice);
    } else {
      const unit = unitLabel(item.pricingModel);
      y = renderItemRow(doc, y, item.description, unit, item.quantity, item.unitPrice, item.totalPrice);
    }
    groupTotal += item.totalPrice;
  }
  return renderSubtotalRow(doc, y, groupTotal);
}

