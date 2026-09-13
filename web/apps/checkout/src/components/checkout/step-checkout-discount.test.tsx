// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #284: the usage-type discount must be visible *per section* on the
 * receipt, with the reason spelled out — Marco's complaint was that an
 * `intern` checkout silently showed full prices but a CHF 0.00 total. These
 * render tests assert the discount notes appear on the machine/material
 * sections. Issue #570 moved the entry-fee explanation onto the Nutzungsart
 * control itself (effect line + declaration note), so the Nutzungsgebühren
 * section carries no italic note any more.
 */

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { StepCheckout } from "./step-checkout"
import type { CheckoutPerson } from "./use-checkout-state"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import type { PricingConfig } from "@modules/lib/workshop-config"
import type { UsageType } from "@modules/lib/pricing"

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
  anonymous = false,
  initialOpenSections,
}: {
  anonymous?: boolean
  initialOpenSections?: string[]
}) {
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
      anonymous={anonymous}
      initialOpenSections={initialOpenSections}
    />
  )
}

async function openUsageTypeList() {
  const user = userEvent.setup()
  // Open the Nutzungsgebühren section so the Nutzungsart control is
  // reachable, then drop the list down.
  await act(async () => {
    await user.click(screen.getByRole("button", { name: /Nutzungsgebühren/ }))
  })
  await act(async () => {
    await user.click(screen.getByLabelText("Nutzungsart"))
  })
  return user
}

async function selectUsageType(label: RegExp) {
  const user = await openUsageTypeList()
  await act(async () => {
    await user.click(screen.getByRole("option", { name: label }))
  })
}

describe("StepCheckout — Nutzungsart control (#570)", () => {
  it("lists every usage type in the agreed order for identified visitors", async () => {
    render(<Harness />)
    await openUsageTypeList()
    const names = screen
      .getAllByRole("option")
      .map((o) => o.getAttribute("aria-labelledby"))
      .map((id) => document.getElementById(id ?? "")?.textContent ?? "")
    expect(names).toEqual([
      "Reguläre Nutzung",
      "Ermässigte Nutzung (KulturLegi)",
      "Hangenmoos AG",
      "Nur Materialbezug",
      "Freiwilligengruppe",
      "Interne Nutzung",
    ])
  })

  it("explains each option: price effect and who it applies to", async () => {
    render(<Harness />)
    await openUsageTypeList()
    const volunteering = screen.getByRole("option", {
      name: "Freiwilligengruppe",
    })
    expect(volunteering.textContent).toContain(
      "Nutzungsgebühr und Maschinen werden nicht verrechnet",
    )
    expect(volunteering.textContent).toContain("Falls du heute eine Werkstatt")
    // Regular carries no effect line.
    expect(
      screen.getByRole("option", { name: "Reguläre Nutzung" }).textContent,
    ).toContain("Für alle, die die Werkstatt benutzen.")
  })

  it("hides the account-only types from anonymous checkouts", async () => {
    render(<Harness anonymous />)
    await openUsageTypeList()
    expect(
      screen.queryByRole("option", { name: "Freiwilligengruppe" }),
    ).toBeNull()
    expect(screen.queryByRole("option", { name: "Interne Nutzung" })).toBeNull()
    expect(screen.getByRole("option", { name: "Hangenmoos AG" })).toBeTruthy()
  })

  it("shows the effect on the field and the declaration note after choosing a discount", async () => {
    render(<Harness />)
    expect(screen.queryByTestId("usage-type-declaration")).toBeNull()
    await selectUsageType(/Ermässigte Nutzung/)

    const trigger = screen.getByLabelText("Nutzungsart")
    expect(trigger.textContent).toContain("Ermässigte Nutzung (KulturLegi)")
    expect(trigger.textContent).toContain(
      "50% Ermässigung auf Nutzungsgebühr",
    )
    expect(screen.getByTestId("usage-type-declaration").textContent).toMatch(
      /KulturLegi dabei zu haben.*stichprobenweise/,
    )
    // Section summary + per-person fee follow in the same render.
    expect(screen.getByText(/1 Person · Ermässigte Nutzung/)).toBeTruthy()
    // Section amount and the person row both show the halved fee.
    expect(screen.getAllByText("CHF 7.50")).toHaveLength(2)
  })

  it("starts with the Nutzungsgebühren section open when asked to", () => {
    render(<Harness initialOpenSections={["nutzung"]} />)
    expect(
      screen.getByRole("button", { name: /Nutzungsgebühren/ }),
    ).toHaveAttribute("aria-expanded", "true")
    expect(
      screen.getByRole("button", { name: /Maschinen-\/Werkzeugnutzung/ }),
    ).toHaveAttribute("aria-expanded", "false")
  })

  it("keeps every section collapsed by default", () => {
    render(<Harness />)
    expect(
      screen.getByRole("button", { name: /Nutzungsgebühren/ }),
    ).toHaveAttribute("aria-expanded", "false")
  })
})

describe("StepCheckout — per-section discount rendering (#284)", () => {
  it("shows the machine discount note for volunteering, none for material", async () => {
    render(<Harness />)
    await selectUsageType(/Freiwilligengruppe/)

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
    // The entry-fee waiver is explained on the control, not as a note.
    expect(texts.some((t) => /Nutzungsgebühr/.test(t))).toBe(false)
    expect(screen.getByTestId("usage-type-declaration").textContent).toContain(
      "Werkstattbetreuung",
    )
  })

  it("shows machine + material discount notes for intern", async () => {
    render(<Harness />)
    await selectUsageType(/Interne Nutzung/)

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
    expect(texts.some((t) => /Interne Nutzung.*Maschinengeb/.test(t))).toBe(true)
    expect(texts.some((t) => /Interne Nutzung.*Material/.test(t))).toBe(true)
  })

  it("shows no discount note for regular usage", () => {
    render(<Harness />)
    // Regular is the default; no section discount notes anywhere.
    expect(screen.queryAllByTestId("section-discount-note")).toHaveLength(0)
  })
})
