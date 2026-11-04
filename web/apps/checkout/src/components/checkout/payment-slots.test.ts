// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import { paymentSlots } from "./payment-methods"

describe("paymentSlots (#833, BIL-51)", () => {
  it("a member gets the Sammelrechnung instead of the QR-Rechnung", () => {
    expect(paymentSlots(["rechnung", "monthly", "raisenow"])).toEqual(["monthly", "raisenow"])
  })

  it("anyone else gets the QR-Rechnung", () => {
    expect(paymentSlots(["rechnung", "raisenow"])).toEqual(["rechnung", "raisenow"])
  })

  it("a kiosk with a terminal pays there instead of by RaiseNow", () => {
    expect(paymentSlots(["raisenow", "wallee_terminal", "rechnung"])).toEqual([
      "rechnung",
      "wallee_terminal",
    ])
  })

  it("puts the invoice first, whatever the configured order", () => {
    expect(paymentSlots(["raisenow", "monthly"])).toEqual(["monthly", "raisenow"])
  })

  it("leaves a slot out when none of its methods is offered", () => {
    expect(paymentSlots(["rechnung"])).toEqual(["rechnung"])
    expect(paymentSlots(["wallee_terminal"])).toEqual(["wallee_terminal"])
    expect(paymentSlots([])).toEqual([])
  })
})
