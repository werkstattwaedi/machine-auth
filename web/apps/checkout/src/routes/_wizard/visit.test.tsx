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

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, within, waitFor } from "@testing-library/react"
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
// Shared across both useAsyncMutation call sites in VisitRoute; individual
// tests reject it (mockRejectedValueOnce) to exercise failure recovery.
const mockMutate = vi.fn()
vi.mock("@modules/hooks/use-async-mutation", () => ({
  useAsyncMutation: () => ({ mutate: mockMutate }),
}))
vi.mock("@modules/hooks/use-mobile", () => ({ useIsMobile: () => false }))

// The per-workshop section pulls a live catalog from Firestore; stub it so
// the test stays a pure render check of the gating logic. The stub renders
// `items` and `footerSlot` so the badge nesting (issue #505) is observable.
vi.mock("@/components/usage/workshop-section-with-catalog", () => ({
  WorkshopSectionWithCatalog: ({
    workshopId,
    items,
    footerSlot,
    onRemoveWorkshop,
  }: {
    workshopId: string
    items: CheckoutItemLocal[]
    footerSlot?: React.ReactNode
    onRemoveWorkshop?: () => void
  }) => (
    <div data-testid={`workshop-section-${workshopId}`}>
      {onRemoveWorkshop && (
        <button
          type="button"
          data-testid={`ws-remove-${workshopId}`}
          onClick={onRemoveWorkshop}
        >
          Werkstatt entfernen
        </button>
      )}
      {items.map((i) => (
        <span key={i.id} data-testid={`ws-item-${i.id}`}>
          {i.description}
        </span>
      ))}
      {footerSlot}
    </div>
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
const BADGE_CATALOG_ID = "nfc-badge"

/** The self-service badge SKU, as `addBadgeToCheckout` writes it. */
function badgeItem(id = "b1"): CheckoutItemLocal {
  return {
    id,
    workshop: "diverses",
    description: "Badge",
    origin: "manual",
    catalogId: BADGE_CATALOG_ID,
    pricingModel: "direct",
    quantity: 1,
    unitPrice: 5,
    totalPrice: 5,
  }
}

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
  kiosk?: boolean
  isAnonymous?: boolean
}

function buildCtx({
  items = [],
  workshopsVisited = [],
  removeItem = vi.fn(),
  kiosk = false,
  isAnonymous = false,
}: CtxOverrides) {
  return {
    checkoutId: "co1",
    openCheckout: { workshopsVisited },
    items,
    pricingConfig,
    discountLevel: "standard",
    membershipCatalogId: MEMBERSHIP_CATALOG_ID,
    badgeCatalogId: BADGE_CATALOG_ID,
    isAnonymous,
    addItem: vi.fn(),
    updateItem: vi.fn(),
    removeItem,
    kiosk,
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

beforeEach(() => {
  mockMutate.mockReset()
  mockMutate.mockResolvedValue(undefined)
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

    // The add-chips row is rendered (regression: it used to vanish). With a
    // workshop already selected its title is "Weitere Werkstätten".
    expect(screen.getByText("Weitere Werkstätten")).toBeTruthy()
    // The selected workshop's section is rendered so material can be added.
    expect(screen.getByTestId("workshop-section-makerspace")).toBeTruthy()
    // The membership block is shown alongside it.
    expect(screen.getByTestId("membership-block")).toBeTruthy()
  })

  it("hides the picker for a genuine membership-only cart (nothing selected)", () => {
    renderVisit({ items: [membershipItem()], workshopsVisited: [] })

    expect(screen.queryByText("Werkstätten wählen")).toBeNull()
    expect(screen.queryByText("Weitere Werkstätten")).toBeNull()
    expect(screen.queryByTestId("workshop-section-makerspace")).toBeNull()
    expect(screen.getByTestId("membership-block")).toBeTruthy()
  })

  it("shows the picker for a membership + a real workshop item (mixed cart)", () => {
    renderVisit({
      items: [membershipItem(), materialItem("i1", "makerspace")],
    })

    expect(screen.getByText("Weitere Werkstätten")).toBeTruthy()
    expect(screen.getByTestId("workshop-section-makerspace")).toBeTruthy()
    expect(screen.getByTestId("membership-block")).toBeTruthy()
  })
})

describe("VisitRoute — badge lives under Diverses (issue #505)", () => {
  it("does not render a standalone badge block for an identified kiosk visitor", () => {
    renderVisit({ kiosk: true, isAnonymous: false })

    // The old standalone "Badge" section rendered right under the picker for
    // every identified kiosk visitor — too intrusive (issue #505).
    expect(screen.queryByTestId("badge-block")).toBeNull()
    // No Diverses selected yet → no badge instructions anywhere.
    expect(screen.queryByTestId("badge-cta")).toBeNull()
  })

  it("nests the badge hint inside the Diverses section once Diverses is opened", () => {
    renderVisit({ kiosk: true, isAnonymous: false, workshopsVisited: ["diverses"] })

    const diverses = screen.getByTestId("workshop-section-diverses")
    expect(within(diverses).getByTestId("badge-cta")).toBeTruthy()
    expect(screen.queryByTestId("badge-block")).toBeNull()
  })

  it("hides the badge hint for an anonymous kiosk visitor and off-kiosk", () => {
    renderVisit({
      kiosk: true,
      isAnonymous: true,
      workshopsVisited: ["diverses"],
    })
    expect(screen.queryByTestId("badge-cta")).toBeNull()

    cleanup()
    renderVisit({
      kiosk: false,
      isAnonymous: false,
      workshopsVisited: ["diverses"],
    })
    expect(screen.queryByTestId("badge-cta")).toBeNull()
  })

  it("renders a purchased badge as a Diverses line item (no standalone block)", () => {
    // Regression: the badge line item used to render only via the standalone
    // block, so dropping that block must not make it disappear. The SKU is
    // bucketed under `diverses` server-side, so it renders there.
    renderVisit({ items: [badgeItem("b1")], kiosk: true, isAnonymous: false })

    expect(screen.queryByTestId("badge-block")).toBeNull()
    const diverses = screen.getByTestId("workshop-section-diverses")
    expect(within(diverses).getByTestId("ws-item-b1").textContent).toBe("Badge")
    // A badge-only cart still shows the picker (nonWorkshopOnly is
    // membership-only again) so the visitor can carry on with the visit.
    expect(screen.getByText("Weitere Werkstätten")).toBeTruthy()
  })
})

describe("VisitRoute — chip-based workshop selection (Werkstatt-Auswahl handoff)", () => {
  it("renders add-chips for unselected workshops and mounts the section on tap", async () => {
    renderVisit({})

    // Nothing selected yet → empty-state title, chips for every workshop.
    expect(screen.getByText("Werkstätten wählen")).toBeTruthy()
    const makerChip = screen.getByRole("button", { name: "Maker Space" })
    await userEvent.click(makerChip)

    // Section mounts; the tapped chip leaves the row; title flips.
    expect(screen.getByTestId("workshop-section-makerspace")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Maker Space" })).toBeNull()
    expect(screen.getByText("Weitere Werkstätten")).toBeTruthy()
    // The other workshop's chip is still offered.
    expect(screen.getByRole("button", { name: "Diverses" })).toBeTruthy()
  })

  it("shows 'Alle Werkstätten ausgewählt.' when every workshop is selected", () => {
    renderVisit({ workshopsVisited: ["makerspace", "diverses"] })

    expect(screen.getByText("Alle Werkstätten ausgewählt.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Maker Space" })).toBeNull()
  })

  it("renders sections in add order, not config order", () => {
    // Config order is makerspace (0) before diverses (1); the visit added
    // diverses first, so diverses must render first.
    renderVisit({ workshopsVisited: ["diverses", "makerspace"] })

    const sections = screen.getAllByTestId(/^workshop-section-/)
    expect(sections.map((s) => s.getAttribute("data-testid"))).toEqual([
      "workshop-section-diverses",
      "workshop-section-makerspace",
    ])
  })

  it("removes an empty section immediately (no confirm) after the exit animation", async () => {
    renderVisit({})
    await userEvent.click(screen.getByRole("button", { name: "Maker Space" }))
    expect(screen.getByTestId("workshop-section-makerspace")).toBeTruthy()

    await userEvent.click(screen.getByTestId("ws-remove-makerspace"))
    // No confirm dialog for an empty section.
    expect(screen.queryByText("Werkstatt entfernen?")).toBeNull()
    // The section unmounts once the 160ms exit animation has played.
    await waitFor(() =>
      expect(screen.queryByTestId("workshop-section-makerspace")).toBeNull(),
    )
    // The chip is back.
    expect(screen.getByRole("button", { name: "Maker Space" })).toBeTruthy()
  })

  it("keeps the section when the removal mutation fails (un-hide on error)", async () => {
    // The arrayRemove mutation rejects (useAsyncMutation re-throws per
    // ADR-0025); the workshop stays selected, so the section must return
    // to the visible (enter-animation) state instead of staying stuck at
    // the exit animation's opacity-0 end state.
    mockMutate.mockRejectedValueOnce(new Error("offline"))
    renderVisit({ workshopsVisited: ["makerspace"] })

    await userEvent.click(screen.getByTestId("ws-remove-makerspace"))
    await waitFor(() => expect(mockMutate).toHaveBeenCalled())

    await waitFor(() => {
      const wrapper = screen.getByTestId(
        "workshop-section-makerspace",
      ).parentElement!
      expect(wrapper.className).toContain("animate-ws-in")
    })
  })

  it("asks for confirmation before removing a section with recorded items", async () => {
    renderVisit({ items: [materialItem("i1", "makerspace")] })

    await userEvent.click(screen.getByTestId("ws-remove-makerspace"))
    expect(screen.getByText("Werkstatt entfernen?")).toBeTruthy()
    // The dialog names the workshop being removed.
    expect(
      screen.getByText(/Alle erfassten Einträge für\s+Maker Space\s+werden/),
    ).toBeTruthy()
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
