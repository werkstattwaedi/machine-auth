// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Coverage for the v5 workshop block: a card per workshop with split
 * machine + material containers, and the new MaterialPicker that replaces
 * the legacy inline AddArticleSearch dropdown. Materials are added via the
 * picker only — there are no inline-edit rows in the cart anymore. See the
 * `Walkthrough v5.html` design handoff for the visual reference.
 */

import { render, screen, cleanup, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { type ReactNode } from "react"
import {
  FirebaseProvider,
  type FirebaseServices,
} from "@modules/lib/firebase-context"
import {
  NfcMachineItemRow,
  WorkshopInlineSection,
  type CheckoutItemLocal,
  type ItemCallbacks,
} from "./inline-rows"
import type {
  PricingConfig,
  CatalogItem,
  DiscountLevel,
} from "@modules/lib/workshop-config"

afterEach(cleanup)

beforeEach(() => {
  // The MaterialPicker uses Sheet from shadcn which queries matchMedia.
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })),
    })
  }
})

function makeConfig(): PricingConfig {
  return {
    entryFees: { erwachsen: {}, kind: {}, firma: {} },
    workshops: { holz: { label: "Holz", order: 1 } } as PricingConfig["workshops"],
    slaLayerPrice: { none: 0.01, member: 0.008 },
    labels: {
      units: { h: "Std.", m2: "m²", m: "m", stk: "Stk.", kg: "kg", chf: "CHF", l: "l" },
      discounts: { none: "Normal", member: "Mitglied" },
    },
  }
}

function makeCallbacks() {
  return {
    addItem: vi.fn<ItemCallbacks["addItem"]>(),
    updateItem: vi.fn<ItemCallbacks["updateItem"]>(),
    removeItem: vi.fn<ItemCallbacks["removeItem"]>(),
  }
}

function makeItem(overrides: Partial<CheckoutItemLocal> = {}): CheckoutItemLocal {
  return {
    id: "item-1",
    workshop: "holz",
    description: "Test Article",
    origin: "manual",
    catalogId: "cat-1",
    pricingModel: "count",
    quantity: 0,
    unitPrice: 0.5,
    totalPrice: 0,
    ...overrides,
  }
}

function makeCatalogItems(): CatalogItem[] {
  return [
    {
      id: "cat-1",
      code: "SCH001",
      name: "Schrauben M5",
      workshops: ["holz"],
      pricingModel: "count",
      unitPrice: { none: 0.5, member: 0.4 },
      active: true,
      userCanAdd: true,
    },
    {
      id: "cat-2",
      code: "PLT001",
      name: "MDF Platte 3mm",
      workshops: ["holz"],
      pricingModel: "area",
      unitPrice: { none: 25, member: 20 },
      active: true,
      userCanAdd: true,
    },
    {
      id: "cat-3",
      code: "LAT001",
      name: "Dachlatte 24x48",
      workshops: ["holz"],
      pricingModel: "length",
      unitPrice: { none: 3, member: 2.5 },
      active: true,
      userCanAdd: true,
    },
    {
      id: "cat-sla",
      code: "9010",
      name: "SLA Druck",
      workshops: ["holz"],
      pricingModel: "sla",
      unitPrice: { none: 250, member: 200 },
      active: true,
      userCanAdd: true,
    },
  ]
}

function FirebaseWrapper({ children }: { children: ReactNode }) {
  const services: FirebaseServices = {
    db: {} as FirebaseServices["db"],
    auth: {} as FirebaseServices["auth"],
    functions: {} as FirebaseServices["functions"],
  }
  return <FirebaseProvider value={services}>{children}</FirebaseProvider>
}

function renderSection(props: {
  items?: CheckoutItemLocal[]
  catalogItems?: CatalogItem[]
  callbacks?: ReturnType<typeof makeCallbacks>
  discountLevel?: DiscountLevel
  checkoutId?: string | null
}) {
  const callbacks = props.callbacks ?? makeCallbacks()
  render(
    <WorkshopInlineSection
      workshopId="holz"
      workshop={{ label: "Holz", order: 1 }}
      config={makeConfig()}
      items={props.items ?? []}
      catalogItems={props.catalogItems ?? makeCatalogItems()}
      callbacks={callbacks}
      discountLevel={props.discountLevel ?? "none"}
      checkoutId={props.checkoutId ?? null}
    />,
    { wrapper: FirebaseWrapper },
  )
  return { callbacks }
}

// ============================================================================
// WorkshopInlineSection — v5 layout
// ============================================================================

describe("WorkshopInlineSection v5", () => {
  it("renders a workshop heading and a per-workshop subtotal", () => {
    renderSection({
      items: [
        makeItem({ id: "i-1", totalPrice: 5 }),
        makeItem({ id: "i-2", totalPrice: 10 }),
      ],
    })
    expect(screen.getByRole("heading", { name: "Holz" })).toBeTruthy()
    expect(screen.getByText("Zwischentotal Holz")).toBeTruthy()
    // 5 + 10 = 15.00
    expect(screen.getByText(/CHF\s*15\.00/)).toBeTruthy()
  })

  it("hides the machine container when no NFC items exist", () => {
    renderSection({
      items: [makeItem({ id: "m-1", origin: "manual", totalPrice: 5 })],
    })
    // The machine block should not render any chevron triggers (which all
    // render the per-machine duration text in minutes).
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => b.textContent?.includes("min"))
    expect(buttons.length).toBe(0)
  })

  it("renders NFC items in the machine container, manual items in the material container", () => {
    renderSection({
      items: [
        makeItem({
          id: "n-1",
          origin: "nfc",
          description: "CO₂ Laser",
          quantity: 0.5,
          totalPrice: 6,
        }),
        makeItem({
          id: "m-1",
          origin: "manual",
          description: "Schrauben M5",
          quantity: 8,
          unitPrice: 0.1,
          totalPrice: 0.8,
        }),
      ],
    })
    expect(screen.getByText("CO₂ Laser")).toBeTruthy()
    expect(screen.getByText("Schrauben M5")).toBeTruthy()
  })

  it("shows an empty hint in the material container when no manual items exist", () => {
    renderSection({ items: [] })
    expect(screen.getByText(/Noch kein Material aus Holz/)).toBeTruthy()
  })

  it("removes a material item when the × button is clicked", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    renderSection({
      items: [makeItem({ id: "m-1", origin: "manual", totalPrice: 0.8 })],
      callbacks,
    })
    const removeBtn = screen.getByRole("button", { name: "Entfernen" })
    await user.click(removeBtn)
    expect(callbacks.removeItem).toHaveBeenCalledWith("m-1")
  })

  it("opens the material picker when 'Material hinzufügen' is clicked", async () => {
    const user = userEvent.setup()
    renderSection({})
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    expect(screen.getByPlaceholderText("Material suchen…")).toBeTruthy()
  })
})

// ============================================================================
// MaterialPicker (covered through WorkshopInlineSection)
// ============================================================================

describe("MaterialPicker", () => {
  it("filters catalog items by name", async () => {
    const user = userEvent.setup()
    renderSection({})
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    await user.type(screen.getByPlaceholderText("Material suchen…"), "Schraub")
    expect(screen.getByText("Schrauben M5")).toBeTruthy()
    expect(screen.queryByText("MDF Platte 3mm")).toBeNull()
  })

  it("filters catalog items by code", async () => {
    const user = userEvent.setup()
    renderSection({})
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    await user.type(screen.getByPlaceholderText("Material suchen…"), "PLT001")
    expect(screen.getByText("MDF Platte 3mm")).toBeTruthy()
    expect(screen.queryByText("Schrauben M5")).toBeNull()
  })

  it("calls addItem after the user enters a quantity and clicks Hinzufügen", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    renderSection({ callbacks })

    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    await user.click(screen.getByText("Schrauben M5"))

    // Form is now expanded — fill the count input and submit.
    const qty = screen.getByRole("spinbutton")
    await user.type(qty, "10")
    await user.click(screen.getByRole("button", { name: "Hinzufügen" }))

    expect(callbacks.addItem).toHaveBeenCalledTimes(1)
    expect(callbacks.addItem.mock.calls[0][0]).toMatchObject({
      catalogId: "cat-1",
      pricingModel: "count",
      workshop: "holz",
      description: "Schrauben M5",
      quantity: 10,
      unitPrice: 0.5,
      totalPrice: 5,
    })
  })

  it("keeps the picker open after Hinzufügen so the member can add another item", async () => {
    const user = userEvent.setup()
    renderSection({})
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    await user.click(screen.getByText("Schrauben M5"))
    const qty = screen.getByRole("spinbutton")
    await user.type(qty, "3")
    await user.click(screen.getByRole("button", { name: "Hinzufügen" }))
    // The search box and result list are still rendered after the add.
    expect(screen.getByPlaceholderText("Material suchen…")).toBeTruthy()
    expect(screen.getByText("MDF Platte 3mm")).toBeTruthy()
  })

  it("disables Hinzufügen until a positive quantity is entered", async () => {
    const user = userEvent.setup()
    renderSection({})
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    await user.click(screen.getByText("Schrauben M5"))
    const addBtn = screen.getByRole("button", { name: "Hinzufügen" })
    expect((addBtn as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByRole("spinbutton"), "2")
    expect((addBtn as HTMLButtonElement).disabled).toBe(false)
  })

  it("converts cm to m² when adding an area-priced item", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    renderSection({ callbacks })
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    await user.click(screen.getByText("MDF Platte 3mm"))
    const inputs = screen.getAllByRole("spinbutton")
    await user.type(inputs[0], "100")
    await user.type(inputs[1], "200")
    await user.click(screen.getByRole("button", { name: "Hinzufügen" }))
    // 1m × 2m = 2 m², 25 CHF/m² → 50.00
    expect(callbacks.addItem.mock.calls[0][0]).toMatchObject({
      pricingModel: "area",
      quantity: 2,
      totalPrice: 50,
    })
  })

  it("uses the member-discounted unit price", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    renderSection({ callbacks, discountLevel: "member" })
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    await user.click(screen.getByText("Schrauben M5"))
    await user.type(screen.getByRole("spinbutton"), "10")
    await user.click(screen.getByRole("button", { name: "Hinzufügen" }))
    expect(callbacks.addItem.mock.calls[0][0]).toMatchObject({
      unitPrice: 0.4,
      totalPrice: 4,
    })
  })

  it("computes the SLA total from resin volume and layer count", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    renderSection({ callbacks })
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    await user.click(screen.getByText("SLA Druck"))
    const inputs = screen.getAllByRole("spinbutton")
    await user.type(inputs[0], "50") // resin ml
    await user.type(inputs[1], "1000") // layers
    await user.click(screen.getByRole("button", { name: "Hinzufügen" }))
    // 50 ml ÷ 1000 × 250 CHF/l = 12.50; 1000 × 0.01 = 10.00; total = 22.50
    expect(callbacks.addItem.mock.calls[0][0]).toMatchObject({
      pricingModel: "sla",
      totalPrice: 22.5,
      formInputs: [
        { quantity: 50, unit: "ml" },
        { quantity: 1000, unit: "layers" },
      ],
    })
  })

  it("sorts catalog items alphabetically", async () => {
    const user = userEvent.setup()
    renderSection({})
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => b.querySelector(".tabular-nums"))
    const labels = buttons.map((b) => b.textContent?.split("CHF")[0].trim())
    expect(labels[0]).toContain("Dachlatte 24x48")
    expect(labels[1]).toContain("MDF Platte 3mm")
    expect(labels[2]).toContain("Schrauben M5")
    expect(labels[3]).toContain("SLA Druck")
  })

  it("shows the empty-state message when the catalog has no items and the query is empty", async () => {
    const user = userEvent.setup()
    renderSection({ catalogItems: [] })
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    expect(screen.getByText(/Keine Treffer/)).toBeTruthy()
  })

  it("hides the empty-state when the user types so the ad-hoc fallbacks can appear", async () => {
    const user = userEvent.setup()
    renderSection({ catalogItems: [] })
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    await user.type(
      screen.getByPlaceholderText("Material suchen…"),
      "Reststück",
    )
    expect(screen.queryByText(/Keine Treffer/)).toBeNull()
    expect(screen.getByText("Kein passender Eintrag?")).toBeTruthy()
  })

  it("does not render the legacy 'Frage am Empfang' footer", async () => {
    const user = userEvent.setup()
    renderSection({})
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    expect(screen.queryByText(/Frage am Empfang/)).toBeNull()
  })
})

// ============================================================================
// MaterialPicker — ad-hoc fallback creation
// ============================================================================

describe("MaterialPicker ad-hoc fallback", () => {
  it("only shows the fallback section when the search query is non-empty", async () => {
    const user = userEvent.setup()
    renderSection({})
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    expect(screen.queryByText("Kein passender Eintrag?")).toBeNull()
    await user.type(screen.getByPlaceholderText("Material suchen…"), "Holzkitt")
    expect(screen.getByText("Kein passender Eintrag?")).toBeTruthy()
  })

  it("adds a Pauschal CHF item with the typed description", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    renderSection({ callbacks })
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    await user.type(screen.getByPlaceholderText("Material suchen…"), "Sondermaterial")
    // Click the Pauschal CHF fallback row.
    await user.click(screen.getByText("+ Pauschal CHF"))
    // DirectForm renders a description input prefilled with the query.
    const desc = screen.getByPlaceholderText("Was hast du gebraucht?") as HTMLInputElement
    expect(desc.value).toBe("Sondermaterial")
    // Cost input is the only spinbutton in DirectForm.
    await user.type(screen.getByRole("spinbutton"), "12.50")
    await user.click(screen.getByRole("button", { name: "Hinzufügen" }))
    expect(callbacks.addItem).toHaveBeenCalledTimes(1)
    expect(callbacks.addItem.mock.calls[0][0]).toMatchObject({
      catalogId: null,
      pricingModel: "direct",
      description: "Sondermaterial",
      unitPrice: 12.5,
      totalPrice: 12.5,
    })
  })

  it("adds a count-priced ad-hoc item with editable unit price", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    renderSection({ callbacks })
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    await user.type(screen.getByPlaceholderText("Material suchen…"), "Spezialschraube")
    await user.click(screen.getByText("+ Stk"))
    // First spinbutton = qty, second = unit price.
    const inputs = screen.getAllByRole("spinbutton")
    expect(inputs.length).toBe(2)
    await user.type(inputs[0], "5")
    await user.type(inputs[1], "0.30")
    await user.click(screen.getByRole("button", { name: "Hinzufügen" }))
    expect(callbacks.addItem.mock.calls[0][0]).toMatchObject({
      catalogId: null,
      pricingModel: "count",
      description: "Spezialschraube",
      quantity: 5,
      unitPrice: 0.3,
      totalPrice: 1.5,
    })
  })

  it("adds an ad-hoc area item with cm→m² conversion and editable unit price", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    renderSection({ callbacks })
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    await user.type(screen.getByPlaceholderText("Material suchen…"), "Plattenrest")
    await user.click(screen.getByText("+ m²"))
    const inputs = screen.getAllByRole("spinbutton")
    // L, B, Preis/m²
    expect(inputs.length).toBe(3)
    await user.type(inputs[0], "100")
    await user.type(inputs[1], "50")
    await user.type(inputs[2], "20")
    await user.click(screen.getByRole("button", { name: "Hinzufügen" }))
    // 1m × 0.5m = 0.5 m²; 0.5 × 20 = 10.00
    expect(callbacks.addItem.mock.calls[0][0]).toMatchObject({
      pricingModel: "area",
      quantity: 0.5,
      unitPrice: 20,
      totalPrice: 10,
    })
  })

  it("disables Hinzufügen for an ad-hoc row until description, quantity and price are filled", async () => {
    const user = userEvent.setup()
    renderSection({})
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    await user.type(screen.getByPlaceholderText("Material suchen…"), "X")
    await user.click(screen.getByText("+ Stk"))
    const addBtn = screen.getByRole("button", { name: "Hinzufügen" })
    expect((addBtn as HTMLButtonElement).disabled).toBe(true)
    const inputs = screen.getAllByRole("spinbutton")
    await user.type(inputs[0], "1")
    expect((addBtn as HTMLButtonElement).disabled).toBe(true)
    await user.type(inputs[1], "1")
    expect((addBtn as HTMLButtonElement).disabled).toBe(false)
  })

  it("converts grams to kg for ad-hoc weight items", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    renderSection({ callbacks })
    await user.click(screen.getByRole("button", { name: /Material hinzufügen/ }))
    await user.type(screen.getByPlaceholderText("Material suchen…"), "Filament-Rest")
    await user.click(screen.getByText("+ kg"))
    const inputs = screen.getAllByRole("spinbutton")
    await user.type(inputs[0], "500") // grams
    await user.type(inputs[1], "20") // CHF/kg
    await user.click(screen.getByRole("button", { name: "Hinzufügen" }))
    // 0.5 kg × 20 CHF = 10.00
    expect(callbacks.addItem.mock.calls[0][0]).toMatchObject({
      pricingModel: "weight",
      quantity: 0.5,
      unitPrice: 20,
      totalPrice: 10,
      formInputs: [{ quantity: 500, unit: "g" }],
    })
  })
})

// ============================================================================
// NfcMachineItemRow — collapsed summary, click to expand
// ============================================================================

describe("NfcMachineItemRow", () => {
  it("displays duration in minutes", () => {
    render(
      <NfcMachineItemRow
        item={makeItem({
          origin: "nfc",
          quantity: 0.5,
          unitPrice: 12,
          totalPrice: 6,
          description: "Maschinennutzung",
        })}
        checkoutId={null}
      />,
      { wrapper: FirebaseWrapper },
    )
    expect(screen.getByText("30 min")).toBeTruthy()
    expect(screen.getByText(/CHF\s*6\.00/)).toBeTruthy()
  })

  it("shows the machine name", () => {
    render(
      <NfcMachineItemRow
        item={makeItem({
          origin: "nfc",
          description: "CO₂ Laser",
          quantity: 0.5,
        })}
        checkoutId={null}
      />,
      { wrapper: FirebaseWrapper },
    )
    expect(screen.getByText("CO₂ Laser")).toBeTruthy()
  })

  it("does not have a remove button (NFC entries are unremovable)", () => {
    const { container } = render(
      <NfcMachineItemRow
        item={makeItem({
          origin: "nfc",
          description: "Maschinennutzung",
          quantity: 0.5,
        })}
        checkoutId={null}
      />,
      { wrapper: FirebaseWrapper },
    )
    // No close-icon button anywhere in the row.
    expect(within(container).queryByLabelText("Entfernen")).toBeNull()
  })

  it("disables the expand toggle when checkoutId is null", () => {
    render(
      <NfcMachineItemRow
        item={makeItem({
          origin: "nfc",
          description: "Maschinennutzung",
          quantity: 0.5,
        })}
        checkoutId={null}
      />,
      { wrapper: FirebaseWrapper },
    )
    const button = screen.getByRole("button")
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})
