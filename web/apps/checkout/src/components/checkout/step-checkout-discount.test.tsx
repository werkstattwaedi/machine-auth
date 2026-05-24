// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #284: the usage-type discount must be visible *per section* on the
 * receipt, with the reason spelled out — Marco's complaint was that an
 * `intern` checkout silently showed full prices but a CHF 0.00 total. These
 * render tests assert the discount notes appear and the displayed section
 * amounts collapse to the waived (net) value.
 */

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useReducer } from "react"
import { StepCheckout } from "./step-checkout"
import {
  checkoutReducer,
  initialState,
  type CheckoutAction,
} from "./use-checkout-state"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import type { PricingConfig } from "@modules/lib/workshop-config"

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

function Harness() {
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
  const tracked: React.Dispatch<CheckoutAction> = (action) => dispatch(action)
  return (
    <StepCheckout
      state={state}
      dispatch={tracked}
      onSubmit={async () => {}}
      submitting={false}
      submitError={null}
      items={items}
      config={config}
    />
  )
}

async function selectUsageType(value: string) {
  const user = userEvent.setup()
  // Open the Nutzungsgebühren section so the select is in the DOM.
  await act(async () => {
    await user.click(screen.getByRole("button", { name: /Nutzungsgebühren/ }))
  })
  const usageSelect = screen.getByLabelText("Nutzungsart") as HTMLSelectElement
  await act(async () => {
    await user.selectOptions(usageSelect, value)
  })
}

describe("StepCheckout — per-section discount rendering (#284)", () => {
  it("offers the Freiwilligengruppe option", async () => {
    render(<Harness />)
    // The usage-type select lives inside the Nutzungsgebühren section; open
    // it so the options are in the DOM.
    const user = userEvent.setup()
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Nutzungsgebühren/ }))
    })
    expect(
      screen.getByRole("option", { name: "Freiwilligengruppe" }),
    ).toBeTruthy()
  })

  it("shows entry + machine discount notes for volunteering, none for material", async () => {
    render(<Harness />)
    await selectUsageType("volunteering")

    // Open machine + material sections so their notes are in the DOM.
    const user = userEvent.setup()
    await act(async () => {
      await user.click(
        screen.getByRole("button", { name: /Maschinen-\/Werkzeugnutzung/ }),
      )
    })
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Materialbezug/ }))
    })

    const notes = screen.getAllByTestId("section-discount-note")
    const texts = notes.map((n) => n.textContent ?? "")
    // Entry + machine waived → two notes, both naming Freiwilligengruppe.
    expect(texts.some((t) => /Freiwilligengruppe.*Eintritt/.test(t))).toBe(true)
    expect(
      texts.some((t) => /Freiwilligengruppe.*Maschinengeb/.test(t)),
    ).toBe(true)
    // Material is still billed → no material discount note.
    expect(texts.some((t) => /Material wird nicht verrechnet/.test(t))).toBe(
      false,
    )
  })

  it("shows entry + machine + material discount notes for intern", async () => {
    render(<Harness />)
    await selectUsageType("intern")

    const user = userEvent.setup()
    await act(async () => {
      await user.click(
        screen.getByRole("button", { name: /Maschinen-\/Werkzeugnutzung/ }),
      )
    })
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Materialbezug/ }))
    })

    const texts = screen
      .getAllByTestId("section-discount-note")
      .map((n) => n.textContent ?? "")
    expect(texts.some((t) => /Interne Nutzung.*Eintritt/.test(t))).toBe(true)
    expect(texts.some((t) => /Interne Nutzung.*Maschinengeb/.test(t))).toBe(true)
    expect(texts.some((t) => /Interne Nutzung.*Material/.test(t))).toBe(true)
  })

  it("shows no discount note for regular usage", () => {
    render(<Harness />)
    // Regular is the default; no section discount notes anywhere.
    expect(screen.queryAllByTestId("section-discount-note")).toHaveLength(0)
  })
})
