// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest"
import { useReducer, type ReactNode } from "react"
import { FirebaseProvider, type FirebaseServices } from "@modules/lib/firebase-context"
import type { PricingConfig, WorkshopId } from "@modules/lib/workshop-config"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"

// Stub the catalog-loading child component to avoid touching Firestore. The
// stub renders a recognisable marker so we can assert the per-workshop section
// was mounted, and attaches the `sectionRef` callback to the rendered wrapper
// so the StepWorkshops scroll-into-view logic has a real DOM node to target.
vi.mock("@/components/usage/workshop-section-with-catalog", () => ({
  WorkshopSectionWithCatalog: ({
    workshopId,
    sectionRef,
  }: {
    workshopId: string
    sectionRef?: (el: HTMLDivElement | null) => void
  }) => (
    <div ref={sectionRef} data-testid={`workshop-section-${workshopId}`}>
      Section for {workshopId}
    </div>
  ),
}))

import { StepWorkshops } from "./step-workshops"
import {
  checkoutReducer,
  initialState,
  type CheckoutState,
} from "./use-checkout-state"

afterEach(cleanup)

function makeConfig(): PricingConfig {
  return {
    entryFees: { erwachsen: {}, kind: {}, firma: {} },
    workshops: {
      holz: { label: "Holz", order: 1 },
      makerspace: { label: "Maker Space", order: 2 },
      metall: { label: "Metall", order: 3 },
    } as PricingConfig["workshops"],
    slaLayerPrice: { none: 0.01, member: 0.008, intern: 0.006 },
    labels: {
      units: { h: "Std.", m2: "m²", m: "m", stk: "Stk.", kg: "kg", chf: "CHF" },
      discounts: { none: "Normal", member: "Mitglied", intern: "Intern" },
    },
  }
}

function makeItem(overrides: Partial<CheckoutItemLocal> = {}): CheckoutItemLocal {
  return {
    id: "item-1",
    workshop: "makerspace",
    description: "Filament PLA",
    origin: "manual",
    catalogId: "cat-filament",
    pricingModel: "weight",
    quantity: 1,
    unitPrice: 50,
    totalPrice: 50,
    ...overrides,
  }
}

function FirebaseWrapper({ children }: { children: ReactNode }) {
  const services: FirebaseServices = {
    db: {} as FirebaseServices["db"],
    auth: {} as FirebaseServices["auth"],
    functions: {} as FirebaseServices["functions"],
  }
  return <FirebaseProvider value={services}>{children}</FirebaseProvider>
}

/**
 * Renders StepWorkshops with a reducer so dispatch actually mutates state, and
 * lets the caller rerender with updated items (simulating Firestore snapshots
 * landing after mount). Returns handles to the rerender function.
 */
function renderStepWorkshops(initialItems: CheckoutItemLocal[] = []) {
  let currentItems = initialItems
  const setItems = (next: CheckoutItemLocal[]) => {
    currentItems = next
    result.rerender(<Wrapper />)
  }

  function Wrapper() {
    const init: CheckoutState = { ...initialState, step: 1 }
    const [state, dispatch] = useReducer(checkoutReducer, init)
    return (
      <FirebaseWrapper>
        <StepWorkshops
          state={state}
          dispatch={dispatch}
          config={makeConfig()}
          items={currentItems}
          checkoutId="co-123"
          userRef={null}
          discountLevel="none"
        />
      </FirebaseWrapper>
    )
  }

  const result = render(<Wrapper />)
  return { setItems }
}

beforeEach(() => {
  // StepWorkshops reads window.matchMedia via useIsMobile — stub it so the
  // hook resolves to a definite value in the browser test environment.
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

describe("StepWorkshops: workshop with items stays selected across prop changes (issue #99)", () => {
  it("renders the workshop section when items arrive after mount", () => {
    // Initial render with no items — this is what happens right after
    // StepWorkshops re-mounts because `checkoutId` changed when the first item
    // was added (the Firestore items subscription hasn't delivered its first
    // snapshot yet).
    const { setItems } = renderStepWorkshops([])

    // No workshop section visible yet.
    expect(screen.queryByTestId("workshop-section-makerspace")).toBeNull()

    // Firestore snapshot lands a tick later — the checkout now has an item
    // for the makerspace.
    setItems([makeItem({ id: "i1", workshop: "makerspace" as WorkshopId })])

    // The Maker Space section must be rendered even though the user never
    // clicked the checkbox after this mount — `workshopsWithItems` is derived
    // from `items` and must flow into `selectedWorkshops`.
    expect(screen.getByTestId("workshop-section-makerspace")).toBeTruthy()
  })

  it("renders the workshop section when the component mounts with items already present", () => {
    // Sanity check: a fresh mount with items present (e.g. after reloading
    // the page) still shows the section. The reporter noted reloading fixes
    // the bug — this asserts we haven't regressed that path.
    renderStepWorkshops([makeItem({ id: "i1", workshop: "makerspace" as WorkshopId })])

    expect(screen.getByTestId("workshop-section-makerspace")).toBeTruthy()
  })

  it("Maker Space checkbox is checked and disabled when items exist for it", () => {
    renderStepWorkshops([makeItem({ id: "i1", workshop: "makerspace" as WorkshopId })])

    // Find the Maker Space checkbox via its label text.
    const label = screen.getByText("Maker Space").closest("label")
    expect(label).toBeTruthy()
    const checkbox = label!.querySelector('button[role="checkbox"]') as HTMLButtonElement
    expect(checkbox).toBeTruthy()
    expect(checkbox.getAttribute("data-state")).toBe("checked")
    expect(checkbox.getAttribute("data-disabled")).not.toBeNull()
  })
})

describe("StepWorkshops: scrolls newly-selected workshop section into view (issue #100)", () => {
  let scrollSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    scrollSpy = vi.fn()
    // jsdom/Playwright browser-mode DOM doesn't implement scrollIntoView — we
    // need to assert it was called, so stub it unconditionally.
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollSpy,
    })
  })

  it("does not scroll on initial mount when sections come from workshopsWithItems", async () => {
    renderStepWorkshops([makeItem({ id: "i1", workshop: "makerspace" as WorkshopId })])

    // Section is visible (sanity check).
    expect(screen.getByTestId("workshop-section-makerspace")).toBeTruthy()

    // Wait one rAF tick — long enough that any scheduled scroll would have
    // fired. `requestAnimationFrame` resolves faster than this in practice.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))

    // No scroll on initial mount: the pre-selected workshop is considered
    // part of the baseline, not a newly-added selection.
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it("scrolls the newly-selected section into view when the user checks a second workshop", async () => {
    // Start with Maker Space already selected (has items).
    renderStepWorkshops([makeItem({ id: "i1", workshop: "makerspace" as WorkshopId })])

    // Wait past the initial mount rAF so the baseline is established.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    expect(scrollSpy).not.toHaveBeenCalled()

    // User clicks the Holz checkbox (a workshop with no items yet).
    const user = userEvent.setup()
    const holzLabel = screen.getByText("Holz").closest("label") as HTMLLabelElement
    const holzCheckbox = holzLabel.querySelector('button[role="checkbox"]') as HTMLButtonElement
    await user.click(holzCheckbox)

    // Wait for the rAF-scheduled scrollIntoView.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))

    // The newly-added Holz section should have been scrolled into view
    // exactly once. Other sections (like the pre-existing Maker Space one)
    // must not be re-scrolled.
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" })
    // The `this` binding of the spy was the Holz section node.
    const holzSection = screen.getByTestId("workshop-section-holz")
    expect(scrollSpy.mock.contexts[0]).toBe(holzSection)
  })

  it("does not scroll when the user un-checks a workshop", async () => {
    // Fresh render with no items; user will toggle Holz on then off.
    renderStepWorkshops([])

    const user = userEvent.setup()
    const holzLabel = screen.getByText("Holz").closest("label") as HTMLLabelElement
    const holzCheckbox = holzLabel.querySelector('button[role="checkbox"]') as HTMLButtonElement

    // First click: added → should scroll once.
    await user.click(holzCheckbox)
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    expect(scrollSpy).toHaveBeenCalledTimes(1)

    // Second click: removed → must NOT trigger another scroll.
    await user.click(holzCheckbox)
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })
})
