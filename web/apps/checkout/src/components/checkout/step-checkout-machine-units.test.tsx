// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #653: the Check-Out summary rendered every item in the
 * Maschinen-/Werkzeugnutzung section as hours — a per-piece machine
 * service ("Sandstrahlen Metall", `pricingModel: "count"`, 2 Stk. at
 * 10.00/Stk.) showed up as "120 Min · 10.00/h" and its quantity was
 * summed into "… Min total". The rows now use the cart's per-pricing-model
 * formatters and only time-priced items contribute minutes.
 */

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { useState } from "react"
import {
  StepCheckout,
  machineRowFromItem,
  timedMachineMinutes,
} from "./step-checkout"
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

/** NFC-tracked machine time: 1.5 h at 25.00/h. */
const timedMachine: CheckoutItemLocal = {
  id: "m-time",
  workshop: "holz",
  description: "Bandsäge",
  origin: "nfc",
  type: "machine",
  catalogId: "bandsaege",
  variantId: "default",
  pricingModel: "time",
  quantity: 1.5,
  unitPrice: 25,
  totalPrice: 37.5,
}

/** Per-piece machine service from the catalog: 2 Stk. at 10.00/Stk. */
const perPieceMachine: CheckoutItemLocal = {
  id: "m-count",
  workshop: "metall",
  description: "Sandstrahlen Metall",
  origin: "manual",
  type: "machine",
  catalogId: "0006",
  variantId: "default",
  pricingModel: "count",
  quantity: 2,
  unitPrice: 10,
  totalPrice: 20,
}

function Harness({ items }: { items: CheckoutItemLocal[] }) {
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
      items={items}
      config={config}
      initialOpenSections={["maschinen"]}
    />
  )
}

describe("StepCheckout — per-piece machine items (#653)", () => {
  it("renders a count-priced machine item as pieces, not minutes", () => {
    render(<Harness items={[perPieceMachine]} />)
    expect(screen.getByText("2 Stk.")).toBeTruthy()
    expect(screen.getByText("10.00/Stk.")).toBeTruthy()
    expect(screen.queryByText("120 Min")).toBeNull()
    expect(screen.queryByText("10.00/h")).toBeNull()
  })

  it("omits the minute total when no machine item is time-priced", () => {
    render(<Harness items={[perPieceMachine]} />)
    expect(screen.getByText("1 Maschine")).toBeTruthy()
    expect(screen.queryByText(/Min total/)).toBeNull()
  })

  it("keeps the timed rendering for time-priced items and sums only those", () => {
    render(<Harness items={[timedMachine, perPieceMachine]} />)
    // Timed row unchanged from before the fix.
    expect(screen.getByText("90 Min")).toBeTruthy()
    expect(screen.getByText("25.00/h")).toBeTruthy()
    // 2 Stk. must not add 120 min to the header.
    expect(screen.getByText("2 Maschinen · 90 Min total")).toBeTruthy()
  })
})

describe("machine row helpers (#653)", () => {
  it("timedMachineMinutes ignores per-piece items", () => {
    expect(timedMachineMinutes([timedMachine, perPieceMachine])).toBe(90)
    expect(timedMachineMinutes([perPieceMachine])).toBe(0)
  })

  it("treats a legacy machine row without pricingModel as time-priced", () => {
    const legacy: CheckoutItemLocal = { ...timedMachine, pricingModel: null }
    expect(timedMachineMinutes([legacy])).toBe(90)
    const row = machineRowFromItem(legacy)
    expect(row.menge).toBe("90 Min")
    expect(row.kosten).toBe("25.00/h")
  })

  it("formats a per-piece machine row by its pricing model", () => {
    const row = machineRowFromItem(perPieceMachine)
    expect(row.menge).toBe("2 Stk.")
    expect(row.kosten).toBe("10.00/Stk.")
    expect(row.preis).toBe("20.00")
  })
})
