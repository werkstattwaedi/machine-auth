// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression for issue #236: when the user enables "Aufrunden" on a
 * billable subtotal, then switches `usageType` to "intern" (which zeroes
 * personFees + machineCost + materialCost), the previously-dispatched
 * round-up tip MUST NOT linger in state. The displayed Spende/Aufrunden
 * card already hides itself when there are no round-up options for a
 * base of 0, but the `tip` value driving the Bezahlen step was stale.
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import { useState } from "react"
import { render, screen, cleanup, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { StepCheckout } from "./step-checkout"
import type { CheckoutPerson } from "./use-checkout-state"
import type { PricingConfig } from "@modules/lib/workshop-config"
import type { UsageType } from "@modules/lib/pricing"

afterEach(cleanup)

// The step pulls the per-person entry fee from pricing; stub `standardFee`
// (which `computeCheckoutCosts` uses for the subtotal) and `calculateFee`
// (the per-person display) so the test config below stays small. usageType
// is "regular" here, so the usage-type discount is a no-op (net = raw).
vi.mock("@modules/lib/pricing", async () => {
  const actual = await vi.importActual<typeof import("@modules/lib/pricing")>(
    "@modules/lib/pricing",
  )
  return {
    ...actual,
    USAGE_TYPE_LABELS: { regular: "Regulär", ermaessigt: "Ermässigt", intern: "Intern", materialbezug: "Materialbezug", hangenmoos: "Hangenmoos", volunteering: "Freiwilligengruppe" },
    USER_TYPE_LABELS: { erwachsen: "Erwachsen", kind: "Kind", firma: "Firma" },
    // Fractional fee so `roundUpOptions(subtotal)` produces non-empty
    // options (e.g. 14.40 → 15, 16, 17 — the smallest "next franc" is
    // a 0.60 round-up, which matches the exact CHF 0.60 leftover Mike
    // saw in #236).
    standardFee: () => 14.4,
    calculateFee: () => 14.4,
  }
})

const config: PricingConfig = {
  entryFees: {
    erwachsen: { regular: 15, ermaessigt: 7.5, materialbezug: 0, intern: 99, hangenmoos: 15 },
    kind: { regular: 7.5, ermaessigt: 3.75, materialbezug: 0, intern: 99, hangenmoos: 7.5 },
    firma: { regular: 30, ermaessigt: 15, materialbezug: 0, intern: 99, hangenmoos: 30 },
  },
  workshops: {} as PricingConfig["workshops"],
  slaLayerPrice: { none: 0.01, member: 0.008 },
  labels: {
    units: {},
    discounts: { none: "Normal", member: "Mitglied" },
  },
}

const PERSONS: CheckoutPerson[] = [
  {
    id: "p1",
    firstName: "Max",
    lastName: "Muster",
    email: "max@example.com",
    userType: "erwachsen",
    termsAccepted: true,
    isPreFilled: false,
  },
]

function Harness({
  onTipChange,
  onUsageChange,
}: {
  onTipChange?: (n: number) => void
  onUsageChange?: (t: UsageType) => void
}) {
  const [usageType, setUsageType] = useState<UsageType>("regular")
  const [tip, setTip] = useState(0)
  return (
    <StepCheckout
      persons={PERSONS}
      usageType={usageType}
      setUsageType={(t) => {
        onUsageChange?.(t)
        setUsageType(t)
      }}
      tip={tip}
      setTip={(n) => {
        onTipChange?.(n)
        setTip(n)
      }}
      onSubmit={async () => {}}
      onBack={() => {}}
      submitting={false}
      submitError={null}
      items={[]}
      config={config}
    />
  )
}

describe("StepCheckout — round-up tip stays in sync with the billed subtotal (#236)", () => {
  it("clears the tip when usageType changes to 'intern'", async () => {
    let lastTip = 0
    let lastUsage: UsageType = "regular"
    const user = userEvent.setup()
    render(
      <Harness
        onTipChange={(t) => {
          lastTip = t
        }}
        onUsageChange={(t) => {
          lastUsage = t
        }}
      />,
    )

    // Enable Aufrunden — the smallest auto-target for a 15 CHF base is
    // 16 CHF (next franc), so the tip becomes 1.00.
    const aufrunden = screen.getByRole("checkbox", { name: /aufrunden/i })
    await act(async () => {
      await user.click(aufrunden)
    })
    expect(lastTip).toBeGreaterThan(0)

    // Open the Nutzungsgebühren section and switch to "intern".
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Nutzungsgebühren/ }))
    })
    const usageSelect = screen.getByLabelText("Nutzungsart") as HTMLSelectElement
    await act(async () => {
      await user.selectOptions(usageSelect, "intern")
    })

    // After the effect runs, the tip is back to 0 — nothing to round up
    // against a 0 CHF subtotal.
    expect(lastUsage).toBe("intern")
    expect(lastTip).toBe(0)
  })

  it("preserves the manual tip when usageType changes to 'intern'", async () => {
    let lastTip = 0
    const user = userEvent.setup()
    render(<Harness onTipChange={(t) => (lastTip = t)} />)

    // Type a manual tip of 5 CHF.
    const spendeInput = screen.getByLabelText("Trinkgeld/Spende") as HTMLInputElement
    await act(async () => {
      await user.type(spendeInput, "5")
    })
    expect(lastTip).toBe(5)

    // Switch to intern.
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Nutzungsgebühren/ }))
    })
    const usageSelect = screen.getByLabelText("Nutzungsart") as HTMLSelectElement
    await act(async () => {
      await user.selectOptions(usageSelect, "intern")
    })

    // Manual tip survives.
    expect(lastTip).toBe(5)
  })

  it("auto-unchecks the round-up checkbox when no options remain", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const aufrunden = screen.getByRole("checkbox", { name: /aufrunden/i }) as HTMLInputElement
    await act(async () => {
      await user.click(aufrunden)
    })
    expect(aufrunden.checked).toBe(true)

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Nutzungsgebühren/ }))
    })
    const usageSelect = screen.getByLabelText("Nutzungsart") as HTMLSelectElement
    await act(async () => {
      await user.selectOptions(usageSelect, "intern")
    })

    await act(async () => {
      await user.selectOptions(usageSelect, "regular")
    })
    const aufrundenAfter = screen.getByRole("checkbox", { name: /aufrunden/i }) as HTMLInputElement
    expect(aufrundenAfter.checked).toBe(false)
  })

  // Issue #249 — the dominance filter previously stripped the literal
  // next franc and left the user with a single multi-franc bump that
  // was still labelled "nächsten Franken".
  it("dispatches the literal-next-franc round-up for base 66.32 (#249)", async () => {
    let lastTip = 0
    const user = userEvent.setup()
    render(<Harness onTipChange={(t) => (lastTip = t)} />)

    // Type a manual tip of 51.92 — subtotal is 14.4 (one stubbed adult),
    // so roundBase = 14.4 + 51.92 = 66.32, matching the issue scenario.
    const spendeInput = screen.getByLabelText("Trinkgeld/Spende") as HTMLInputElement
    await act(async () => {
      await user.type(spendeInput, "51.92")
    })
    expect(lastTip).toBeCloseTo(51.92, 2)

    // Enable Aufrunden — smallest target is 67 (not 70), so tip = 51.92 + 0.68 = 52.60.
    const aufrunden = screen.getByRole("checkbox", { name: /aufrunden/i })
    await act(async () => {
      await user.click(aufrunden)
    })
    expect(lastTip).toBeCloseTo(52.6, 2)
  })
})
