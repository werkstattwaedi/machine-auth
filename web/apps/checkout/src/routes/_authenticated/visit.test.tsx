// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for the issue #182 migration: the previously
 * fire-and-forget `toggleWorkshop` write on /visit now routes through
 * `useAsyncMutation`. A rejection MUST surface a German toast (it was
 * silent before).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, cleanup, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ReactNode } from "react"

// ── Mocks ──────────────────────────────────────────────────────────────

const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}))

vi.mock("firebase/functions", () => ({
  getFunctions: () => ({}),
  httpsCallable: () => () => Promise.resolve({ data: { ok: true } }),
}))

// Stub TanStack Router so the route file's `createFileRoute` registers
// the component without needing the full router runtime.
let CapturedComponent: (() => React.JSX.Element) | null = null
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: () => React.JSX.Element }) => {
    CapturedComponent = opts.component
    return opts
  },
  Link: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => (
    <a {...(props as Record<string, string>)}>{children}</a>
  ),
  // /visit is now a layout for the picker sub-routes (issue #213).
  // The unit test never activates a child route, so Outlet is a no-op.
  Outlet: () => null,
}))

const mockUseAuth = vi.fn()
vi.mock("@modules/lib/auth", () => ({
  useAuth: () => mockUseAuth(),
}))

const mockUseCollection = vi.fn()
vi.mock("@modules/lib/firestore", () => ({
  useCollection: (...args: unknown[]) => mockUseCollection(...args),
}))

const mockUsePricingConfig = vi.fn()
vi.mock("@modules/lib/workshop-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@modules/lib/workshop-config")>()
  return {
    ...actual,
    usePricingConfig: () => mockUsePricingConfig(),
  }
})

vi.mock("@modules/lib/firestore-helpers", () => ({
  userRef: (_db: unknown, id: string) => ({ id, path: `users/${id}` }),
  catalogRef: (_db: unknown, id: string) => ({ id, path: `catalog/${id}` }),
  checkoutRef: (_db: unknown, id: string) => ({ id, path: `checkouts/${id}` }),
  checkoutItemRef: (_db: unknown, coId: string, itemId: string) => ({
    id: itemId,
    path: `checkouts/${coId}/items/${itemId}`,
  }),
  checkoutsCollection: (_db: unknown) => ({ path: "checkouts" }),
  checkoutItemsCollection: (_db: unknown, coId: string) => ({
    path: `checkouts/${coId}/items`,
  }),
}))

// `useFirestoreMutation`'s `update` is what the toggle calls. Make it
// reject so the migrated `useAsyncMutation` envelope fires a toast.
const mockAdd = vi.fn().mockResolvedValue({ id: "new-co" })
const mockUpdate = vi.fn().mockResolvedValue(undefined)
const mockRemove = vi.fn().mockResolvedValue(undefined)
vi.mock("@modules/hooks/use-firestore-mutation", () => ({
  useFirestoreMutation: () => ({
    add: mockAdd,
    update: mockUpdate,
    remove: mockRemove,
    set: vi.fn(),
    mutate: vi.fn(),
    loading: false,
    error: null,
  }),
}))

vi.mock("@modules/lib/firebase-context", () => ({
  useDb: () => ({}),
  useFunctions: () => ({}),
  useFirebaseAuth: () => ({}),
}))

// Capture the workshop section so we can also exercise callbacks if
// needed; not strictly required for the toggle test.
vi.mock("@/components/usage/workshop-section-with-catalog", () => ({
  WorkshopSectionWithCatalog: ({ workshopId }: { workshopId: string }) => (
    <div data-testid={`workshop-section-${workshopId}`}>{workshopId}</div>
  ),
}))

// Import the route file so its `createFileRoute` runs and assigns
// CapturedComponent.
await import("./visit")

import type { PricingConfig } from "@modules/lib/workshop-config"

function makeConfig(): PricingConfig {
  return {
    entryFees: { erwachsen: {}, kind: {}, firma: {} },
    workshops: {
      makerspace: { label: "Maker Space", order: 2 },
      holz: { label: "Holz", order: 1 },
    } as PricingConfig["workshops"],
    slaLayerPrice: { none: 0.01, member: 0.008 },
    labels: {
      units: { h: "Std.", m2: "m²", m: "m", stk: "Stk.", kg: "kg", chf: "CHF" },
      discounts: { none: "Normal", member: "Mitglied" },
    },
  }
}

describe("visit /toggleWorkshop async error envelope (issue #182)", () => {
  beforeEach(() => {
    mockAdd.mockClear()
    mockUpdate.mockClear()
    mockRemove.mockClear()
    mockToastError.mockReset()
    mockToastSuccess.mockReset()

    mockUseAuth.mockReturnValue({
      userDoc: {
        id: "u1",
        name: "Test User",
        firstName: "Test",
        lastName: "User",
        roles: [],
        permissions: [],
      },
      userDocLoading: false,
    })

    // openCheckouts: one open checkout; checkoutItems: empty
    mockUseCollection.mockImplementation((ref: { path?: string } | null) => {
      if (!ref) return { data: [], loading: false, error: null }
      if (ref.path === "checkouts") {
        return {
          data: [
            {
              id: "co-1",
              status: "open",
              userId: { id: "u1", path: "users/u1" },
              workshopsVisited: [],
              persons: [],
            },
          ],
          loading: false,
          error: null,
        }
      }
      return { data: [], loading: false, error: null }
    })

    mockUsePricingConfig.mockReturnValue({
      data: makeConfig(),
      loading: false,
      configError: null,
    })

    if (!window.matchMedia) {
      window.matchMedia = vi.fn().mockImplementation((q: string) => ({
        matches: false,
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    }
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("toggleWorkshop: failure surfaces German toast (was silent before #182)", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("write rejected"))

    const Component = CapturedComponent!
    const { getByText } = render(<Component />)

    const user = userEvent.setup()
    // The "Holz" workshop has no items + isn't visited, so clicking
    // checks it and triggers an arrayUnion update.
    const label = getByText("Holz").closest("label") as HTMLLabelElement
    const checkbox = label.querySelector(
      'button[role="checkbox"]',
    ) as HTMLButtonElement

    await act(async () => {
      await user.click(checkbox)
      // Allow fire-and-forget promise to settle.
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockToastError).toHaveBeenCalledWith(
      "Werkstattauswahl konnte nicht gespeichert werden",
    )
  })
})
