// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { type Timestamp } from "firebase/firestore"

/**
 * Single source of truth for the app's locale + currency. Both come from
 * Vite env vars and must be set at build time — `scripts/generate-env.ts`
 * writes them into `.env.development` / `.env.production`. We deliberately
 * fail loud (rather than silently defaulting to "de-CH" / "CHF") so a
 * misconfigured build environment surfaces immediately during boot rather
 * than being discovered later via mismatched currency display or an
 * incorrect Intl format. See issue #149.
 */
function requireEnv(name: "VITE_LOCALE" | "VITE_CURRENCY"): string {
  const value = import.meta.env[name]
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `${name} must be set — run \`npm run generate-env\` to regenerate ` +
        `web/apps/*/.env.* from scripts/env-config.ts.`,
    )
  }
  return value
}

export const locale = requireEnv("VITE_LOCALE")
export const currency = requireEnv("VITE_CURRENCY")

const currencyFormatter = new Intl.NumberFormat(locale, {
  style: "currency",
  currency,
})

const dateFormatter = new Intl.DateTimeFormat(locale, {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

const dateTimeFormatter = new Intl.DateTimeFormat(locale, {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

/**
 * Bill numbering (ADR-0042): `referenceNumber = base × 10 + d`, where `d`
 * (0–9) is the revision digit — 0 for an original, 1 for the first
 * corrected re-issue. Mirrors `functions/src/invoice/types.ts` so
 * web/functions render the same string for the same stored number.
 */
export const BILL_REVISION_RADIX = 10

/** Sequential base number, e.g. 42000011 → 4200001. */
export function billBaseNumber(referenceNumber: number): number {
  return Math.floor(referenceNumber / BILL_REVISION_RADIX)
}

/**
 * Version count: 1 for an original, 2 for the first correction, … e.g.
 * 42000011 → 2. Used for the revision cap; the printed suffix is the digit.
 */
export function billRevision(referenceNumber: number): number {
  return (referenceNumber % BILL_REVISION_RADIX) + 1
}

function formatBillNumber(prefix: "RE" | "BL", n: number): string {
  const base = String(billBaseNumber(n)).padStart(6, "0")
  // The printed suffix IS the stored digit, so the number on the document
  // and the last digit of its QR payload always agree (042000151 ↔
  // RE-4200015-1). billRevision() is the version count, not the suffix.
  const digit = n % BILL_REVISION_RADIX
  return digit > 0 ? `${prefix}-${base}-${digit}` : `${prefix}-${base}`
}

/**
 * Format an invoice reference number for display: 42000010 → "RE-4200001",
 * 42000011 → "RE-4200001-1" (first correction).
 */
export function formatInvoiceNumber(n: number): string {
  return formatBillNumber("RE", n)
}

/** Format a Beleg reference number for display: 42000010 → "BL-4200001". */
export function formatBelegNumber(n: number): string {
  return formatBillNumber("BL", n)
}


/**
 * Format a bill's reference number using its `kind`. A `kind: "beleg"`
 * (per-visit Sammelrechnung record) renders "BL-…"; everything else
 * (real, payable invoice) renders "RE-…". Mirrors the functions-side
 * helper in functions/src/invoice/types.ts so web/functions stay in
 * lockstep. Issue #405.
 */
export function formatBillReference(
  n: number,
  kind: "invoice" | "beleg" | undefined,
): string {
  return kind === "beleg" ? formatBelegNumber(n) : formatInvoiceNumber(n)
}

export function formatCHF(amount: number): string {
  return currencyFormatter.format(amount)
}

export function formatDate(
  value: Date | Timestamp | { toDate(): Date } | null | undefined
): string {
  if (!value) return "–"
  const date = value instanceof Date ? value : value.toDate()
  return dateFormatter.format(date)
}

export function formatDateTime(
  value: Date | Timestamp | { toDate(): Date } | null | undefined
): string {
  if (!value) return "–"
  const date = value instanceof Date ? value : value.toDate()
  return dateTimeFormatter.format(date)
}

// `numeric: "always"` so 2 days ago reads "vor 2 Tagen" rather than the
// calendar-relative "vorgestern" — the design draft uses the counted form.
const relativeTimeFormatter = new Intl.RelativeTimeFormat(locale, {
  numeric: "always",
})

/**
 * Human relative time for a past (or future) instant, e.g. "gerade eben",
 * "vor 2 Tagen", "vor 3 Stunden". Picks the largest sensible unit.
 * `now` is injectable so the output is deterministic in tests.
 */
export function formatRelativeTime(
  value: Date | Timestamp | { toDate(): Date } | null | undefined,
  now: Date = new Date()
): string {
  if (!value) return "–"
  const date = value instanceof Date ? value : value.toDate()
  const diffMs = date.getTime() - now.getTime()
  if (Math.abs(diffMs) < 60_000) return "gerade eben"
  const minutes = Math.round(diffMs / 60_000)
  if (Math.abs(minutes) < 60)
    return relativeTimeFormatter.format(minutes, "minute")
  const hours = Math.round(diffMs / 3_600_000)
  if (Math.abs(hours) < 24) return relativeTimeFormatter.format(hours, "hour")
  const days = Math.round(diffMs / 86_400_000)
  return relativeTimeFormatter.format(days, "day")
}
