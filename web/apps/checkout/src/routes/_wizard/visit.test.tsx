// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * VisitRoute — the wizard's "Kosten" step. Regression coverage for issue
 * #362: buying a membership during an open visit must NOT hide the workshop
 * selectors. The `membershipOnly` gate used to flip true whenever the cart
 * held a membership SKU and no material line items — but a visitor who had
 * selected (or visited) a workshop without yet adding material still had
 * `workshopItems.length === 0`, so the "Werkstätten wählen" picker and the
 * per-workshop sections vanished, leaving no way to continue the visit. The
 * fix additionally gates on the effective workshop selection.
 *
 * Also covers the new (×) remove affordance on the membership block (#362).
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest"
import { render, screen, cleanup, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"

// ── Capture the route component (mirrors usage.test.tsx) ─────────────────
let CapturedComponent: (() => React.JSX.Element) | null = null
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => React.JSX.Element }) => {
    CapturedComponent = opts.component
    return opts
  },
  Outlet: () => null,
  useNavigate: () => vi.fn(),
}))

// ── Light leaf-component / hook mocks ────────────────────────────────────
// `useDb` must return a STABLE reference: `useCollection` (used by VisitRoute
// for the pinned-machine catalog query, issue #105) keys its subscribe effect
// on the db identity, so a fresh `{}` per call would re-fire the effect every
// render and loop. Production's context db is stable; mirror that here.
vi.mock("@modules/lib/firebase-context", () => {
  const db = {}
  return { useDb: () => db }
})
vi.mock("@modules/hooks/use-firestore-mutation", () => ({
  useFirestoreMutation: () => ({ update: vi.fn(), remove: vi.fn() }),
}))
vi.mock("@modules/hooks/use-async-mutation", () => ({
  useAsyncMutation: () => ({ mutate: vi.fn().mockResolvedValue(undefined) }),
}))
vi.mock("@modules/hooks/use-mobile", () => ({ useIsMobile: () => false }))

// The per-workshop section pulls a live catalog from Firestore; stub it so
// the test stays a pure render check of the gating logic.
vi.mock("@/components/usage/workshop-section-with-catalog", () => ({
  WorkshopSectionWithCatalog: ({ workshopId }: { workshopId: string }) => (
    <div data-testid={`workshop-section-${workshopId}`} />
  ),
}))
vi.mock("@/components/qr-scanner/scan-fab", () => ({ ScanFab: () => null }))

// Minimal pricing config: getSortedWorkshops reads `config.workshops`.
vi.mock("@modules/lib/workshop-config", async () => {
  const actual = await vi.importActual<
    typeof import("@modules/lib/workshop-config")
  >("@modules/lib/workshop-config")
  return { ...actual }
})

// ── Wizard context harness ───────────────────────────────────────────────
const mockUseWizardContext = vi.fn()
vi.mock("@/components/checkout/wizard-context", () => ({
  useWizardContext: () => mockUseWizardContext(),
}))

const MEMBERSHIP_CATALOG_ID = "membership-fee"

function membershipItem(id = "m1"): CheckoutItemLocal {
  return {
    id,
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

function materialItem(
  id = "i1",
  workshop = "makerspace",
): CheckoutItemLocal {
  return {
    id,
    workshop,
    description: "Acrylglas 3mm",
    origin: "manual",
    catalogId: "acryl",
    pricingModel: "area",
    quantity: 0.1,
    unitPrice: 50,
    totalPrice: 5,
  }
}

const pricingConfig = {
  workshops: {
    makerspace: { order: 0, label: "Maker Space" },
    diverses: { order: 1, label: "Diverses" },
  },
} as never

interface CtxOverrides {
  items?: CheckoutItemLocal[]
  workshopsVisited?: string[]
  removeItem?: (id: string) => void
}

function buildCtx({
  items = [],
  workshopsVisited = [],
  removeItem = vi.fn(),
}: CtxOverrides) {
  return {
    checkoutId: "co1",
    openCheckout: { workshopsVisited },
    items,
    pricingConfig,
    discountLevel: "standard",
    membershipCatalogId: MEMBERSHIP_CATALOG_ID,
    addItem: vi.fn(),
    updateItem: vi.fn(),
    removeItem,
    kiosk: false,
  }
}

function renderVisit(overrides: CtxOverrides) {
  mockUseWizardContext.mockReturnValue(buildCtx(overrides))
  // Importing the module runs createFileRoute, capturing VisitRoute.
  const Comp = CapturedComponent!
  return render(<Comp />)
}

// Import once — `createFileRoute` runs at module-eval time and captures
// VisitRoute. The module is cached, so re-importing per test would NOT
// re-run the capture (leaving CapturedComponent null on later tests).
beforeAll(async () => {
  await import("./visit")
})

afterEach(() => {
  cleanup()
  mockUseWizardContext.mockReset()
})

describe("VisitRoute — membershipOnly gate (issue #362)", () => {
  it("keeps the workshop picker + section when a membership is bought mid-visit (workshop visited, no material yet)", () => {
    // The exact bug scenario from the screenshot: Maker Space is on the
    // visit (workshopsVisited) but has no material line; a membership SKU
    // was just appended to the open checkout.
    renderVisit({
      items: [membershipItem()],
      workshopsVisited: ["makerspace"],
    })

    // Picker grid is rendered (regression: it used to vanish).
    expect(screen.getByText("Werkstätten wählen")).toBeTruthy()
    // The selected workshop's section is rendered so material can be added.
    expect(screen.getByTestId("workshop-section-makerspace")).toBeTruthy()
    // The membership block is shown alongside it.
    expect(screen.getByTestId("membership-block")).toBeTruthy()
  })

  it("hides the picker for a genuine membership-only cart (nothing selected)", () => {
    renderVisit({ items: [membershipItem()], workshopsVisited: [] })

    expect(screen.queryByText("Werkstätten wählen")).toBeNull()
    expect(screen.queryByTestId("workshop-section-makerspace")).toBeNull()
    expect(screen.getByTestId("membership-block")).toBeTruthy()
  })

  it("shows the picker for a membership + a real workshop item (mixed cart)", () => {
    renderVisit({
      items: [membershipItem(), materialItem("i1", "makerspace")],
    })

    expect(screen.getByText("Werkstätten wählen")).toBeTruthy()
    expect(screen.getByTestId("workshop-section-makerspace")).toBeTruthy()
    expect(screen.getByTestId("membership-block")).toBeTruthy()
  })
})

describe("VisitRoute — membership remove affordance (issue #362)", () => {
  it("renders a remove control on the membership line and invokes removeItem with the item id", async () => {
    const removeItem = vi.fn()
    renderVisit({ items: [membershipItem("m1")], removeItem })

    const block = screen.getByTestId("membership-block")
    const removeBtn = within(block).getByRole("button", { name: "Entfernen" })
    expect(removeBtn).toBeTruthy()

    await userEvent.click(removeBtn)
    expect(removeItem).toHaveBeenCalledWith("m1")
  })
})
