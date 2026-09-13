// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { UsageType } from "./pricing"

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

// ── correctCheckouts (ADR-0041) ────────────────────────────────────────────
//
// Wire contract of the admin `correctCheckouts` callable: cancel closed
// visits (and their bills) with one reason, optionally issuing an edited
// replacement per visit. When a touched Beleg sits inside a sent
// Sammelrechnung, the server cancels that Sammelrechnung and mints its
// revision in the same transaction — several entries of one Sammelrechnung
// in one call yield exactly one revision (and one mail).

export const CANCEL_REASON_MIN_LENGTH = 3
export const MAX_CANCELLATION_REASON_LENGTH = 500
/** Server-side cap per call — a Sammelrechnung has at most a few dozen Belege. */
export const MAX_CORRECTIONS_PER_CALL = 50

export type CorrectCheckoutUserType = "erwachsen" | "kind" | "firma"
export type CorrectCheckoutItemType = "machine" | "material"
export type CorrectCheckoutItemOrigin = "nfc" | "manual" | "qr"

export interface CorrectCheckoutPersonInput {
  name: string
  email: string
  userType: CorrectCheckoutUserType
  /** users/{id} of the roster member, when known (drives the daily entry-fee dedup). */
  userId: string | null
  /** Admin-set "Nutzungsgebühr heute bereits bezahlt". The server may add, never remove. */
  entryFeeWaivedToday: boolean
  billingAddress?: { company: string; street: string; zip: string; city: string } | null
}

export interface CorrectCheckoutItemInput {
  workshop: string
  description: string
  type: CorrectCheckoutItemType
  /** catalog/{id} when the line came from the catalog; null for free-form lines. */
  catalogId: string | null
  variantId?: string | null
  origin?: CorrectCheckoutItemOrigin
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface CorrectCheckoutReplacement {
  usageType: UsageType
  persons: CorrectCheckoutPersonInput[]
  items: CorrectCheckoutItemInput[]
  tip: number
}

export interface CorrectCheckoutEntry {
  checkoutId: string
  /** Omit / null for a pure cancellation. */
  replacement?: CorrectCheckoutReplacement | null
}

export interface CorrectCheckoutsRequest {
  reason: string
  corrections: CorrectCheckoutEntry[]
}

export interface CorrectCheckoutsResult {
  cancelledBillIds: string[]
  replacementCheckoutIds: string[]
  replacementBillIds: string[]
  /** The Sammelrechnung revision minted in this commit, if any. */
  revisionBillId: string | null
  /** Display references of every newly minted bill — replacements first, the revision last. */
  references: string[]
}
