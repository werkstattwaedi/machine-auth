// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { type Timestamp } from "firebase/firestore"

const chfFormatter = new Intl.NumberFormat("de-CH", {
  style: "currency",
  currency: "CHF",
})

const dateFormatter = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

const dateTimeFormatter = new Intl.DateTimeFormat("de-CH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

export function formatCHF(amount: number): string {
  return chfFormatter.format(amount)
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
