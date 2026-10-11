// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Payment methods offered at the end of a self-checkout, and the channels a
 * bill can be settled through.
 *
 * Method ids name the *integration*, not the payment brand: TWINT is
 * reachable through the RaiseNow paylink today and through the Wallee
 * terminal next, so a brand id would stop saying which path the customer
 * took. Method-specific behaviour (receipt vs. invoice, Beleg routing,
 * membership gating) is read from `PAYMENT_METHOD_INFO` — add new methods
 * here rather than as string literals at the call sites.
 */

export const PAYMENT_METHODS = ["rechnung", "monthly", "raisenow"] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/**
 * Ids that may still sit in stored checkouts from before the rename. Every
 * read of a stored method goes through `normalizePaymentMethod`, so these
 * keep working until the migration has rewritten them.
 */
const LEGACY_PAYMENT_METHODS: Readonly<Record<string, PaymentMethod>> = {
  twint: "raisenow",
}

/** A `paymentMethod` value as it may be stored in Firestore. */
export type StoredPaymentMethod = PaymentMethod | "twint"

export interface PaymentMethodInfo {
  /** Customer-facing label (German UI). */
  label: string
  /**
   * The customer pays inside the checkout flow, so the bill document is a
   * receipt ("Quittung") without a QR slip rather than a payment request.
   * This says nothing about whether the payment was verified — the RaiseNow
   * paylink is customer-stated only (ADR-0020).
   */
  paidDuringCheckout: boolean
  /** The bill becomes a Beleg that the monthly run folds into a Sammelrechnung. */
  isAggregated: boolean
  /** Only offered to members with an active membership. */
  requiresMembership: boolean
}

export const PAYMENT_METHOD_INFO: Readonly<
  Record<PaymentMethod, PaymentMethodInfo>
> = {
  rechnung: {
    label: "QR-Rechnung",
    paidDuringCheckout: false,
    isAggregated: false,
    requiresMembership: false,
  },
  monthly: {
    label: "Sammelrechnung",
    paidDuringCheckout: false,
    isAggregated: true,
    requiresMembership: true,
  },
  raisenow: {
    label: "TWINT",
    paidDuringCheckout: true,
    isAggregated: false,
    requiresMembership: false,
  },
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return (
    typeof value === "string" &&
    (PAYMENT_METHODS as readonly string[]).includes(value)
  )
}

/** Maps a stored or client-supplied method to its current id; null if unknown. */
export function normalizePaymentMethod(value: unknown): PaymentMethod | null {
  if (isPaymentMethod(value)) return value
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(LEGACY_PAYMENT_METHODS, value)) {
    return LEGACY_PAYMENT_METHODS[value]
  }
  return null
}

/** True when the (possibly legacy) method yields a receipt instead of an invoice. */
export function isPaidDuringCheckout(value: unknown): boolean {
  const method = normalizePaymentMethod(value)
  return method !== null && PAYMENT_METHOD_INFO[method].paidDuringCheckout
}

/**
 * Channels through which a bill's money actually arrived (`bills.paidVia`).
 * `free` is server-only (zero-amount bills).
 */
export const PAID_VIA = ["raisenow", "ebanking", "free"] as const
export type PaidVia = (typeof PAID_VIA)[number]

const LEGACY_PAID_VIA: Readonly<Record<string, PaidVia>> = {
  twint: "raisenow",
}

/**
 * A `paidVia` value as it may be stored in Firestore. `cash` was offered by
 * the admin mark-paid dialog although the workshop takes no cash; it has no
 * current equivalent and is kept only so old bills still type-check.
 */
export type StoredPaidVia = PaidVia | "twint" | "cash"

/** Maps a stored paidVia to its current id; null if unknown or legacy-only. */
export function normalizePaidVia(value: unknown): PaidVia | null {
  if (typeof value !== "string") return null
  if ((PAID_VIA as readonly string[]).includes(value)) return value as PaidVia
  return Object.prototype.hasOwnProperty.call(LEGACY_PAID_VIA, value) ? LEGACY_PAID_VIA[value] : null
}
