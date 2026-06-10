// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #446: on narrow mobile widths the long compound section title
 * "Maschinen-/Werkzeugnutzung" broke mid-word ("…Werkzeugnutzu" / "ng")
 * because the title span used `break-words`. The fix collapses the title to a
 * single line with an ellipsis (`truncate`). This test locks that in so a
 * future revert to mid-word wrapping fails loudly.
 */

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { useState } from "react"
import { StepCheckout } from "./step-checkout"
import type { CheckoutPerson } from "./use-checkout-state"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import type { PricingConfig } from "@modules/lib/workshop-config"
import type { UsageType } from "@modules/lib/pricing"

afterEach(cleanup)

const config: PricingConfig = {
  entryFees: {
    erwachsen: { regular: 15 },
    kind: { regular: 7.5 },
    firma: { regular: 30 },
  },
  workshops: {} as PricingConfig["workshops"],
  slaLayerPrice: { none: 0.01, member: 0.008 },
  labels: { units: {}, discounts: { none: "Normal", member: "Mitglied" } },
}

const persons: CheckoutPerson[] = [
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

function Harness() {
  const [usageType, setUsageType] = useState<UsageType>("regular")
  const [tip, setTip] = useState(0)
  return (
    <StepCheckout
      persons={persons}
      usageType={usageType}
      setUsageType={setUsageType}
      tip={tip}
      setTip={setTip}
      onSubmit={async () => {}}
      onBack={() => {}}
      submitting={false}
      submitError={null}
      items={[] as CheckoutItemLocal[]}
      config={config}
    />
  )
}

describe("StepCheckout — section title truncation (#446)", () => {
  it("renders the long machine-usage title on a single line with ellipsis, not mid-word wrap", () => {
    render(<Harness />)
    const title = screen.getByText("Maschinen-/Werkzeugnutzung")
    // `truncate` is Tailwind for overflow-hidden + text-overflow-ellipsis +
    // white-space-nowrap — exactly the single-line ellipsis the bug asked for.
    expect(title.className).toContain("truncate")
    // The old behaviour broke the compound word; guard against a regression.
    expect(title.className).not.toContain("break-words")
  })
})
