// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { Timestamp } from "firebase/firestore"
import { billStatus, billTotals, OVERDUE_AFTER_DAYS } from "./bill-status"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse("2026-07-05T12:00:00Z")

function bill(overrides: {
  createdDaysAgo?: number
  paidDaysAgo?: number | null
  kind?: "invoice" | "beleg"
  amount?: number
  cancelled?: boolean
}) {
  return {
    created: Timestamp.fromMillis(NOW - (overrides.createdDaysAgo ?? 0) * DAY),
    paidAt:
      overrides.paidDaysAgo != null
        ? Timestamp.fromMillis(NOW - overrides.paidDaysAgo * DAY)
        : null,
    kind: overrides.kind,
    amount: overrides.amount ?? 100,
    cancelledAt: overrides.cancelled ? Timestamp.fromMillis(NOW - DAY) : null,
  }
}

describe("billStatus", () => {
  it("is open while within the payment window", () => {
    expect(billStatus(bill({ createdDaysAgo: 5 }), NOW)).toBe("open")
    expect(
      billStatus(bill({ createdDaysAgo: OVERDUE_AFTER_DAYS }), NOW),
    ).toBe("open")
  })

  it("turns overdue after the payment window", () => {
    expect(
      billStatus(bill({ createdDaysAgo: OVERDUE_AFTER_DAYS + 1 }), NOW),
    ).toBe("overdue")
  })

  it("is paid as soon as paidAt is set, regardless of age", () => {
    expect(
      billStatus(bill({ createdDaysAgo: 90, paidDaysAgo: 1 }), NOW),
    ).toBe("paid")
  })

  it("a cancelled bill is 'cancelled' regardless of age, kind or payment (ADR-0042)", () => {
    expect(billStatus(bill({ createdDaysAgo: 60, cancelled: true }), NOW)).toBe("cancelled")
    expect(billStatus(bill({ kind: "beleg", cancelled: true }), NOW)).toBe("cancelled")
    expect(billStatus(bill({ paidDaysAgo: 1, cancelled: true }), NOW)).toBe("cancelled")
  })

  it("Belege are never payable on their own", () => {

    expect(
      billStatus(bill({ createdDaysAgo: 90, kind: "beleg" }), NOW),
    ).toBe("beleg")
  })
})

describe("billTotals", () => {
  it("sums open/overdue and current-month paid amounts", () => {
    const totals = billTotals(
      [
        bill({ createdDaysAgo: 5, amount: 60 }), // open
        bill({ createdDaysAgo: 45, amount: 84 }), // overdue
        bill({ createdDaysAgo: 45, paidDaysAgo: 2, amount: 40 }), // paid Jul
        bill({ createdDaysAgo: 90, paidDaysAgo: 40, amount: 500 }), // paid May
        bill({ createdDaysAgo: 90, kind: "beleg", amount: 20 }), // beleg
        bill({ createdDaysAgo: 5, amount: 999, cancelled: true }), // storniert — never counted
        bill({ createdDaysAgo: 5, paidDaysAgo: 1, amount: 999, cancelled: true }),
      ],

      NOW,
    )
    expect(totals.openAmount).toBe(144)
    expect(totals.overdueAmount).toBe(84)
    expect(totals.openCount).toBe(2)
    expect(totals.paidThisMonthAmount).toBe(40)
  })
})
