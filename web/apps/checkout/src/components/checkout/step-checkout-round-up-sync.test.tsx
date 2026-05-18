// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression for issue #236: when the user enables "Aufrunden" on a
 * billable subtotal, then switches `usageType` to "intern" (which zeroes
 * personFees + machineCost + materialCost), the previously-dispatched
 * round-up tip MUST NOT linger in global state. The displayed
 * Spende/Aufrunden card already hides itself when there are no round-up
 * options for a base of 0, but the dispatched `tip` in CheckoutState
 * was stale — so the Bezahlen step still showed CHF 0.60 to pay even
 * though the user had selected the always-free internal usage.
 *
 * This test renders the real `StepCheckout` with a thin reducer-backed
 * harness so it observes both the render path and the global-state
 * dispatch path.
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import { useReducer } from "react"
import { render, screen, cleanup, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StepCheckout } from "./step-checkout"
import {
  checkoutReducer,
  initialState,
  type CheckoutState,
  type CheckoutAction,
} from "./use-checkout-state"
import type { PricingConfig } from "@modules/lib/workshop-config"

afterEach(cleanup)

// `calculateFee` is the only thing the step pulls in from pricing that
// depends on config shape; stub it so the test config below stays small.
vi.mock("@modules/lib/pricing", async () => {
  const actual = await vi.importActual<typeof import("@modules/lib/pricing")>(
    "@modules/lib/pricing",
  )
  return {
    ...actual,
    USAGE_TYPE_LABELS: { regular: "Regulär", intern: "Intern", materialbezug: "Materialbezug", hangenmoos: "Hangenmoos" },
    USER_TYPE_LABELS: { erwachsen: "Erwachsen", kind: "Kind", firma: "Firma" },
    // Fractional fee so `roundUpOptions(subtotal)` produces non-empty
    // options (e.g. 14.40 → 15, 16, 17 — the smallest "next franc" is
    // a 0.60 round-up, which matches the exact CHF 0.60 leftover Mike
    // saw in #236).
    calculateFee: () => 14.4,
  }
})

const config: PricingConfig = {
  entryFees: {
    erwachsen: { regular: 15, materialbezug: 0, intern: 99, hangenmoos: 15 },
    kind: { regular: 7.5, materialbezug: 0, intern: 99, hangenmoos: 7.5 },
    firma: { regular: 30, materialbezug: 0, intern: 99, hangenmoos: 30 },
  },
  workshops: {} as PricingConfig["workshops"],
  slaLayerPrice: { none: 0.01, member: 0.008 },
  labels: {
    units: {},
    discounts: { none: "Normal", member: "Mitglied" },
  },
}

function Harness({
  onState,
}: {
  onState?: (s: CheckoutState) => void
}) {
  const [state, dispatch] = useReducer(checkoutReducer, {
    ...initialState,
    step: 2,
    persons: [
      {
        id: "p1",
        firstName: "Max",
        lastName: "Muster",
        email: "max@example.com",
        userType: "erwachsen",
        termsAccepted: true,
        isPreFilled: false,
      },
    ],
  })
  onState?.(state)
  // Wrap dispatch to also stream out every state for assertions.
  const tracked: React.Dispatch<CheckoutAction> = (action) => {
    dispatch(action)
  }
  return (
    <StepCheckout
      state={state}
      dispatch={tracked}
      onSubmit={async () => {}}
      submitting={false}
      submitError={null}
      items={[]}
      config={config}
    />
  )
}

describe("StepCheckout — round-up tip stays in sync with the billed subtotal (#236)", () => {
  it("clears the dispatched round-up when usageType changes to 'intern'", async () => {
    const states: CheckoutState[] = []
    const user = userEvent.setup()
    render(<Harness onState={(s) => states.push(s)} />)

    // Initial state: regular usage, 15 CHF subtotal (one adult, stubbed),
    // no tip yet.
    expect(states.at(-1)!.usageType).toBe("regular")
    expect(states.at(-1)!.tip).toBe(0)

    // Enable Aufrunden — the smallest auto-target for a 15 CHF base is
    // 16 CHF (next franc), so the dispatched tip becomes 1.00.
    const aufrunden = screen.getByRole("checkbox", { name: /aufrunden/i })
    await act(async () => {
      await user.click(aufrunden)
    })
    const tipAfterRoundUp = states.at(-1)!.tip
    expect(tipAfterRoundUp).toBeGreaterThan(0)

    // Open the Nutzungsgebühren section so the usage-type select is in the DOM,
    // then switch to "intern".
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Nutzungsgebühren/ }))
    })
    const usageSelect = screen.getByLabelText("Nutzungsart") as HTMLSelectElement
    await act(async () => {
      await user.selectOptions(usageSelect, "intern")
    })

    // After the effect runs, the dispatched tip MUST be 0 — there is
    // nothing to round up against a 0 CHF subtotal.
    expect(states.at(-1)!.usageType).toBe("intern")
    expect(states.at(-1)!.tip).toBe(0)
  })

  it("preserves the manual tip when usageType changes to 'intern'", async () => {
    // The fix must only drop the *round-up* portion. A free-form
    // donation the user typed into the Spende input is intentional and
    // should survive the switch.
    const states: CheckoutState[] = []
    const user = userEvent.setup()
    render(<Harness onState={(s) => states.push(s)} />)

    // Type a manual donation of 5 CHF.
    const spendeInput = screen.getByLabelText("Spende") as HTMLInputElement
    await act(async () => {
      await user.type(spendeInput, "5")
    })
    expect(states.at(-1)!.tip).toBe(5)

    // Now enable Aufrunden — base is 15 + 5 = 20 CHF, which is whole,
    // so no round-up options appear. Manual tip stays at 5.
    expect(states.at(-1)!.tip).toBe(5)

    // Switch to intern.
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Nutzungsgebühren/ }))
    })
    const usageSelect = screen.getByLabelText("Nutzungsart") as HTMLSelectElement
    await act(async () => {
      await user.selectOptions(usageSelect, "intern")
    })

    // Manual tip survives.
    expect(states.at(-1)!.tip).toBe(5)
    expect(states.at(-1)!.usageType).toBe("intern")
  })

  it("auto-unchecks the round-up checkbox when no options remain", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const aufrunden = screen.getByRole("checkbox", { name: /aufrunden/i }) as HTMLInputElement
    await act(async () => {
      await user.click(aufrunden)
    })
    expect(aufrunden.checked).toBe(true)

    // Switch to intern — the entire round-up row disappears (no
    // options), so the checkbox should also be unchecked under the hood.
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Nutzungsgebühren/ }))
    })
    const usageSelect = screen.getByLabelText("Nutzungsart") as HTMLSelectElement
    await act(async () => {
      await user.selectOptions(usageSelect, "intern")
    })

    // The row is gone; switching back to regular MUST NOT auto-restore
    // an enabled round-up (the user might have wanted it off all along).
    await act(async () => {
      await user.selectOptions(usageSelect, "regular")
    })
    const aufrundenAfter = screen.getByRole("checkbox", { name: /aufrunden/i }) as HTMLInputElement
    expect(aufrundenAfter.checked).toBe(false)
  })
})
