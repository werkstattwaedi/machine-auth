// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { BillDoc } from "@modules/lib/firestore-entities"

/**
 * Derived payment state of a bill for the Rechnungen workspace.
 *
 * - "beleg": per-visit Sammelrechnung record — never payable on its own,
 *   the payment books against the aggregated monthly invoice.
 * - "overdue": unpaid invoice older than {@link OVERDUE_AFTER_DAYS}. Bills
 *   carry no explicit due date; the invoice PDF asks for payment within
 *   30 days of issue, so created + 30d is the due date.
 */
export type BillStatus = "paid" | "open" | "overdue" | "beleg"

export const OVERDUE_AFTER_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export function billStatus(
  bill: Pick<BillDoc, "paidAt" | "created" | "kind">,
  nowMs: number,
): BillStatus {
  if ((bill.kind ?? "invoice") === "beleg") return "beleg"
  if (bill.paidAt) return "paid"
  const createdMs = bill.created?.toMillis() ?? nowMs
  return nowMs - createdMs > OVERDUE_AFTER_DAYS * DAY_MS ? "overdue" : "open"
}

export interface BillTotals {
  openAmount: number
  overdueAmount: number
  openCount: number
  /** Paid amount within the current calendar month (by paidAt). */
  paidThisMonthAmount: number
}

export function billTotals(
  bills: Pick<BillDoc, "paidAt" | "created" | "kind" | "amount">[],
  nowMs: number,
): BillTotals {
  const now = new Date(nowMs)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const totals: BillTotals = {
    openAmount: 0,
    overdueAmount: 0,
    openCount: 0,
    paidThisMonthAmount: 0,
  }
  for (const bill of bills) {
    const status = billStatus(bill, nowMs)
    if (status === "open" || status === "overdue") {
      totals.openAmount += bill.amount ?? 0
      totals.openCount += 1
      if (status === "overdue") totals.overdueAmount += bill.amount ?? 0
    } else if (status === "paid" && bill.paidAt) {
      if (bill.paidAt.toMillis() >= monthStart) {
        totals.paidThisMonthAmount += bill.amount ?? 0
      }
    }
  }
  return totals
}
