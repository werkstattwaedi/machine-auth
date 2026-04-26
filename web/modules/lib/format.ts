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

export function formatInvoiceNumber(n: number): string {
  return `RE-${String(n).padStart(6, "0")}`
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
