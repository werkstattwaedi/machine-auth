// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #284: the usage-type discount must be visible *per section* on the
 * receipt, with the reason spelled out — Marco's complaint was that an
 * `intern` checkout silently showed full prices but a CHF 0.00 total.
 * Issue #605: the Nutzungsart is chosen per person on the check-in; Check
 * Out lists each person read-only with their own fee, a confirmation box
 * for the discounted ones, and refuses machine time when everyone only
 * accompanies (CHK-8).
 */

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup, act, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { StepCheckout } from "./step-checkout"
import type { CheckoutPerson } from "./use-checkout-state"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import type { PricingConfig } from "@modules/lib/workshop-config"
import { deriveVisitUsageType, type UsageType } from "@modules/lib/pricing"
import { usagePersons } from "./wizard-context"
import { formatCHF } from "@modules/lib/format"

afterEach(cleanup)
const config: PricingConfig = {
  // One standard fee per user type; the usage-type discount derives the rest.
  entryFees: {
    erwachsen: { regular: 15 },
    kind: { regular: 7.5 },
    firma: { regular: 30 },
  },
  workshops: {} as PricingConfig["workshops"],
  slaLayerPrice: { none: 0.01, member: 0.008 },
  labels: { units: {}, discounts: { none: "Normal", member: "Mitglied" } },
}

const items: CheckoutItemLocal[] = [
  {
    id: "m1",
    workshop: "holz",
    description: "Bandsäge",
    origin: "nfc",
    type: "machine",
    catalogId: null,
    quantity: 1,
    unitPrice: 25,
    totalPrice: 25,
  } as CheckoutItemLocal,
  {
    id: "x1",
    workshop: "holz",
    description: "Sperrholz",
    origin: "qr",
    catalogId: null,
    quantity: 1,
    unitPrice: 10,
    totalPrice: 10,
  } as CheckoutItemLocal,
]

const OWNER = "u-max"

function person(
  overrides: Partial<CheckoutPerson> & { id: string },
): CheckoutPerson {
  return {
    firstName: "Max",
    lastName: "Muster",
    email: "",
    userType: "erwachsen",
    termsAccepted: true,
    isPreFilled: true,
    usageType: "regular",
    ...overrides,
  }
}

function owner(usageType: UsageType = "regular"): CheckoutPerson {
  return person({ id: "p1", userId: OWNER, usageType })
}

function child(usageType: UsageType = "regular"): CheckoutPerson {
  return person({ id: "p2", firstName: "Mia", userType: "kind", usageType })
}

function Harness({
  persons,
  withItems = items,
  initialOpenSections,
}: {
  persons: CheckoutPerson[]
  withItems?: CheckoutItemLocal[]
  initialOpenSections?: string[]
}) {
  const [tip, setTip] = useState(0)
  return (
    <StepCheckout
      persons={persons}
      visitUsageType={deriveVisitUsageType(usagePersons(persons, OWNER))}
      ownerUserId={OWNER}
      tip={tip}
      setTip={setTip}
      paymentMethods={["rechnung"]}
      paymentChoice={null}
      onPaymentChoiceChange={() => {}}
      onCommit={async () => {}}
      onBack={() => {}}
      submitting={false}
      submitError={null}
      items={withItems}
      config={config}
      initialOpenSections={initialOpenSections}
    />
  )
}

// The way on to payment is the payment-method cards (#750).
const submitButton = () => screen.getByTestId("payment-option-rechnung")

async function openSections(...names: RegExp[]) {
  const user = userEvent.setup()
  for (const name of names) {
    await act(async () => {
      await user.click(screen.getByRole("button", { name }))
    })
  }
}

describe("StepCheckout — Nutzungsgebühren per person (#605)", () => {
  it("lists each person read-only with their own fee", () => {
    render(
      <Harness
        persons={[owner("materialbezug"), child("regular")]}
        initialOpenSections={["nutzung"]}
      />,
    )
    expect(screen.queryByTestId("usage-type-trigger")).toBeNull()
    const rows = screen.getAllByTestId("usage-fee-person")
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain(formatCHF(0))
    expect(rows[1].textContent).toContain(formatCHF(7.5))
    // Section amount = the sum of the persons' fees.
    expect(
      screen.getByRole("button", { name: /Nutzungsgebühren/ }).textContent,
    ).toContain(formatCHF(7.5))
  })

  it("confirms one sentence per discounted person", () => {
    render(
      <Harness
        persons={[owner("materialbezug"), child("ermaessigt")]}
        initialOpenSections={["nutzung"]}
      />,
    )
    const box = screen.getByTestId("usage-type-declaration")
    expect(within(box).getAllByRole("listitem")).toHaveLength(2)
  })

  it("shows no confirmation box when everyone is on Reguläre Nutzung", () => {
    render(
      <Harness persons={[owner(), child()]} initialOpenSections={["nutzung"]} />,
    )
    expect(screen.queryByTestId("usage-type-declaration")).toBeNull()
  })

  it("starts with the Nutzungsgebühren section open when asked to", () => {
    render(<Harness persons={[owner()]} initialOpenSections={["nutzung"]} />)
    expect(
      screen.getByRole("button", { name: /Nutzungsgebühren/ }),
    ).toHaveAttribute("aria-expanded", "true")
    expect(
      screen.getByRole("button", { name: /Maschinen-\/Werkzeugnutzung/ }),
    ).toHaveAttribute("aria-expanded", "false")
  })

  it("keeps every section collapsed by default", () => {
    render(<Harness persons={[owner()]} />)
    expect(
      screen.getByRole("button", { name: /Nutzungsgebühren/ }),
    ).toHaveAttribute("aria-expanded", "false")
  })
})

describe("StepCheckout — machine time with everyone on Begleitung (CHK-8)", () => {
  it("shows the error in Maschinen and disables the payment button", () => {
    render(
      <Harness persons={[owner("materialbezug"), child("materialbezug")]} />,
    )
    // The Maschinen section opens by itself so the reason is in view.
    expect(
      screen.getByRole("button", { name: /Maschinen-\/Werkzeugnutzung/ }),
    ).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByTestId("machine-usage-blocked")).toBeTruthy()
    expect(submitButton()).toBeDisabled()
  })

  it("is fine once one person works in the workshop", () => {
    render(<Harness persons={[owner("materialbezug"), child("regular")]} />)
    expect(screen.queryByTestId("machine-usage-blocked")).toBeNull()
    expect(submitButton()).not.toBeDisabled()
  })

  it("is fine without machine items", () => {
    render(
      <Harness
        persons={[owner("materialbezug")]}
        withItems={items.filter((i) => i.type !== "machine")}
      />,
    )
    expect(screen.queryByTestId("machine-usage-blocked")).toBeNull()
    expect(submitButton()).not.toBeDisabled()
  })
})

describe("StepCheckout — per-section discount rendering (#284)", () => {
  it("shows the machine discount note for volunteering, none for material", async () => {
    render(<Harness persons={[owner("volunteering")]} />)
    await openSections(/Maschinen-\/Werkzeugnutzung/, /Materialbezug/)

    const texts = screen
      .getAllByTestId("section-discount-note")
      .map((n) => n.textContent ?? "")
    expect(
      texts.some((t) => /Freiwilligengruppe.*Maschinengeb/.test(t)),
    ).toBe(true)
    // Material is still billed → no material discount note.
    expect(texts.some((t) => /Material wird nicht verrechnet/.test(t))).toBe(
      false,
    )
  })

  it("shows machine + material discount notes for intern", async () => {
    render(<Harness persons={[owner("intern")]} />)
    await openSections(/Maschinen-\/Werkzeugnutzung/, /Materialbezug/)

    const texts = screen
      .getAllByTestId("section-discount-note")
      .map((n) => n.textContent ?? "")
    expect(texts.some((t) => /Interne Nutzung.*Maschinengeb/.test(t))).toBe(true)
    expect(texts.some((t) => /Interne Nutzung.*Material/.test(t))).toBe(true)
  })

  it("shows no discount note for regular usage", () => {
    render(<Harness persons={[owner()]} />)
    expect(screen.queryAllByTestId("section-discount-note")).toHaveLength(0)
  })

  it("waives no machine time for a discounted companion's fee alone", async () => {
    // A KulturLegi child halves only their own fee; the visit stays regular.
    render(<Harness persons={[owner(), child("ermaessigt")]} />)
    await openSections(/Maschinen-\/Werkzeugnutzung/)
    expect(screen.queryAllByTestId("section-discount-note")).toHaveLength(0)
  })
})
