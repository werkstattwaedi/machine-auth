// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { type Timestamp } from "firebase/firestore"

const locale = import.meta.env.VITE_LOCALE ?? "de-CH"
const currency = import.meta.env.VITE_CURRENCY ?? "CHF"

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
