// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { isPaidDuringCheckout } from "@oww/shared";
import {
  CheckoutPersonEntity,
  CheckoutItemEntity,
  PaymentMethod,
  PaidVia,
  UsageType,
} from "../types/firestore_entities";

export type BillKind = "invoice" | "beleg";

// Origin discriminator (issue #323). "checkout" = a normal Self-Checkout
// visit bill (the default — a missing value is treated as "checkout" so
// legacy docs migrate-free). "membership-renewal" = a bill auto-issued by
// the daily renewalInvoicer cron for an expiring membership.
export type BillSource = "checkout" | "membership-renewal";

/**
 * Who committed a bill's payment method: the person (`user`), the server
 * on nobody's word (`auto`: a CHF 0 bill, the monthly Sammelrechnung, a
 * renewal invoice, a correction, and — before #757 — the overnight job),
 * or the payment terminal's confirmed payment (`terminal`, ADR-0051 — the
 * bill is born paid).
 */
export type BillAckSource = "user" | "auto" | "terminal";

export interface BillEntity {
  userId: DocumentReference;
  checkouts: DocumentReference[];
  referenceNumber: number;
  amount: number;
  currency: string;
  storagePath: string | null;
  created: Timestamp;
  paidAt: Timestamp | null;
  paidVia: PaidVia | null;
  pdfGeneratedAt: Timestamp | null;
  emailSentAt: Timestamp | null;
  // Set once by trySendEmail when no recipient resolves (no account-holder
  // e-mail and no guest e-mail, #651) so the hourly retry stops re-trying
  // and re-logging. Legacy docs lack the field → not skipped. Clear it
  // manually to re-arm the send (e.g. after adding an e-mail to a child
  // account).
  emailSkippedReason?: "no-recipient" | null;
  // The "I'll pay this" ack (BillAckSource). Server-only, written when the
  // bill is minted — by the close (source: "user"), a Wallee-confirmed
  // terminal payment ("terminal") or the server itself ("auto"). The email
  // and membership-activation triggers key off a bill born committed
  // (`isCommittedAtClose`), or off this transitioning from null to set on
  // a legacy bill nobody committed.
  paymentMethodConfirmationTime: Timestamp | null;
  paymentMethodConfirmationSource: BillAckSource | null;
  // The Wallee transaction that paid the bill at the terminal, and the
  // cardholder receipt text Wallee rendered for it (masked card number,
  // auth code — printed on the Quittung). Server-only; null otherwise and
  // on legacy docs (absent).
  walleeTransactionId?: number | null;
  walleeReceiptText?: string | null;
  // "invoice" = real, payable QR-bill. "beleg" = per-visit record for a
  // member who picked Sammelrechnung — the QR-bill is emitted as the
  // aggregated monthly invoice (`aggregatedIntoBillRef`) on the 1st.
  // Missing `kind` is treated as "invoice" so legacy docs migrate-free.
  kind?: BillKind;
  // Set on a `kind: "beleg"` once monthlyBillRun has folded it into a
  // monthly `kind: "invoice"`. Re-runs skip Belege where this is set.
  aggregatedIntoBillRef?: DocumentReference | null;
  // Origin discriminator (issue #323). Missing value is treated as
  // "checkout" so legacy docs migrate-free.
  source?: BillSource;

  // --- Cancellation / corrected re-issue (ADR-0042). All server-only. ---
  // A cancelled bill stays in place as the as-sent accounting record; the
  // admin UIs derive "storniert" from `cancelledAt`. Legacy docs lack these
  // fields entirely, so never filter on `== null` — check client-side.
  cancelledAt?: Timestamp | null;
  cancelledBy?: string | null; // admin uid
  cancellationReason?: string | null;
  // Forward / backward links of a corrected re-issue. The replacement keeps
  // the base number with the next revision digit (see formatInvoiceNumber).
  supersededByBillRef?: DocumentReference | null;
  supersedesBillRef?: DocumentReference | null;
  correctionReason?: string | null;
  // Sammelrechnung revision only: the replacement Belege minted in the same
  // commit. Their PDFs ride along as attachments of the revision's mail, so
  // the Belege themselves never send. Stored (not derived) because Belege
  // corrected in an earlier revision are re-pointed to the latest one and
  // would otherwise be attached again.
  correctedBillRefs?: DocumentReference[] | null;
  // Optimistic lock for the "Rechnung storniert" notice (pure cancellation
  // without replacement). Same convention as `emailSentAt`.
  cancellationNoticeSentAt?: Timestamp | null;
  // Last writer (admin uid) — read by the `auditBills` trigger as actor.
  modifiedBy?: string | null;
  modifiedAt?: Timestamp | null;
}

/** Per-person entry fee for display on the invoice */
export interface PersonEntryFee {
  name: string;
  userType: string;
  /** Standard (RAW) fee before the usage-type discount; 0 when waived today. */
  fee: number;
  /**
   * The person's own usage type (issue #605) — `person.usageType ??
   * checkout.usageType` for checkouts from before it.
   */
  usageType: UsageType;
  /** What the person pays: `fee` × their usage type's entry-fee multiplier. */
  netFee: number;
  /**
   * True when the entry fee was waived because the person already paid the
   * daily usage fee earlier the same Zurich business day (issue #268). The
   * renderer annotates the row instead of charging again.
   */
  waivedToday?: boolean;
}

/** Assembled data for a single checkout within an invoice */
export interface InvoiceCheckout {
  date: Date;
  /** The visit's type: decides machine time and material. */
  usageType: UsageType;
  persons: CheckoutPersonEntity[];
  personEntryFees: PersonEntryFee[];
  items: CheckoutItemEntity[];
  workshopsVisited: string[];
  entryFees: number;
  machineCost: number;
  materialCost: number;
  tip: number;
  totalPrice: number;
}

/** Workshop display info from config/pricing */
export interface WorkshopInfo {
  label: string;
  order: number;
}

/** Full data needed to render an invoice PDF */
export interface InvoiceData {
  referenceNumber: number;
  invoiceDate: Date;
  /**
   * Postal address rendered in the top-left recipient block (Swiss invoice
   * convention). When `company` is empty the company line is skipped — for a
   * registered (logged-in) non-firma user we render their `recipientName`
   * plus street/zip/city. For a firma checkout `company` carries the
   * company name and identifies the recipient. `null` when no address is
   * known (guest, or member without a stored address): the block then
   * consists of `recipientName` alone and the QR-bill debtor stays empty
   * (issue #658). Resolved by `resolve_recipient.ts`.
   */
  billingAddress: {
    company: string;
    street: string;
    zip: string;
    city: string;
  } | null;
  recipientName: string;
  checkouts: InvoiceCheckout[];
  workshops: Record<string, WorkshopInfo>;
  grandTotal: number;
  currency: string;
  paidAt?: Date | null;
  paidVia?: PaidVia | null;
  /** Wallee's cardholder receipt of a terminal payment (bill `walleeReceiptText`). */
  terminalReceiptText?: string | null;
  /**
   * The payment method committed on the checkout (null for a CHF 0 bill or
   * a legacy one nobody committed). Gates the QR
   * payment slip: only rendered for `rechnung` or null — methods paid
   * during the checkout and the Sammelrechnung get a method-specific
   * notice instead, so users don't think they need to pay via QR after
   * already settling or having it routed to their monthly bill.
   */
  paymentMethod?: PaymentMethod | null;
  /**
   * Discriminator for the rendered document. "invoice" → "Rechnung
   * RE-XXXXXX" with QR slip; "beleg" → "Beleg BL-XXXXXX" without QR
   * slip (a record of one Sammelrechnung-acked visit).
   */
  kind?: BillKind;
  /**
   * Bill origin (issue #323). "membership-renewal" switches the PDF into
   * its renewal rendering: "Rechnung Mitgliederbeitrag" title, a short
   * Vorstand letter instead of the "Besuch vom …" visit header, and a
   * sign-off. Missing/"checkout" renders the standard Self-Checkout PDF.
   */
  source?: BillSource;
  /**
   * Vereinsmitgliedschaft catalog doc id (issue #262/#263), resolved once
   * via `config/catalog-references` → `membership`. When set, items whose
   * `catalogId` matches are rendered under a dedicated "Mitgliedschaft"
   * heading at the top of each checkout section instead of bleeding into
   * the (legacy) `diverses` workshop group. `null` when no membership SKU
   * is configured — the renderer then behaves exactly as before. Kept on
   * `InvoiceData` (not per-checkout) because it's an invoice-wide constant
   * and the renderer stays pure (no Firestore reads).
   */
  membershipCatalogId?: string | null;
  /**
   * Set on a corrected re-issue (ADR-0042): the bill this document
   * replaces. Rendered as a bold "ersetzt … vom … Grund: …" paragraph under
   * the date line. `reference` is the already-formatted number of the
   * superseded bill (e.g. "RE-4200001").
   */
  supersedes?: { reference: string; date: Date; reason: string } | null;
}


/**
 * Bill numbering (ADR-0042): `referenceNumber = base × 10 + d`, where `d`
 * (0–9) is the revision digit — 0 for an original, 1 for the first
 * corrected re-issue, and so on. The base is the sequential counter value
 * from `config/billing.nextBillNumber`. Keeping the digit *inside* the
 * stored number means the SCOR payload, every Map keyed on the number and
 * the "one bill doc per number" invariant all keep working unchanged;
 * only the formatters below know about the split. Legacy numbers were
 * shifted ×10 once by `scripts/migrate-bill-numbers.ts`. Mirrored in
 * `web/modules/lib/format.ts`.
 */
export const BILL_REVISION_RADIX = 10;
/** Highest revision digit — a bill can be corrected at most 9 times. */
export const MAX_BILL_REVISION_DIGIT = BILL_REVISION_RADIX - 1;

/** Sequential base number, e.g. 42000011 → 4200001. */
export function billBaseNumber(referenceNumber: number): number {
  return Math.floor(referenceNumber / BILL_REVISION_RADIX);
}

/**
 * Version count: 1 for an original, 2 for the first correction, … e.g.
 * 42000011 → 2. Used for the revision cap; the printed suffix is the digit.
 */
export function billRevision(referenceNumber: number): number {
  return (referenceNumber % BILL_REVISION_RADIX) + 1;
}

function formatBillNumber(prefix: "RE" | "BL", n: number): string {
  const base = String(billBaseNumber(n)).padStart(6, "0");
  // The printed suffix IS the stored digit, so the number on the document
  // and the last digit of its QR payload always agree (042000151 ↔
  // RE-4200015-1). billRevision() is the version count, not the suffix.
  const digit = n % BILL_REVISION_RADIX;
  return digit > 0 ? `${prefix}-${base}-${digit}` : `${prefix}-${base}`;
}

/**
 * Format an invoice reference number for display: 42000010 → "RE-4200001",
 * 42000011 → "RE-4200001-1" (first correction).
 */
export function formatInvoiceNumber(n: number): string {
  return formatBillNumber("RE", n);
}

/** Format a Beleg reference number for display: 42000010 → "BL-4200001". */
export function formatBelegNumber(n: number): string {
  return formatBillNumber("BL", n);
}

/** Format a bill's reference number using its `kind`. */
export function formatBillReference(
  n: number,
  kind: BillKind | undefined,
): string {
  return kind === "beleg" ? formatBelegNumber(n) : formatInvoiceNumber(n);
}

/**
 * Human filename prefix for a bill PDF (download + email attachment).
 * Mirrors the PDF title logic in build_invoice_pdf: a Beleg is "Beleg",
 * an invoice paid during the checkout renders as a receipt ("Quittung" —
 * issue #426),
 * everything else — including the aggregated Sammelrechnung, whose
 * checkout still records paymentMethod "monthly" — is a payable
 * "Rechnung". Keeping the filename in sync with the title inside the PDF
 * is the same contract issue #405 established for Belege.
 */
export function billDocumentPrefix(
  kind: BillKind | undefined,
  paymentMethod: PaymentMethod | null | undefined,
): "Beleg" | "Quittung" | "Rechnung" {
  if ((kind ?? "invoice") === "beleg") return "Beleg";
  if (isPaidDuringCheckout(paymentMethod)) return "Quittung";
  return "Rechnung";
}

/** Payment recipient configuration (from environment params) */
export interface PaymentConfig {
  iban: string;
  recipientName: string;
  recipientStreet: string;
  recipientPostalCode: string;
  recipientCity: string;
  recipientCountry: string;
  currency: string;
}
