// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * A membership generates an invoice that needs a postal address, so the
 * membership line item shows a mandatory address sub-form and "Weiter zum
 * Bezahlen" is blocked until it's filled (combined-signin refactor).
 */

import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { describe, it, expect, afterEach, vi } from "vitest"
import { StepCheckout } from "./step-checkout"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import type { CheckoutPerson } from "./use-checkout-state"

afterEach(cleanup)

const MEMBERSHIP_CATALOG_ID = "membership-fee"

function person(overrides: Partial<CheckoutPerson> = {}): CheckoutPerson {
  return {
    id: "p1",
    firstName: "Max",
    lastName: "Muster",
    email: "max@test.com",
    userType: "erwachsen",
    termsAccepted: true,
    isPreFilled: false,
    ...overrides,
  }
}

function membershipItem(): CheckoutItemLocal {
  return {
    id: "m1",
    workshop: "diverses",
    description: "Mitgliedschaft — Einzel (Jahr)",
    origin: "manual",
    catalogId: MEMBERSHIP_CATALOG_ID,
    pricingModel: "direct",
    quantity: 1,
    unitPrice: 50,
    totalPrice: 50,
  }
}

function renderStep(p: CheckoutPerson, onSubmit: () => Promise<void>) {
  return render(
    <StepCheckout
      persons={[p]}
      usageType="regular"
      setUsageType={() => {}}
      tip={0}
      setTip={() => {}}
      onSubmit={onSubmit}
      onBack={() => {}}
      submitting={false}
      items={[membershipItem()]}
      config={null}
      membershipCatalogId={MEMBERSHIP_CATALOG_ID}
      onPrimaryBillingChange={() => {}}
    />,
  )
}

describe("StepCheckout — membership billing address gate", () => {
  it("shows the mandatory address sub-form in the membership section", () => {
    renderStep(person(), async () => {})
    expect(screen.getByTestId("membership-address")).toBeTruthy()
    expect(screen.getByLabelText("Strasse und Hausnummer")).toBeTruthy()
  })

  it("blocks Weiter zum Bezahlen when the address is missing", async () => {
    const onSubmit = vi.fn(async () => {})
    renderStep(person(), onSubmit)

    fireEvent.click(screen.getByText("Weiter zum Bezahlen"))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(await screen.findByText("Strasse ist erforderlich")).toBeTruthy()
  })

  it("submits once the address is complete", async () => {
    const onSubmit = vi.fn(async () => {})
    renderStep(
      person({
        billingStreet: "Seestrasse 12",
        billingZip: "8820",
        billingCity: "Wädenswil",
      }),
      onSubmit,
    )

    fireEvent.click(screen.getByText("Weiter zum Bezahlen"))

    // Allow the async submit handler to resolve.
    await Promise.resolve()
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
