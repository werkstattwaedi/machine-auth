// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, afterEach } from "vitest"
import { type ReactNode } from "react"
import { FirebaseProvider, type FirebaseServices } from "@modules/lib/firebase-context"
import {
  CatalogItemRow,
  NfcMachineItemRow,
  WorkshopInlineSection,
  type CheckoutItemLocal,
  type ItemCallbacks,
} from "./inline-rows"
import type { PricingConfig, CatalogItem, DiscountLevel } from "@modules/lib/workshop-config"

afterEach(cleanup)

// --- Test helpers ---

function makeConfig(): PricingConfig {
  return {
    entryFees: { erwachsen: {}, kind: {}, firma: {} },
    workshops: { holz: { label: "Holz", order: 1 } } as PricingConfig["workshops"],
    labels: {
      units: { h: "Std.", m2: "m²", m: "m", stk: "Stk.", kg: "kg", chf: "CHF" },
      discounts: { none: "Normal", member: "Mitglied", intern: "Intern" },
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
      unitPrice: { none: 0.5, member: 0.4, intern: 0 },
      active: true,
      userCanAdd: true,
    },
    {
      id: "cat-2",
      code: "PLT001",
      name: "MDF Platte 3mm",
      workshops: ["holz"],
      pricingModel: "area",
      unitPrice: { none: 25, member: 20, intern: 0 },
      active: true,
      userCanAdd: true,
    },
    {
      id: "cat-3",
      code: "LAT001",
      name: "Dachlatte 24x48",
      workshops: ["holz"],
      pricingModel: "length",
      unitPrice: { none: 3, member: 2.5, intern: 0 },
      active: true,
      userCanAdd: true,
    },
  ]
}

/** Wrapper providing a stub FirebaseProvider (needed for NfcMachineItemRow's useDb()) */
function FirebaseWrapper({ children }: { children: ReactNode }) {
  const services: FirebaseServices = {
    db: {} as FirebaseServices["db"],
    auth: {} as FirebaseServices["auth"],
    functions: {} as FirebaseServices["functions"],
  }
  return <FirebaseProvider value={services}>{children}</FirebaseProvider>
}

// ============================================================================
// SimpleItemRow (via CatalogItemRow)
// ============================================================================

describe("SimpleItemRow", () => {
  it("updates quantity and total for count model", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    const item = makeItem({ pricingModel: "count", unitPrice: 0.5 })

    render(
      <CatalogItemRow item={item} config={makeConfig()} index={0} callbacks={callbacks} />,
    )

    // Only one spinbutton for count model with catalog item (price not editable)
    const input = screen.getByRole("spinbutton")
    await user.clear(input)
    await user.type(input, "5")
    // onChange fires per keystroke without onBlurSave
    const lastCall = callbacks.updateItem.mock.calls.at(-1)!
    expect(lastCall[0]).toBe("item-1")
    expect(lastCall[1]).toMatchObject({ quantity: 5, totalPrice: 2.5 })
  })

  it("converts grams to kg for weight model", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    const item = makeItem({ pricingModel: "weight", unitPrice: 10 })

    render(
      <CatalogItemRow item={item} config={makeConfig()} index={0} callbacks={callbacks} />,
    )

    const input = screen.getByRole("spinbutton")
    await user.clear(input)
    await user.type(input, "500")
    const lastCall = callbacks.updateItem.mock.calls.at(-1)!
    expect(lastCall[1]).toMatchObject({ quantity: 0.5 })
  })

  it("converts minutes to hours for time model", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    const item = makeItem({ pricingModel: "time", unitPrice: 12 })

    render(
      <CatalogItemRow item={item} config={makeConfig()} index={0} callbacks={callbacks} />,
    )

    const input = screen.getByRole("spinbutton")
    await user.clear(input)
    await user.type(input, "30")
    const lastCall = callbacks.updateItem.mock.calls.at(-1)!
    expect(lastCall[1]).toMatchObject({ quantity: 0.5 })
  })

  it("shows editable price input for non-catalog items", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    const item = makeItem({ catalogId: null, unitPrice: 0, pricingModel: "count" })

    render(
      <CatalogItemRow item={item} config={makeConfig()} index={0} callbacks={callbacks} />,
    )

    // Two spinbuttons: quantity + editable price
    const inputs = screen.getAllByRole("spinbutton")
    expect(inputs.length).toBe(2)

    // Type a price in the second input
    await user.clear(inputs[1])
    await user.type(inputs[1], "3")
    expect(callbacks.updateItem).toHaveBeenCalled()
  })

  it("removes item when delete button is clicked", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    const item = makeItem()

    render(
      <CatalogItemRow item={item} config={makeConfig()} index={0} callbacks={callbacks} />,
    )

    const buttons = screen.getAllByRole("button")
    await user.click(buttons[0]) // first button is the remove button
    expect(callbacks.removeItem).toHaveBeenCalledWith("item-1")
  })

  it("shows correct article label with index", () => {
    const callbacks = makeCallbacks()
    const item = makeItem({ description: "Holzschrauben" })

    render(
      <CatalogItemRow item={item} config={makeConfig()} index={2} callbacks={callbacks} />,
    )

    expect(screen.getByText("Artikel 3: Holzschrauben")).toBeTruthy()
  })

  it("displays unit label for count model", () => {
    const callbacks = makeCallbacks()
    const item = makeItem({ pricingModel: "count" })

    render(
      <CatalogItemRow item={item} config={makeConfig()} index={0} callbacks={callbacks} />,
    )

    expect(screen.getByText("Anzahl (Stk.)")).toBeTruthy()
  })

  it("displays unit label for weight model", () => {
    const callbacks = makeCallbacks()
    const item = makeItem({ pricingModel: "weight" })

    render(
      <CatalogItemRow item={item} config={makeConfig()} index={0} callbacks={callbacks} />,
    )

    expect(screen.getByText("Anzahl (g)")).toBeTruthy()
  })

  it("displays unit label for time model", () => {
    const callbacks = makeCallbacks()
    const item = makeItem({ pricingModel: "time" })

    render(
      <CatalogItemRow item={item} config={makeConfig()} index={0} callbacks={callbacks} />,
    )

    expect(screen.getByText("Anzahl (min)")).toBeTruthy()
  })

  it("defers updates to blur when onBlurSave is true", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    const item = makeItem({ pricingModel: "count", unitPrice: 1 })

    render(
      <CatalogItemRow
        item={item}
        config={makeConfig()}
        index={0}
        callbacks={callbacks}
        onBlurSave
      />,
    )

    const input = screen.getByRole("spinbutton")
    await user.clear(input)
    await user.type(input, "7")
    // No update yet — onBlurSave defers
    expect(callbacks.updateItem).not.toHaveBeenCalled()

    await user.tab() // triggers blur
    expect(callbacks.updateItem).toHaveBeenCalledTimes(1)
    expect(callbacks.updateItem.mock.calls[0][1]).toMatchObject({ quantity: 7, totalPrice: 7 })
  })

  it("clamps negative quantity to zero", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    const item = makeItem({ pricingModel: "count", unitPrice: 1 })

    render(
      <CatalogItemRow item={item} config={makeConfig()} index={0} callbacks={callbacks} />,
    )

    const input = screen.getByRole("spinbutton")
    await user.clear(input)
    await user.type(input, "-5")
    const lastCall = callbacks.updateItem.mock.calls.at(-1)!
    expect(lastCall[1].quantity).toBeGreaterThanOrEqual(0)
  })

  it("clamps negative manual price to zero", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    const item = makeItem({ catalogId: null, unitPrice: 0, pricingModel: "count" })

    render(
      <CatalogItemRow item={item} config={makeConfig()} index={0} callbacks={callbacks} />,
    )

    const inputs = screen.getAllByRole("spinbutton")
    // Second spinbutton is the editable price
    await user.clear(inputs[1])
    await user.type(inputs[1], "-3")
    const lastCall = callbacks.updateItem.mock.calls.at(-1)!
    expect(lastCall[1].unitPrice).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// AreaItemRow (via CatalogItemRow)
// ============================================================================

describe("AreaItemRow", () => {
  it("computes m² from length and width in cm", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    const item = makeItem({ pricingModel: "area", unitPrice: 25 })

    render(
      <CatalogItemRow
        item={item}
        catalogEntry={makeCatalogItems()[1]}
        config={makeConfig()}
        index={0}
        callbacks={callbacks}
      />,
    )

    // Two spinbuttons: length and width (price not editable for catalog item)
    const inputs = screen.getAllByRole("spinbutton")
    await user.clear(inputs[0])
    await user.type(inputs[0], "100")
    await user.clear(inputs[1])
    await user.type(inputs[1], "200")

    const lastCall = callbacks.updateItem.mock.calls.at(-1)!
    expect(lastCall[1]).toMatchObject({ quantity: 2 }) // 1m × 2m = 2m²
  })

  it("displays computed m² value", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    const item = makeItem({ pricingModel: "area", unitPrice: 25 })

    render(
      <CatalogItemRow
        item={item}
        catalogEntry={makeCatalogItems()[1]}
        config={makeConfig()}
        index={0}
        callbacks={callbacks}
      />,
    )

    const inputs = screen.getAllByRole("spinbutton")
    await user.clear(inputs[0])
    await user.type(inputs[0], "150")
    await user.clear(inputs[1])
    await user.type(inputs[1], "200")

    // 1.5m × 2m = 3.00 m²
    expect(screen.getByText("3.00")).toBeTruthy()
  })

  it("shows length and width labels", () => {
    const callbacks = makeCallbacks()
    const item = makeItem({ pricingModel: "area", unitPrice: 25 })

    render(
      <CatalogItemRow
        item={item}
        catalogEntry={makeCatalogItems()[1]}
        config={makeConfig()}
        index={0}
        callbacks={callbacks}
      />,
    )

    expect(screen.getByText("Länge (cm)")).toBeTruthy()
    expect(screen.getByText("Breite (cm)")).toBeTruthy()
  })
})

// ============================================================================
// LengthItemRow (via CatalogItemRow)
// ============================================================================

describe("LengthItemRow", () => {
  it("converts cm to meters", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    const item = makeItem({ pricingModel: "length", unitPrice: 3 })

    render(
      <CatalogItemRow
        item={item}
        catalogEntry={makeCatalogItems()[2]}
        config={makeConfig()}
        index={0}
        callbacks={callbacks}
      />,
    )

    const input = screen.getByRole("spinbutton")
    await user.clear(input)
    await user.type(input, "150")

    const lastCall = callbacks.updateItem.mock.calls.at(-1)!
    expect(lastCall[1]).toMatchObject({ quantity: 1.5 })
  })
})

// ============================================================================
// DirectItemRow (via CatalogItemRow)
// ============================================================================

describe("DirectItemRow", () => {
  it("updates description and cost", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    const item = makeItem({
      pricingModel: "direct",
      catalogId: null,
      description: "",
      totalPrice: 0,
    })

    render(
      <CatalogItemRow item={item} config={makeConfig()} index={0} callbacks={callbacks} />,
    )

    const descInput = screen.getByPlaceholderText("Was hast du gebraucht?")
    await user.type(descInput, "Lasercutting")

    const costInput = screen.getByRole("spinbutton")
    await user.clear(costInput)
    await user.type(costInput, "25")

    const lastCall = callbacks.updateItem.mock.calls.at(-1)!
    expect(lastCall[1]).toMatchObject({ totalPrice: 25 })
  })

  it("shows placeholder text", () => {
    const callbacks = makeCallbacks()
    const item = makeItem({ pricingModel: "direct", catalogId: null })

    render(
      <CatalogItemRow item={item} config={makeConfig()} index={0} callbacks={callbacks} />,
    )

    expect(screen.getByPlaceholderText("Was hast du gebraucht?")).toBeTruthy()
  })

  it("clamps negative cost to zero", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    const item = makeItem({
      pricingModel: "direct",
      catalogId: null,
      description: "Test",
      totalPrice: 0,
    })

    render(
      <CatalogItemRow item={item} config={makeConfig()} index={0} callbacks={callbacks} />,
    )

    const costInput = screen.getByRole("spinbutton")
    await user.clear(costInput)
    await user.type(costInput, "-10")
    const lastCall = callbacks.updateItem.mock.calls.at(-1)!
    expect(lastCall[1].totalPrice).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// NfcMachineItemRow
// ============================================================================

describe("NfcMachineItemRow", () => {
  it("displays duration in minutes from quantity in hours", () => {
    const item = makeItem({
      origin: "nfc",
      quantity: 0.5, // 0.5h = 30min
      unitPrice: 12,
      totalPrice: 6,
      description: "Maschinennutzung",
    })

    render(<NfcMachineItemRow item={item} index={0} checkoutId={null} />, {
      wrapper: FirebaseWrapper,
    })

    expect(screen.getByText("30 min")).toBeTruthy()
  })

  it("does not show expand button when checkoutId is null", () => {
    const item = makeItem({
      origin: "nfc",
      quantity: 1,
      description: "Maschinennutzung",
    })

    render(<NfcMachineItemRow item={item} index={0} checkoutId={null} />, {
      wrapper: FirebaseWrapper,
    })

    expect(screen.queryByText("Einzelne Nutzungen")).toBeNull()
  })

  it("shows grayed out remove icon (not a clickable button)", () => {
    const item = makeItem({
      origin: "nfc",
      quantity: 0.5,
      description: "Maschinennutzung",
    })

    const { container } = render(
      <NfcMachineItemRow item={item} index={0} checkoutId={null} />,
      { wrapper: FirebaseWrapper },
    )

    // The XCircle icon is wrapped in a <span>, not a <button>
    // (unlike manual items which have a <button> for removal)
    expect(container.querySelector("span.text-muted-foreground\\/40")).toBeTruthy()
    expect(container.querySelector("button > svg.lucide-x-circle")).toBeNull()
  })

  it("shows expand button when checkoutId is provided", () => {
    const item = makeItem({
      origin: "nfc",
      quantity: 0.5,
      description: "Maschinennutzung",
    })

    render(<NfcMachineItemRow item={item} index={0} checkoutId="co-1" />, {
      wrapper: FirebaseWrapper,
    })

    expect(screen.getByText("Einzelne Nutzungen")).toBeTruthy()
  })
})

// ============================================================================
// WorkshopInlineSection (includes AddArticleSearch)
// ============================================================================

describe("WorkshopInlineSection", () => {
  it("renders workshop heading and subtotal", () => {
    const callbacks = makeCallbacks()
    const items = [makeItem({ totalPrice: 5 }), makeItem({ id: "item-2", totalPrice: 10 })]

    render(
      <WorkshopInlineSection
        workshopId="holz"
        workshop={{ label: "Holz", order: 1 }}
        config={makeConfig()}
        items={items}
        catalogItems={makeCatalogItems()}
        callbacks={callbacks}
        discountLevel="none"
        checkoutId={null}
      />,
      { wrapper: FirebaseWrapper },
    )

    expect(screen.getByText("Holz")).toBeTruthy()
    expect(screen.getByText("Zwischentotal Holz")).toBeTruthy()
  })

  it("renders NFC items before manual items", () => {
    const callbacks = makeCallbacks()
    const nfcItem = makeItem({
      id: "nfc-1",
      origin: "nfc",
      description: "Maschinennutzung",
      quantity: 0.5,
      totalPrice: 6,
    })
    const manualItem = makeItem({
      id: "manual-1",
      origin: "manual",
      description: "Holzschrauben",
      totalPrice: 2.5,
    })

    render(
      <WorkshopInlineSection
        workshopId="holz"
        workshop={{ label: "Holz", order: 1 }}
        config={makeConfig()}
        items={[manualItem, nfcItem]}
        catalogItems={makeCatalogItems()}
        callbacks={callbacks}
        discountLevel="none"
        checkoutId={null}
      />,
      { wrapper: FirebaseWrapper },
    )

    expect(screen.getByText("Maschinennutzung")).toBeTruthy()
    expect(screen.getByText(/Holzschrauben/)).toBeTruthy()
  })

  it("opens search when 'Artikel hinzufügen' is clicked", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()

    render(
      <WorkshopInlineSection
        workshopId="holz"
        workshop={{ label: "Holz", order: 1 }}
        config={makeConfig()}
        items={[]}
        catalogItems={makeCatalogItems()}
        callbacks={callbacks}
        discountLevel="none"
        checkoutId={null}
      />,
      { wrapper: FirebaseWrapper },
    )

    await user.click(screen.getByText("Artikel hinzufügen"))
    expect(screen.getByPlaceholderText("Material suchen (Name oder Code)...")).toBeTruthy()
  })

  it("filters catalog items by name in search", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()

    render(
      <WorkshopInlineSection
        workshopId="holz"
        workshop={{ label: "Holz", order: 1 }}
        config={makeConfig()}
        items={[]}
        catalogItems={makeCatalogItems()}
        callbacks={callbacks}
        discountLevel="none"
        checkoutId={null}
      />,
      { wrapper: FirebaseWrapper },
    )

    await user.click(screen.getByText("Artikel hinzufügen"))
    await user.type(
      screen.getByPlaceholderText("Material suchen (Name oder Code)..."),
      "Schraub",
    )

    expect(screen.getByText("Schrauben M5")).toBeTruthy()
    expect(screen.queryByText("MDF Platte 3mm")).toBeNull()
    expect(screen.queryByText("Dachlatte 24x48")).toBeNull()
  })

  it("filters catalog items by code in search", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()

    render(
      <WorkshopInlineSection
        workshopId="holz"
        workshop={{ label: "Holz", order: 1 }}
        config={makeConfig()}
        items={[]}
        catalogItems={makeCatalogItems()}
        callbacks={callbacks}
        discountLevel="none"
        checkoutId={null}
      />,
      { wrapper: FirebaseWrapper },
    )

    await user.click(screen.getByText("Artikel hinzufügen"))
    await user.type(
      screen.getByPlaceholderText("Material suchen (Name oder Code)..."),
      "PLT001",
    )

    expect(screen.getByText("MDF Platte 3mm")).toBeTruthy()
    expect(screen.queryByText("Schrauben M5")).toBeNull()
  })

  it("calls addItem with correct data when catalog item is selected", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()

    render(
      <WorkshopInlineSection
        workshopId="holz"
        workshop={{ label: "Holz", order: 1 }}
        config={makeConfig()}
        items={[]}
        catalogItems={makeCatalogItems()}
        callbacks={callbacks}
        discountLevel="none"
        checkoutId={null}
      />,
      { wrapper: FirebaseWrapper },
    )

    await user.click(screen.getByText("Artikel hinzufügen"))
    await user.type(
      screen.getByPlaceholderText("Material suchen (Name oder Code)..."),
      "Schraub",
    )
    await user.click(screen.getByText("Schrauben M5"))

    expect(callbacks.addItem).toHaveBeenCalledTimes(1)
    const addedItem = callbacks.addItem.mock.calls[0][0]
    expect(addedItem).toMatchObject({
      catalogId: "cat-1",
      pricingModel: "count",
      unitPrice: 0.5,
      workshop: "holz",
      description: "Schrauben M5",
    })
  })

  it("applies member discount when selecting catalog item", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()

    render(
      <WorkshopInlineSection
        workshopId="holz"
        workshop={{ label: "Holz", order: 1 }}
        config={makeConfig()}
        items={[]}
        catalogItems={makeCatalogItems()}
        callbacks={callbacks}
        discountLevel={"member" as DiscountLevel}
        checkoutId={null}
      />,
      { wrapper: FirebaseWrapper },
    )

    await user.click(screen.getByText("Artikel hinzufügen"))
    await user.click(screen.getByText("Schrauben M5"))

    const addedItem = callbacks.addItem.mock.calls[0][0]
    expect(addedItem.unitPrice).toBe(0.4)
  })

  it("shows fallback options when search query is non-empty", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()

    render(
      <WorkshopInlineSection
        workshopId="holz"
        workshop={{ label: "Holz", order: 1 }}
        config={makeConfig()}
        items={[]}
        catalogItems={makeCatalogItems()}
        callbacks={callbacks}
        discountLevel="none"
        checkoutId={null}
      />,
      { wrapper: FirebaseWrapper },
    )

    await user.click(screen.getByText("Artikel hinzufügen"))
    await user.type(
      screen.getByPlaceholderText("Material suchen (Name oder Code)..."),
      "custom thing",
    )

    expect(screen.getByText("Kein passender Eintrag?")).toBeTruthy()
    expect(screen.getByText(/Pauschal CHF/)).toBeTruthy()
    expect(screen.getByText(/m²/)).toBeTruthy()
    expect(screen.getByText(/Stk/)).toBeTruthy()
  })

  it("calls addItem with null catalogId for fallback selection", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()

    render(
      <WorkshopInlineSection
        workshopId="holz"
        workshop={{ label: "Holz", order: 1 }}
        config={makeConfig()}
        items={[]}
        catalogItems={makeCatalogItems()}
        callbacks={callbacks}
        discountLevel="none"
        checkoutId={null}
      />,
      { wrapper: FirebaseWrapper },
    )

    await user.click(screen.getByText("Artikel hinzufügen"))
    await user.type(
      screen.getByPlaceholderText("Material suchen (Name oder Code)..."),
      "special item",
    )
    await user.click(screen.getByText(/Pauschal CHF/))

    expect(callbacks.addItem).toHaveBeenCalledTimes(1)
    const addedItem = callbacks.addItem.mock.calls[0][0]
    expect(addedItem).toMatchObject({
      catalogId: null,
      pricingModel: "direct",
      description: "special item",
    })
  })

  it("closes search on Escape key", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()

    render(
      <WorkshopInlineSection
        workshopId="holz"
        workshop={{ label: "Holz", order: 1 }}
        config={makeConfig()}
        items={[]}
        catalogItems={makeCatalogItems()}
        callbacks={callbacks}
        discountLevel="none"
        checkoutId={null}
      />,
      { wrapper: FirebaseWrapper },
    )

    await user.click(screen.getByText("Artikel hinzufügen"))
    expect(screen.getByPlaceholderText("Material suchen (Name oder Code)...")).toBeTruthy()

    await user.keyboard("{Escape}")

    expect(screen.queryByPlaceholderText("Material suchen (Name oder Code)...")).toBeNull()
    expect(screen.getByText("Artikel hinzufügen")).toBeTruthy()
  })
})
