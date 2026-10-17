// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Choosing the payment on the Check Out page (issue #750): the cards under
 * the total, a CHF 0 visit's single card, step 4 in place and "Zurück"
 * back to an editable step 3 that kept the donation.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { useState } from "react"
import { StepCheckout, SpendeCard } from "./step-checkout"
import type { CheckoutPerson } from "./use-checkout-state"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import type { PricingConfig } from "@modules/lib/workshop-config"
import type { UsageType } from "@modules/lib/pricing"
import type { PaymentMethod } from "@oww/shared"
import type { PaymentChoice } from "./payment-methods"

afterEach(cleanup)

function config(adultFee: number): PricingConfig {
  return {
    entryFees: {
      erwachsen: { regular: adultFee },
      kind: { regular: 0 },
      firma: { regular: 0 },
    },
    workshops: {} as PricingConfig["workshops"],
    slaLayerPrice: { none: 0.01, member: 0.008 },
    labels: { units: {}, discounts: { none: "Normal", member: "Mitglied" } },
  }
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

function Harness({
  fee = 15,
  methods = ["rechnung", "raisenow"],
  onCommit = async () => {},
  onBack = () => {},
  onChoice = () => {},
}: {
  fee?: number
  methods?: PaymentMethod[]
  onCommit?: (choice: PaymentChoice) => Promise<void>
  onBack?: () => void
  onChoice?: (choice: PaymentChoice | null) => void
}) {
  const [usageType, setUsageType] = useState<UsageType>("regular")
  const [tip, setTip] = useState(0)
  const [choice, setChoice] = useState<PaymentChoice | null>(null)
  return (
    <StepCheckout
      persons={persons}
      usageType={usageType}
      setUsageType={setUsageType}
      tip={tip}
      setTip={setTip}
      paymentMethods={methods}
      paymentChoice={choice}
      onPaymentChoiceChange={(c) => {
        onChoice(c)
        setChoice(c)
      }}
      onCommit={onCommit}
      onBack={onBack}
      submitting={false}
      submitError={null}
      items={[] as CheckoutItemLocal[]}
      config={config(fee)}
    />
  )
}

function folded(testId: string): boolean {
  return !!screen.getByTestId(testId).closest("[aria-hidden='true']")
}

describe("StepCheckout — payment choice (#750)", () => {
  it("offers one card per method, nothing preselected, no way to skip ahead", () => {
    render(<Harness />)
    expect(screen.getByTestId("payment-option-rechnung")).toBeTruthy()
    expect(screen.getByTestId("payment-option-raisenow")).toBeTruthy()
    expect(screen.queryByTestId("payment-frame")).toBeNull()
    expect(screen.queryByRole("button", { name: /Weiter/ })).toBeNull()
  })

  it("choosing a card shows step 4 in place; its button commits that method", () => {
    const onCommit = vi.fn(async () => {})
    render(<Harness onCommit={onCommit} />)

    fireEvent.click(screen.getByTestId("payment-option-rechnung"))

    expect(folded("payment-option-rechnung")).toBe(true)
    expect(screen.getByTestId("payment-frame")).toBeTruthy()
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Rechnung senden" }))
    expect(onCommit).toHaveBeenCalledWith("rechnung")
  })

  it("TWINT commits from its pay button, not from choosing the card", () => {
    const onCommit = vi.fn(async () => {})
    render(<Harness onCommit={onCommit} />)

    fireEvent.click(screen.getByTestId("payment-option-raisenow"))
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /Mit TWINT bezahlen/ }))
    expect(onCommit).toHaveBeenCalledWith("raisenow")
  })

  it("Zurück on step 4 returns to an editable step 3 that kept the donation", () => {
    const onBack = vi.fn()
    render(<Harness onBack={onBack} />)

    const spende = screen.getByLabelText("Trinkgeld/Spende") as HTMLInputElement
    fireEvent.focus(spende)
    fireEvent.change(spende, { target: { value: "5" } })
    fireEvent.blur(spende)

    fireEvent.click(screen.getByTestId("payment-option-rechnung"))
    fireEvent.click(screen.getByRole("button", { name: /Zurück/ }))

    expect(onBack).not.toHaveBeenCalled()
    expect(folded("payment-option-rechnung")).toBe(false)
    expect((screen.getByLabelText("Trinkgeld/Spende") as HTMLInputElement).value).toBe("5.00")

    // On step 3, Zurück leaves for the visit page.
    fireEvent.click(screen.getByRole("button", { name: /Zurück/ }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it("a CHF 0 visit offers the single free card, which commits at once (BIL-8)", () => {
    const onCommit = vi.fn(async () => {})
    render(<Harness fee={0} onCommit={onCommit} />)

    expect(screen.queryByTestId("payment-option-rechnung")).toBeNull()
    fireEvent.click(screen.getByTestId("payment-option-free"))
    expect(onCommit).toHaveBeenCalledWith("free")
  })

  it("a donation on a CHF 0 visit brings the payment cards back", () => {
    render(<Harness fee={0} />)
    expect(screen.getByTestId("payment-option-free")).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Trinkgeld/Spende"), { target: { value: "3" } })

    expect(screen.queryByTestId("payment-option-free")).toBeNull()
    expect(screen.getByTestId("payment-option-rechnung")).toBeTruthy()
  })
})

describe("SpendeCard — collapsed on a phone", () => {
  function renderCard(spende: number) {
    return render(
      <SpendeCard
        spende={spende}
        onSpendeChange={() => {}}
        roundUpEnabled={false}
        roundUpBase={15}
        roundUpOptions={[]}
        roundUpTarget={null}
        roundUpDelta={0}
        onRoundUpToggle={() => {}}
        onRoundUpTarget={() => {}}
        startCollapsed
      />,
    )
  }

  it("starts as one line and opens on tap", () => {
    renderCard(0)
    expect(screen.queryByLabelText("Trinkgeld/Spende")).toBeNull()
    fireEvent.click(screen.getByRole("button", { expanded: false }))
    expect(screen.getByLabelText("Trinkgeld/Spende")).toBeTruthy()
  })

  it("shows the amount once one is set", () => {
    renderCard(5)
    expect(screen.getByRole("button", { expanded: false }).textContent).toContain("5.00")
  })
})
