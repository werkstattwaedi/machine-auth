// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  chfToRappen,
  formatTerminalReference,
  parseTerminalReference,
} from "./terminal-payment"
import { PAYMENT_METHOD_INFO } from "./payment-methods"

describe("terminal reference", () => {
  it("round-trips", () => {
    const ref = { env: "P" as const, checkoutId: "a1B2c3D4e5F6g7H8i9J0", attempt: 2 }
    const s = formatTerminalReference(ref)
    expect(s).toBe("P-a1B2c3D4e5F6g7H8i9J0-2")
    expect(parseTerminalReference(s)).toEqual(ref)
  })

  it("rejects what isn't ours", () => {
    // Spike references, a standalone terminal sale (Wallee's own id), junk.
    expect(parseTerminalReference("SPIKE-0005")).toBeNull()
    expect(parseTerminalReference("000000001")).toBeNull()
    expect(parseTerminalReference("X-abc-1")).toBeNull()
    expect(parseTerminalReference("P-abc-0")).toBeNull()
    expect(parseTerminalReference("P-ab_c-1")).toBeNull()
    expect(parseTerminalReference(null)).toBeNull()
  })

  it("refuses ids outside the terminal's character set", () => {
    expect(() =>
      formatTerminalReference({ env: "S", checkoutId: "a/b", attempt: 1 })
    ).toThrow()
    expect(() =>
      formatTerminalReference({ env: "S", checkoutId: "abc", attempt: 0 })
    ).toThrow()
  })
})

describe("chfToRappen", () => {
  it("rounds float noise away", () => {
    expect(chfToRappen(59.68)).toBe(5968)
    expect(chfToRappen(0.1 + 0.2)).toBe(30)
  })
})

describe("wallee_terminal", () => {
  it("is the only method that confirms its payment", () => {
    const confirming = Object.entries(PAYMENT_METHOD_INFO)
      .filter(([, info]) => info.confirmsPayment)
      .map(([id]) => id)
    expect(confirming).toEqual(["wallee_terminal"])
  })
})
