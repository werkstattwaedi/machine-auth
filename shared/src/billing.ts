// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Wire contract of the `adminMarkBillsPaid` callable (billingCall) —
 * shared between the functions handler and the admin web callers (manual
 * bulk mark-paid, statement import) so the two sides can't drift.
 */

/** Payment channels an admin may book manually. ("free" is server-only.) */
export const ADMIN_PAID_VIA = ["twint", "ebanking", "cash"] as const
export type AdminPaidVia = (typeof ADMIN_PAID_VIA)[number]

/** Server-side cap per call; clients chunk larger batches. */
export const MAX_BILLS_PER_CALL = 200

/** Sanity range for the booked value date (statement booking dates). */
export const PAID_AT_MIN_MS = Date.UTC(2000, 0, 1)
export const PAID_AT_MAX_MS = Date.UTC(2100, 0, 1)

export interface MarkBillPaidInput {
  billId: string
  paidVia: AdminPaidVia
  /** Value date of the payment (e.g. from the bank statement). Defaults to now. */
  paidAtMs?: number
}

export interface MarkBillsPaidRequest {
  bills: MarkBillPaidInput[]
}

export interface MarkBillsPaidResult {
  paid: number
  /** Bill ids skipped because they were already paid. */
  alreadyPaid: string[]
  /** Bill ids that don't exist or are Belege (never payable on their own). */
  rejected: string[]
}
