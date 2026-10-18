// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * What a bill is, as two stored facts (ADR-0052):
 *
 *  - `paymentMethod`: the committed method. Everything a bill *does* —
 *    waiting for the Sammelrechnung, carrying a QR slip, which mail it
 *    sends — follows from its `PAYMENT_METHOD_INFO` properties.
 *  - `document`: what the customer holds — Rechnung, Sammelrechnung, Beleg
 *    or Quittung. Its prefix, title and file name
 *    come from `BILL_DOCUMENT_INFO`. Fixed once the bill is committed: a
 *    printed number is a historical fact, so a later rule change reaches
 *    only new bills.
 *
 * The two are independent on purpose. A Beleg is a visit waiting for the
 * Sammelrechnung, a visit paid during the checkout on the customer's word
 * (the RaiseNow TWINT paylink) or a CHF 0 one; keying the monthly run on
 * `document == "beleg"` would charge the TWINT visit twice. A Quittung
 * confirms a payment the provider verified (the Wallee terminal, ADR-0051).
 *
 * Bills minted before ADR-0052 carry neither field, only the legacy `kind`
 * ("beleg" = waits for the Sammelrechnung). The `…Of` resolvers fall back
 * to today's derivation for them until the backfill has run everywhere.
 */

import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_INFO,
  isPaymentMethod,
  type PaymentMethod,
} from "./payment-methods"
import type { BillMail } from "./email-contract"

export const BILL_DOCUMENT_TYPES = ["rechnung", "sammelrechnung", "beleg", "quittung"] as const
export type BillDocumentType = (typeof BILL_DOCUMENT_TYPES)[number]

export interface BillDocumentInfo {
  /** Number prefix: `RE-4200001` / `BL-4200001`. */
  prefix: "RE" | "BL"
  /** The document's name — title noun and file name prefix. */
  label: string
  /** Label of the number on the document. */
  numberLabel: "Rechnungsnummer" | "Belegnummer"
  /** Asks for payment itself (QR slip when an amount is due). */
  payable: boolean
}

export const BILL_DOCUMENT_INFO: Readonly<Record<BillDocumentType, BillDocumentInfo>> = {
  rechnung: { prefix: "RE", label: "Rechnung", numberLabel: "Rechnungsnummer", payable: true },
  sammelrechnung: {
    prefix: "RE",
    label: "Sammelrechnung",
    numberLabel: "Rechnungsnummer",
    payable: true,
  },
  beleg: { prefix: "BL", label: "Beleg", numberLabel: "Belegnummer", payable: false },
  // A verified payment (ADR-0051); also every RaiseNow bill issued before #763.
  quittung: { prefix: "RE", label: "Quittung", numberLabel: "Rechnungsnummer", payable: false },
}

export function isBillDocumentType(value: unknown): value is BillDocumentType {
  return (
    typeof value === "string" &&
    (BILL_DOCUMENT_TYPES as readonly string[]).includes(value)
  )
}

/**
 * What a checkout ends with: a payment method, or nothing to pay (CHF 0).
 * "free" is no payment method — nobody chooses it, no client offers it — so
 * it lives here and never in `PaymentMethod`.
 */
export type PaymentChoice = PaymentMethod | "free"

/**
 * The QR-Rechnung method: what an unconfirmed bill is committed as
 * overnight, and the method of a Sammelrechnung (it is paid by QR slip).
 */
export const INVOICE_PAYMENT_METHOD: PaymentMethod = "rechnung"

/** Methods whose bills wait for the monthly Sammelrechnung. */
export const AGGREGATED_PAYMENT_METHODS: readonly PaymentMethod[] = PAYMENT_METHODS.filter(
  (m) => PAYMENT_METHOD_INFO[m].isAggregated
)

/**
 * The document a choice produces. `null` is a legacy bill nobody committed:
 * a Rechnung. A Beleg asks for no payment itself — because the
 * Sammelrechnung will, because the customer says they paid during the
 * checkout, or because nothing is due; a payment the provider confirms gets
 * a Quittung.
 */
export function documentFor(
  choice: PaymentChoice | null,
  { isSammelrechnung = false }: { isSammelrechnung?: boolean } = {}
): BillDocumentType {
  if (isSammelrechnung) return "sammelrechnung"
  if (choice === "free") return "beleg"
  if (choice === null) return "rechnung"
  const info = PAYMENT_METHOD_INFO[choice]
  if (info.confirmsPayment) return "quittung"
  return info.isAggregated || info.paidDuringCheckout ? "beleg" : "rechnung"
}

/** The bill fields the resolvers read; SDK-agnostic (functions and web). */
export interface BillDocumentFields {
  /** Legacy (pre ADR-0052): "beleg" = waits for the Sammelrechnung. */
  kind?: "invoice" | "beleg"
  document?: BillDocumentType
  paymentMethod?: PaymentMethod | null
  aggregatedIntoBillRef?: unknown
  cancelledAt?: unknown
  /** Only a Sammelrechnung covers more than one checkout. */
  checkouts?: readonly unknown[]
}

function isLegacyBeleg(bill: BillDocumentFields): boolean {
  return (bill.kind ?? "invoice") === "beleg"
}

/**
 * The bill's document. A legacy bill gets today's derivation; its prefix is
 * exact without `legacyCheckoutMethod` (a Quittung and a Sammelrechnung
 * print `RE-` like a Rechnung), so readers that only need the number can
 * leave it out.
 */
export function billDocumentOf(
  bill: BillDocumentFields,
  legacyCheckoutMethod?: unknown
): BillDocumentType {
  if (bill.document) return bill.document
  if (isLegacyBeleg(bill)) return "beleg"
  if ((bill.checkouts?.length ?? 0) > 1) return "sammelrechnung"
  if (!isPaymentMethod(legacyCheckoutMethod)) return "rechnung"
  const info = PAYMENT_METHOD_INFO[legacyCheckoutMethod]
  // An invoice whose checkouts name the Sammelrechnung method is the
  // Sammelrechnung itself (monthlyBillRun output).
  if (info.isAggregated) return "sammelrechnung"
  if (info.paidDuringCheckout) return "quittung"
  return "rechnung"
}

/**
 * The bill's committed method, or null (not committed yet, or CHF 0). For a
 * legacy bill, `legacyCheckoutMethod` is its first checkout's method; pass
 * it only for a committed bill — an uncommitted checkout's method is just
 * the last tab tapped.
 */
export function billPaymentMethodOf(
  bill: BillDocumentFields,
  legacyCheckoutMethod?: unknown
): PaymentMethod | null {
  if (bill.paymentMethod !== undefined) return bill.paymentMethod
  if (isLegacyBeleg(bill)) return AGGREGATED_PAYMENT_METHODS[0] ?? null
  if (!isPaymentMethod(legacyCheckoutMethod)) return null
  if (PAYMENT_METHOD_INFO[legacyCheckoutMethod].isAggregated) return INVOICE_PAYMENT_METHOD
  return legacyCheckoutMethod
}

/**
 * A Beleg for the Sammelrechnung: committed with an aggregated method,
 * whether or not the monthly run has collected it yet. Never paid or acked
 * on its own — the Sammelrechnung is.
 */
export function isCollectedBeleg(bill: BillDocumentFields): boolean {
  if (bill.paymentMethod !== undefined) {
    return !!bill.paymentMethod && PAYMENT_METHOD_INFO[bill.paymentMethod].isAggregated
  }
  return isLegacyBeleg(bill)
}

/** A Beleg for the Sammelrechnung that the monthly run has yet to collect. */
export function awaitsSammelrechnung(bill: BillDocumentFields): boolean {
  return isCollectedBeleg(bill) && !bill.aggregatedIntoBillRef && !bill.cancelledAt
}

/**
 * The mail that announces a bill (ADR-0046). A Beleg for the Sammelrechnung
 * ("charge queued") and one paid during the checkout ("paid by TWINT") say
 * different things, and neither may share a template with the payable
 * Sammelrechnung (#502). Reads properties only, never a method id.
 */
export function billMailFor(
  document: BillDocumentType,
  paymentMethod: PaymentMethod | null
): BillMail {
  switch (document) {
    case "sammelrechnung":
      return "sammelrechnung"
    case "quittung":
      // The Wallee terminal's verified payment, or an earlier RaiseNow bill.
      return "receipt"
    case "rechnung":
      return "invoice"
    case "beleg":
      if (paymentMethod && PAYMENT_METHOD_INFO[paymentMethod].paidDuringCheckout) return "receipt"
      return "beleg"
  }
}
