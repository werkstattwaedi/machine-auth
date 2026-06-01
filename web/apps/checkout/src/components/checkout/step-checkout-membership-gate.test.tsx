// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #362 (symmetric guard on the Kosten summary). The wizard's Check-Out
 * step hides the three regular buckets (Nutzungsgebühren / Maschinen /
 * Materialbezug) only for a *genuine* membership-only checkout. A mixed cart
 * — a membership SKU alongside material/machine items or a billed entry fee —
 * must keep all buckets visible, mirroring the picker fix on the Kosten step.
 *
 * This is the existing `membershipOnly` contract in step-checkout.tsx; the
 * test pins it so the symmetric gate can't silently regress when the sibling
 * gate on the workshops step is touched.
 */

import { render, screen, cleanup } from "@testing-library/react"
import { describe, it, expect, afterEach } from "vitest"
import { StepCheckout } from "./step-checkout"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import type { CheckoutPerson } from "./use-checkout-state"

afterEach(cleanup)

const MEMBERSHIP_CATALOG_ID = "membership-fee"

function person(): CheckoutPerson {
  return {
    id: "p1",
    firstName: "Max",
    lastName: "Muster",
    email: "max@test.com",
    userType: "erwachsen",
    termsAccepted: true,
    isPreFilled: false,
  }
}

function membershipItem(): CheckoutItemLocal {
  return {
    id: "m1",
    workshop: "diverses",
    description: "Mitgliedschaft — Familie (Jahr)",
    origin: "manual",
    catalogId: MEMBERSHIP_CATALOG_ID,
    pricingModel: "direct",
    quantity: 1,
    unitPrice: 70,
    totalPrice: 70,
  }
}

function materialItem(): CheckoutItemLocal {
  return {
    id: "i1",
    workshop: "makerspace",
    description: "Acrylglas 3mm",
    origin: "manual",
    catalogId: "acryl",
    pricingModel: "area",
    quantity: 0.1,
    unitPrice: 50,
    totalPrice: 5,
  }
}

function renderStep(items: CheckoutItemLocal[]) {
  return render(
    <StepCheckout
      persons={[person()]}
      usageType="regular"
      setUsageType={() => {}}
      tip={0}
      setTip={() => {}}
      onSubmit={async () => {}}
      onBack={() => {}}
      submitting={false}
      items={items}
      config={null}
      membershipCatalogId={MEMBERSHIP_CATALOG_ID}
    />,
  )
}

describe("StepCheckout — membershipOnly gate (issue #362, symmetric)", () => {
  it("keeps all three buckets for a mixed membership + material cart", () => {
    renderStep([membershipItem(), materialItem()])

    // Membership section still rendered first.
    expect(screen.getByText("Vereinsmitgliedschaft")).toBeTruthy()
    // The three regular buckets are NOT hidden for a mixed cart.
    expect(screen.getByText("Nutzungsgebühren")).toBeTruthy()
    expect(screen.getByText("Maschinen-/Werkzeugnutzung")).toBeTruthy()
    expect(screen.getByText("Materialbezug")).toBeTruthy()
  })

  it("hides the three buckets for a genuine membership-only cart", () => {
    // config=null ⇒ personFeesNet === 0, no material, no machine ⇒ the gate
    // collapses the summary to just the membership section (issue #262).
    renderStep([membershipItem()])

    expect(screen.getByText("Vereinsmitgliedschaft")).toBeTruthy()
    expect(screen.queryByText("Nutzungsgebühren")).toBeNull()
    expect(screen.queryByText("Maschinen-/Werkzeugnutzung")).toBeNull()
    expect(screen.queryByText("Materialbezug")).toBeNull()
  })
})
