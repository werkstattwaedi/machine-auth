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
import { MaterialPicker } from "./material-picker"
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
    // Mirror production: NFC usage carries type "machine" (issue #105).
    type: overrides.origin === "nfc" ? "machine" : "material",
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
      category: ["Sonstiges"],
      variants: [
        {
          id: "default",
          pricingModel: "count",
          unitPrice: { default: 0.5, member: 0.4 },
        },
      ],
      active: true,
      userCanAdd: true,
    },
    {
      id: "cat-2",
      code: "PLT001",
      name: "MDF Platte 3mm",
      workshops: ["holz"],
      category: ["Sonstiges"],
      variants: [
        {
          id: "default",
          pricingModel: "area",
          unitPrice: { default: 25, member: 20 },
        },
      ],
      active: true,
      userCanAdd: true,
    },
    {
      id: "cat-3",
      code: "LAT001",
      name: "Dachlatte 24x48",
      workshops: ["holz"],
      category: ["Sonstiges"],
      variants: [
        {
          id: "default",
          pricingModel: "length",
          unitPrice: { default: 3, member: 2.5 },
        },
      ],
      active: true,
      userCanAdd: true,
    },
    {
      id: "cat-sla",
      code: "9010",
      name: "SLA Druck",
      workshops: ["holz"],
      category: ["Sonstiges"],
      variants: [
        {
          id: "default",
          pricingModel: "sla",
          unitPrice: { default: 250, member: 200 },
        },
      ],
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
  onAddMaterial?: () => void
}) {
  const callbacks = props.callbacks ?? makeCallbacks()
  const onAddMaterial = props.onAddMaterial ?? (() => {})
  render(
    <WorkshopInlineSection
      workshopId="holz"
      workshop={{ label: "Holz", order: 1 }}
      items={props.items ?? []}
      callbacks={callbacks}
      checkoutId={props.checkoutId ?? null}
      onAddMaterial={onAddMaterial}
    />,
    { wrapper: FirebaseWrapper },
  )
  return { callbacks, onAddMaterial }
}

/**
 * Mount the MaterialPicker directly (open) with workshop scope.
 *
 * The picker used to live inside WorkshopInlineSection; since issue
 * #213 it's a route-level overlay reached via /visit/add/...
 * The tests still want to exercise picker behaviour without
 * spinning up TanStack Router, so they mount the picker in
 * isolation here.
 */
function renderPicker(props: {
  catalogItems?: CatalogItem[]
  callbacks?: ReturnType<typeof makeCallbacks>
  discountLevel?: DiscountLevel
}) {
  const callbacks = props.callbacks ?? makeCallbacks()
  const catalogItems = props.catalogItems ?? makeCatalogItems()
  render(
    <MaterialPicker
      open
      onOpenChange={() => {}}
      scope={{ kind: "workshop", workshopId: "holz", workshopLabel: "Holz" }}
      catalogItems={catalogItems}
      config={makeConfig()}
      discountLevel={props.discountLevel ?? "none"}
      resolveWorkshop={() => "holz" as const}
      onAdd={callbacks.addItem}
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

  it("invokes onAddMaterial when the 'Material hinzufügen' button is clicked", async () => {
    const user = userEvent.setup()
    const onAddMaterial = vi.fn()
    renderSection({ items: [], onAddMaterial })
    await user.click(screen.getByRole("button", { name: "Material hinzufügen" }))
    expect(onAddMaterial).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// MaterialPicker (mounted in isolation; in the app it sits behind
// /visit/add/* routes — see inline-rows tests above for the link wiring.)
// ============================================================================

describe("MaterialPicker", () => {
  it("filters catalog items by name", async () => {
    const user = userEvent.setup()
    renderPicker({})
    await user.type(screen.getByPlaceholderText("Material suchen…"), "Schraub")
    expect(screen.getByText("Schrauben M5")).toBeTruthy()
    expect(screen.queryByText("MDF Platte 3mm")).toBeNull()
  })

  it("renders empty-state copy when the workshop has no catalog items", async () => {
    renderPicker({ catalogItems: [] })
    expect(
      screen.getByText(
        /Keine Treffer\. Suchbegriff anpassen oder einen anderen Filter wählen\./,
      ),
    ).toBeTruthy()
  })

  it("renders zero-variant items at unitPrice 0 without crashing", async () => {
    // Defensive: a malformed catalog doc (variants: []) should still
    // appear in the list and be clickable; total falls back to 0.
    const malformed: CatalogItem[] = [
      {
        id: "cat-malformed",
        code: "ZZZ",
        name: "Item ohne Variante",
        workshops: ["holz"],
        category: ["Sonstiges"],
        variants: [],
        active: true,
        userCanAdd: true,
      },
    ]
    const user = userEvent.setup()
    renderPicker({ catalogItems: malformed })
    const row = screen.getByText("Item ohne Variante")
    expect(row).toBeTruthy()
    // Row stays clickable; expanding shouldn't throw. With no variants we
    // expect no radiogroup to appear.
    await user.click(row)
    expect(screen.queryByRole("radiogroup")).toBeNull()
  })

  it("narrows visible items via breadcrumb-style category chips", async () => {
    // Three catalog items spread across two top-level categories.
    // Holzplatten has TWO sub-categories so the sub-row is meaningful;
    // single-sibling rows are hidden per the picker rule.
    const catalogItems: CatalogItem[] = [
      {
        id: "cat-a",
        code: "AAA",
        name: "Latte Kiefer",
        workshops: ["holz"],
        category: ["Massivholz"],
        variants: [
          {
            id: "default",
            pricingModel: "length",
            unitPrice: { default: 3 },
          },
        ],
        active: true,
        userCanAdd: true,
      },
      {
        id: "cat-b",
        code: "BBB",
        name: "Sperrholz Pappel 3mm",
        workshops: ["holz"],
        category: ["Holzplatten", "Sperrholz"],
        variants: [
          {
            id: "default",
            pricingModel: "area",
            unitPrice: { default: 15.9 },
          },
        ],
        active: true,
        userCanAdd: true,
      },
      {
        id: "cat-c",
        code: "CCC",
        name: "MDF roh 3mm",
        workshops: ["holz"],
        category: ["Holzplatten", "MDF"],
        variants: [
          {
            id: "default",
            pricingModel: "area",
            unitPrice: { default: 5.55 },
          },
        ],
        active: true,
        userCanAdd: true,
      },
    ]
    const user = userEvent.setup()
    renderPicker({ catalogItems })

    // Top-level row shows both categories; no sub-chips yet.
    expect(screen.getByRole("button", { name: "Massivholz" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Holzplatten" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Sperrholz" })).toBeNull()
    expect(screen.queryByRole("button", { name: "MDF" })).toBeNull()
    expect(screen.getByText("Latte Kiefer")).toBeTruthy()
    expect(screen.getByText("Sperrholz Pappel 3mm")).toBeTruthy()
    expect(screen.getByText("MDF roh 3mm")).toBeTruthy()

    // Drill in: click "Holzplatten". Its sibling "Massivholz" disappears
    // and both Holzplatten sub-chips surface (single-sibling rows are
    // hidden, but here we have two).
    await user.click(screen.getByRole("button", { name: "Holzplatten" }))
    expect(screen.queryByRole("button", { name: "Massivholz" })).toBeNull()
    expect(screen.getByRole("button", { name: "Holzplatten" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Sperrholz" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "MDF" })).toBeTruthy()
    expect(screen.queryByText("Latte Kiefer")).toBeNull()
    expect(screen.getByText("Sperrholz Pappel 3mm")).toBeTruthy()
    expect(screen.getByText("MDF roh 3mm")).toBeTruthy()

    // Drill deeper into "Sperrholz" — single value at that depth means
    // no further chip row appears, but items narrow.
    await user.click(screen.getByRole("button", { name: "Sperrholz" }))
    expect(screen.getByRole("button", { name: "Sperrholz" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "MDF" })).toBeNull()
    expect(screen.getByText("Sperrholz Pappel 3mm")).toBeTruthy()
    expect(screen.queryByText("MDF roh 3mm")).toBeNull()

    // Step back twice: Sperrholz → restores sub-row; Holzplatten →
    // restores top-level siblings and all items.
    await user.click(screen.getByRole("button", { name: "Sperrholz" }))
    expect(screen.getByRole("button", { name: "MDF" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Holzplatten" }))
    expect(screen.getByRole("button", { name: "Massivholz" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Sperrholz" })).toBeNull()
    expect(screen.getByText("Latte Kiefer")).toBeTruthy()
    expect(screen.getByText("Sperrholz Pappel 3mm")).toBeTruthy()
    expect(screen.getByText("MDF roh 3mm")).toBeTruthy()
  })

  it("hides the sub-chip row when there is only one sub-category", async () => {
    // Dübel-und-Rundstäbe-style scenario: one top-level category with a
    // single sub-category. Drilling in must not render a sub-row.
    const catalogItems: CatalogItem[] = [
      {
        id: "cat-x",
        code: "XXX",
        name: "Massivholz Ahorn 30mm",
        workshops: ["holz"],
        category: ["Massivholz"],
        variants: [
          {
            id: "default",
            pricingModel: "area",
            unitPrice: { default: 72 },
          },
        ],
        active: true,
        userCanAdd: true,
      },
      {
        id: "cat-y",
        code: "YYY",
        name: "Buche, glatt 6mm",
        workshops: ["holz"],
        category: ["Dübel- und Rundstäbe", "Rundstab"],
        variants: [
          {
            id: "default",
            pricingModel: "length",
            unitPrice: { default: 1.5 },
          },
        ],
        active: true,
        userCanAdd: true,
      },
    ]
    const user = userEvent.setup()
    renderPicker({ catalogItems })
    await user.click(screen.getByRole("button", { name: "Dübel- und Rundstäbe" }))
    // Breadcrumb chip stays visible; the single sub-category "Rundstab"
    // is NOT rendered as a chip.
    expect(
      screen.getByRole("button", { name: "Dübel- und Rundstäbe" }),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Rundstab" })).toBeNull()
    expect(screen.getByText("Buche, glatt 6mm")).toBeTruthy()
    expect(screen.queryByText("Massivholz Ahorn 30mm")).toBeNull()
  })

  it("renders a variant selector for multi-variant items and switches the form", async () => {
    const catalogItems: CatalogItem[] = [
      {
        id: "cat-pappel",
        code: "PPL",
        name: "Sperrholz Pappel 3mm",
        workshops: ["holz"],
        category: ["Holzplatten", "Sperrholz"],
        variants: [
          {
            id: "m2",
            pricingModel: "area",
            unitPrice: { default: 15.9 },
          },
          {
            id: "a3",
            label: "Zuschnitt A3",
            pricingModel: "count",
            unitPrice: { default: 2 },
          },
        ],
        active: true,
        userCanAdd: true,
      },
    ]
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    renderPicker({ catalogItems, callbacks })
    await user.click(screen.getByText("Sperrholz Pappel 3mm"))
    // The picker is now expanded with two variant chips. m² is canonical
    // (variants[0]) and selected by default. Switch to the cut variant.
    const a3Chip = screen.getByRole("radio", { name: "Zuschnitt A3" })
    await user.click(a3Chip)
    // Enter a quantity (count form: single spinbutton) and submit.
    const qty = screen.getByRole("spinbutton")
    await user.clear(qty)
    await user.type(qty, "4")
    await user.click(screen.getByRole("button", { name: "Hinzufügen" }))
    expect(callbacks.addItem).toHaveBeenCalledTimes(1)
    expect(callbacks.addItem.mock.calls[0][0]).toMatchObject({
      catalogId: "cat-pappel",
      variantId: "a3",
      pricingModel: "count",
      quantity: 4,
      unitPrice: 2,
      totalPrice: 8,
    })
  })

  it("updates the header price to the selected variant's price (#354)", async () => {
    // Sandstrahlen-Stein-style item: Klein (variants[0]) @ CHF 5,
    // Mittel @ CHF 10. Before the fix the header stayed at CHF 5.00
    // even after selecting Mittel, contradicting the form total below.
    const catalogItems: CatalogItem[] = [
      {
        id: "cat-stein",
        code: "8001",
        name: "Sandstrahlen Stein",
        workshops: ["holz"],
        category: ["Maschinen"],
        variants: [
          {
            id: "klein",
            label: "Klein (bis 13×9×9 cm)",
            pricingModel: "count",
            unitPrice: { default: 5 },
          },
          {
            id: "mittel",
            label: "Mittel (bis 21×14×14 cm)",
            pricingModel: "count",
            unitPrice: { default: 10 },
          },
        ],
        active: true,
        userCanAdd: true,
      },
    ]
    const user = userEvent.setup()
    renderPicker({ catalogItems })

    const row = screen.getByRole("button", { name: /Sandstrahlen Stein/ })
    // The header price lives in the row's `.tabular-nums` cell (formatCHF
    // text + a `/unit` span). Read it directly and normalise whitespace so
    // the assertion doesn't hinge on Intl's (non-breaking) space codepoint.
    const headerPrice = () =>
      (row.querySelector(".tabular-nums")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()

    // Collapsed/initial header shows the canonical variants[0] price.
    expect(headerPrice()).toContain("CHF 5.00")

    await user.click(row)
    // Still CHF 5.00 right after expand (Klein is selected by default).
    expect(headerPrice()).toContain("CHF 5.00")

    // Select Mittel — the header must now reflect CHF 10.00 (the bug:
    // it stayed at CHF 5.00).
    await user.click(
      screen.getByRole("radio", { name: "Mittel (bis 21×14×14 cm)" }),
    )
    expect(headerPrice()).toContain("CHF 10.00")
    expect(headerPrice()).not.toContain("CHF 5.00")
  })

  it("updates the header unit suffix when the selected variant changes pricing model (#354)", async () => {
    // Count variant (/Stk.) is canonical; switching to the area variant
    // must update the header's unit suffix to /m², guarding getShortUnit.
    const catalogItems: CatalogItem[] = [
      {
        id: "cat-mixed",
        code: "MIX",
        name: "Mixed Pricing Item",
        workshops: ["holz"],
        category: ["Sonstiges"],
        variants: [
          {
            id: "stk",
            label: "Pro Stück",
            pricingModel: "count",
            unitPrice: { default: 5 },
          },
          {
            id: "flaeche",
            label: "Pro Fläche",
            pricingModel: "area",
            unitPrice: { default: 25 },
          },
        ],
        active: true,
        userCanAdd: true,
      },
    ]
    const user = userEvent.setup()
    renderPicker({ catalogItems })

    const row = screen.getByRole("button", { name: /Mixed Pricing Item/ })
    const headerCell = () =>
      (row.querySelector(".tabular-nums")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()

    await user.click(row)
    // Count variant selected by default → /Stk. suffix in the header.
    expect(headerCell()).toContain("/Stk.")

    await user.click(screen.getByRole("radio", { name: "Pro Fläche" }))
    expect(headerCell()).toContain("/m²")
    expect(headerCell()).not.toContain("/Stk.")
  })

  it("filters catalog items by code", async () => {
    const user = userEvent.setup()
    renderPicker({})
    await user.type(screen.getByPlaceholderText("Material suchen…"), "PLT001")
    expect(screen.getByText("MDF Platte 3mm")).toBeTruthy()
    expect(screen.queryByText("Schrauben M5")).toBeNull()
  })

  it("calls addItem after the user enters a quantity and clicks Hinzufügen", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    renderPicker({ callbacks })

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
    renderPicker({})
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
    renderPicker({})
    await user.click(screen.getByText("Schrauben M5"))
    const addBtn = screen.getByRole("button", { name: "Hinzufügen" })
    expect((addBtn as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByRole("spinbutton"), "2")
    expect((addBtn as HTMLButtonElement).disabled).toBe(false)
  })

  it("converts cm to m² when adding an area-priced item", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    renderPicker({ callbacks })
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
    renderPicker({ callbacks, discountLevel: "member" })
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
    renderPicker({ callbacks })
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
    renderPicker({})
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
    renderPicker({ catalogItems: [] })
    expect(screen.getByText(/Keine Treffer/)).toBeTruthy()
  })

  it("hides the empty-state when the user types so the ad-hoc fallbacks can appear", async () => {
    const user = userEvent.setup()
    renderPicker({ catalogItems: [] })
    await user.type(
      screen.getByPlaceholderText("Material suchen…"),
      "Reststück",
    )
    expect(screen.queryByText(/Keine Treffer/)).toBeNull()
    expect(screen.getByText("Kein passender Eintrag?")).toBeTruthy()
  })

  it("does not render the legacy 'Frage am Empfang' footer", async () => {
    renderPicker({})
    expect(screen.queryByText(/Frage am Empfang/)).toBeNull()
  })
})

// ============================================================================
// MaterialPicker — ad-hoc fallback creation
// ============================================================================

describe("MaterialPicker ad-hoc fallback", () => {
  it("only shows the fallback section when the search query is non-empty", async () => {
    const user = userEvent.setup()
    renderPicker({})
    expect(screen.queryByText("Kein passender Eintrag?")).toBeNull()
    await user.type(screen.getByPlaceholderText("Material suchen…"), "Holzkitt")
    expect(screen.getByText("Kein passender Eintrag?")).toBeTruthy()
  })

  it("adds a Pauschal CHF item with the typed description", async () => {
    const user = userEvent.setup()
    const callbacks = makeCallbacks()
    renderPicker({ callbacks })
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
    renderPicker({ callbacks })
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
    renderPicker({ callbacks })
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
    renderPicker({})
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
    renderPicker({ callbacks })
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
  it("displays duration in minutes and total price (no CHF prefix in shared PositionTable)", () => {
    render(
      <NfcMachineItemRow
        item={makeItem({
          origin: "nfc",
          quantity: 0.5,
          unitPrice: 12,
          totalPrice: 6,
          description: "Maschinennutzung",
        })}
        checkoutId="checkout-1"
      />,
      { wrapper: FirebaseWrapper },
    )
    // Shared PositionTable column: "30 Min" (capital M) — matches material
    // rows that also use "Min" via formatMenge.
    expect(screen.getByText("30 Min")).toBeTruthy()
    // Preis cell holds the bare amount; the workshop subtotal owns the
    // CHF prefix.
    expect(screen.getByText("6.00")).toBeTruthy()
    // Kosten cell shows the per-hour rate.
    expect(screen.getByText("12.00/Std.")).toBeTruthy()
  })

  it("shows the machine name", () => {
    render(
      <NfcMachineItemRow
        item={makeItem({
          origin: "nfc",
          description: "CO₂ Laser",
          quantity: 0.5,
        })}
        checkoutId="checkout-1"
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
        checkoutId="checkout-1"
      />,
      { wrapper: FirebaseWrapper },
    )
    // No close-icon button anywhere in the row.
    expect(within(container).queryByLabelText("Entfernen")).toBeNull()
  })

  it("hides the expand toggle when checkoutId is null", () => {
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
    // Without a checkout id there is no per-session breakdown to expand,
    // so the chevron column is omitted entirely.
    expect(within(container).queryByLabelText("Aufklappen")).toBeNull()
    expect(within(container).queryByLabelText("Einklappen")).toBeNull()
  })
})
