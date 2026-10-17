// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { showNoCheckoutGate, wizardStep, type WizardGateState } from "./wizard-gate"

function state(overrides: Partial<WizardGateState>): WizardGateState {
  return {
    pathname: "/checkout",
    hasOpenCheckout: true,
    pendingCheckout: false,
    paymentChosen: false,
    committed: false,
    submitting: false,
    ...overrides,
  }
}

describe("wizardStep", () => {
  it("Check Out is step 3 until a card is chosen, then step 4 in place (#750)", () => {
    expect(wizardStep(state({}))).toBe(2)
    expect(wizardStep(state({ paymentChosen: true }))).toBe(3)
    expect(wizardStep(state({ committed: true }))).toBe(3)
    expect(wizardStep(state({ pathname: "/visit" }))).toBe(1)
    expect(wizardStep(state({ pathname: "/account/usage" }))).toBe(null)
  })
})

describe("showNoCheckoutGate", () => {
  it("gates /visit and /checkout without an open checkout", () => {
    expect(showNoCheckoutGate(state({ hasOpenCheckout: false }))).toBe(true)
    expect(showNoCheckoutGate(state({ pathname: "/visit", hasOpenCheckout: false }))).toBe(true)
  })

  it("does not gate while the commit closes the checkout, nor after it answered", () => {
    // The closed checkout leaves the open-checkout query, possibly before
    // the close answers — the page must not flash the gate in between.
    expect(showNoCheckoutGate(state({ hasOpenCheckout: false, submitting: true }))).toBe(false)
    expect(showNoCheckoutGate(state({ hasOpenCheckout: false, committed: true }))).toBe(false)
  })

  it("does not gate a checkout whose create is still on its way", () => {
    expect(
      showNoCheckoutGate(state({ pathname: "/visit", hasOpenCheckout: false, pendingCheckout: true })),
    ).toBe(false)
  })

  it("a commit elsewhere never keeps /visit open", () => {
    expect(
      showNoCheckoutGate(state({ pathname: "/visit", hasOpenCheckout: false, committed: true })),
    ).toBe(true)
  })
})
