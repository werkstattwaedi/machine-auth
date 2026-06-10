// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The club's member roster needs a postal address, so the membership line
 * item shows a mandatory address sub-form and "Weiter zum Bezahlen" is
 * blocked until it's filled (combined-signin refactor). A complete address
 * from the member's profile pre-fills the form and keeps the section
 * collapsed.
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

function renderStep(
  p: CheckoutPerson,
  onSubmit: () => Promise<void>,
  opts: {
    profileBillingAddress?: {
      company?: string
      street?: string
      zip?: string
      city?: string
    } | null
    onPrimaryBillingChange?: (updates: Partial<CheckoutPerson>) => void
  } = {},
) {
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
      onPrimaryBillingChange={opts.onPrimaryBillingChange ?? (() => {})}
      profileBillingAddress={opts.profileBillingAddress ?? null}
    />,
  )
}

function membershipSectionExpanded(): boolean {
  return (
    document
      .querySelector('[aria-controls="mitgliedschaft-detail"]')
      ?.getAttribute("aria-expanded") === "true"
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

  it("auto-opens the section when the address is missing", () => {
    renderStep(person(), async () => {})
    expect(membershipSectionExpanded()).toBe(true)
  })

  it("pre-fills from the profile address and stays collapsed", () => {
    const onPrimaryBillingChange = vi.fn()
    renderStep(person(), async () => {}, {
      profileBillingAddress: {
        company: "",
        street: "Seestrasse 42",
        zip: "8820",
        city: "Wädenswil",
      },
      onPrimaryBillingChange,
    })

    expect(onPrimaryBillingChange).toHaveBeenCalledWith({
      billingCompany: "",
      billingStreet: "Seestrasse 42",
      billingZip: "8820",
      billingCity: "Wädenswil",
    })
    expect(membershipSectionExpanded()).toBe(false)
  })

  it("ignores an incomplete profile address and opens the section", () => {
    const onPrimaryBillingChange = vi.fn()
    renderStep(person(), async () => {}, {
      profileBillingAddress: { street: "Seestrasse 42" },
      onPrimaryBillingChange,
    })

    // Partial profile address still pre-fills what exists…
    expect(onPrimaryBillingChange).toHaveBeenCalled()
    // …but the section opens because the address is incomplete.
    expect(membershipSectionExpanded()).toBe(true)
  })

  it("keeps the person's own address over the profile one", () => {
    const onPrimaryBillingChange = vi.fn()
    renderStep(
      person({
        billingStreet: "Eigene Strasse 1",
        billingZip: "8000",
        billingCity: "Zürich",
      }),
      async () => {},
      {
        profileBillingAddress: {
          street: "Seestrasse 42",
          zip: "8820",
          city: "Wädenswil",
        },
        onPrimaryBillingChange,
      },
    )

    expect(onPrimaryBillingChange).not.toHaveBeenCalled()
    expect(membershipSectionExpanded()).toBe(false)
  })
})
