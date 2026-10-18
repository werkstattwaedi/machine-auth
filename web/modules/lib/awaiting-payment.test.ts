// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import type { Timestamp } from "firebase/firestore"
import { awaitingPaymentAmount } from "./awaiting-payment"

const attempts = {
  "1": { amount: 20, reference: "P-co-1" },
  "2": { amount: 32.5, reference: "P-co-2" },
}
const approval = { attempt: 2, reportedAt: {} as Timestamp }

describe("awaitingPaymentAmount (#812)", () => {
  it("is the approved attempt's amount", () => {
    expect(
      awaitingPaymentAmount({
        status: "awaiting_payment",
        terminalApproval: approval,
        terminalAttempts: attempts,
      }),
    ).toBe(32.5)
  })

  it("is null for any other checkout", () => {
    expect(
      awaitingPaymentAmount({ status: "open", terminalApproval: approval, terminalAttempts: attempts }),
    ).toBeNull()
    expect(awaitingPaymentAmount({ status: "awaiting_payment" })).toBeNull()
  })
})
