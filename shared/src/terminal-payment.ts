// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Payment terminal contract shared by the kiosk (which drives the terminal
 * over Wallee's Local Till Interface), the checkout web app (which shows
 * its progress) and the functions (which settle the payment from Wallee's
 * backend, ADR-0048).
 *
 * The types are deliberately LTI-agnostic: the web app never sees an LTI
 * message, only these events, so the terminal protocol stays a kiosk
 * detail.
 */

/** What the checkout asks the kiosk to charge. */
export interface TerminalPaymentRequest {
  /** Amount in Rappen (CHF × 100, integer). */
  amountRappen: number
  /**
   * Sent to the terminal as `merchantReference`; it reaches the Wallee
   * backend transaction, which is how the settlement finds the checkout.
   * Built by `prepareTerminalPayment` (see `formatTerminalReference`).
   */
  reference: string
}

/** Progress while the terminal is armed. Display only. */
export type TerminalPaymentEvent =
  | { type: "started" }
  /** A card was presented or a TWINT code scanned: the payment is running. */
  | { type: "cardEntered"; method: "card" | "qr" }
  | { type: "cardRemoved" }
  /** Text the terminal shows (German), for diagnostics. */
  | { type: "display"; target: "cardholder" | "attendant"; lines: string[] }
  | { type: "aborted" }

/**
 * How a payment ended, from the terminal's point of view. The UI shows it;
 * nothing is booked on it — only Wallee's backend confirmation closes the
 * checkout.
 *
 * - `approved` / `declined`: the terminal's final answer.
 * - `aborted`: stopped before a card was read (by us or at the terminal).
 * - `timeout`: no card was presented in time.
 * - `error`: the terminal refused or failed the request (`errorCode`).
 * - `unknown`: the connection dropped or no final answer came. The money
 *   may or may not have moved; the UI must check the checkout before
 *   offering a retry.
 * - `busy`: another payment is still running on this kiosk.
 * - `unavailable`: the terminal can't be reached.
 */
export type TerminalPaymentOutcome =
  | "approved"
  | "declined"
  | "aborted"
  | "timeout"
  | "error"
  | "unknown"
  | "busy"
  | "unavailable"

export interface TerminalPaymentResult {
  outcome: TerminalPaymentOutcome
  reference: string
  /** Terminal error code, e.g. `TRM.PT.0002` (customer stop). */
  errorCode?: string
  errorText?: string
  /** Authorized amount in Rappen, on `approved`. */
  amountAuthRappen?: number
  /** Card brand or `TWINT`, on `approved`/`declined`. */
  brand?: string
}

/** The bridge feature flag a kiosk build advertises when a terminal is configured. */
export const PAYMENT_TERMINAL_FEATURE = "payment-terminal"

/**
 * Environment letter in a terminal reference. Staging and prod share one
 * Wallee space and both receive every webhook; the letter lets each ignore
 * the other's payments.
 */
export type TerminalReferenceEnv = "P" | "S"

export interface TerminalReference {
  env: TerminalReferenceEnv
  checkoutId: string
  attempt: number
}

// Firestore auto-ids are 20 alphanumerics; EP2's "ans" set allows them,
// and the dashes keep the parts apart.
const REFERENCE_PATTERN = /^([PS])-([A-Za-z0-9]{1,40})-([1-9][0-9]{0,5})$/

export function formatTerminalReference(ref: TerminalReference): string {
  if (!/^[A-Za-z0-9]{1,40}$/.test(ref.checkoutId)) {
    throw new Error(`checkout id not usable in a terminal reference: ${ref.checkoutId}`)
  }
  if (!Number.isInteger(ref.attempt) || ref.attempt < 1) {
    throw new Error(`invalid terminal attempt: ${ref.attempt}`)
  }
  return `${ref.env}-${ref.checkoutId}-${ref.attempt}`
}

/** Null when the string isn't a terminal reference (e.g. a standalone terminal sale). */
export function parseTerminalReference(
  value: string | null | undefined
): TerminalReference | null {
  const m = REFERENCE_PATTERN.exec((value ?? "").trim())
  if (!m) return null
  return { env: m[1] as TerminalReferenceEnv, checkoutId: m[2], attempt: Number(m[3]) }
}

/** CHF (as stored on bills) → Rappen for the terminal. */
export function chfToRappen(amount: number): number {
  return Math.round(amount * 100)
}
