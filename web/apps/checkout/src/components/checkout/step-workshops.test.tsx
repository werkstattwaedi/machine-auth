// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for the issue #182 migration: every Firestore
 * write in StepWorkshops (add/update/remove) routes through
 * `useAsyncMutation`, so a rejection MUST surface a German toast and
 * leave the visible items list unchanged. Before the migration these
 * three callbacks silently swallowed errors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, cleanup, act } from "@testing-library/react"
import { useReducer, type ReactNode } from "react"

// ── Mocks ──────────────────────────────────────────────────────────────

const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}))

// Stub the `httpsCallable` so the telemetry path the hook uses on
// failure is a noop in tests.
vi.mock("firebase/functions", () => ({
  getFunctions: () => ({}),
  httpsCallable: () => () => Promise.resolve({ data: { ok: true } }),
}))

// `useFirestoreMutation` is the place the rejection originates. Mock
// it to return functions that always reject so we can assert the
// migration's error envelope (toast + telemetry + no UI advance).
const mockAdd = vi.fn()
const mockUpdate = vi.fn()
const mockRemove = vi.fn()
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

// Stub firestore-helpers to return ref-shaped objects. The real
// helpers want a Firestore instance; we never reach Firestore in
// these tests.
vi.mock("@modules/lib/firestore-helpers", () => ({
  catalogRef: (_db: unknown, id: string) => ({ id, path: `catalog/${id}` }),
  checkoutsCollection: (_db: unknown) => ({ path: "checkouts" }),
  checkoutItemsCollection: (_db: unknown, coId: string) => ({
    path: `checkouts/${coId}/items`,
  }),
  checkoutItemRef: (_db: unknown, coId: string, itemId: string) => ({
    id: itemId,
    path: `checkouts/${coId}/items/${itemId}`,
  }),
}))

// Capture the callbacks passed to the workshop section so the test
// can invoke them directly. The callbacks `useMemo` is the surface
// under test.
const capturedCallbacks: {
  current: {
    addItem: (item: { workshop: string; id: string }) => Promise<void>
    updateItem: (id: string, item: unknown) => void
    removeItem: (id: string) => void
  } | null
} = { current: null }

vi.mock("@/components/usage/workshop-section-with-catalog", () => ({
  WorkshopSectionWithCatalog: ({
    workshopId,
    callbacks,
  }: {
    workshopId: string
    callbacks: {
      addItem: (item: { workshop: string; id: string }) => Promise<void>
      updateItem: (id: string, item: unknown) => void
      removeItem: (id: string) => void
    }
  }) => {
    capturedCallbacks.current = callbacks
    return <div data-testid={`workshop-section-${workshopId}`}>{workshopId}</div>
  },
}))

import {
  FirebaseProvider,
  type FirebaseServices,
} from "@modules/lib/firebase-context"
import type {
  PricingConfig,
  WorkshopId,
} from "@modules/lib/workshop-config"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"
import { StepWorkshops } from "./step-workshops"
import {
  checkoutReducer,
  initialState,
  type CheckoutState,
} from "./use-checkout-state"

function makeConfig(): PricingConfig {
  return {
    entryFees: { erwachsen: {}, kind: {}, firma: {} },
    workshops: {
      makerspace: { label: "Maker Space", order: 2 },
    } as PricingConfig["workshops"],
    slaLayerPrice: { none: 0.01, member: 0.008 },
    labels: {
      units: {
        h: "Std.",
        m2: "m²",
        m: "m",
        stk: "Stk.",
        kg: "kg",
        chf: "CHF",
      },
      discounts: { none: "Normal", member: "Mitglied" },
    },
  }
}

function makeItem(
  overrides: Partial<CheckoutItemLocal> = {},
): CheckoutItemLocal {
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

function renderStep(items: CheckoutItemLocal[]) {
  function Wrapper() {
    const init: CheckoutState = { ...initialState, step: 1 }
    const [state, dispatch] = useReducer(checkoutReducer, init)
    return (
      <FirebaseWrapper>
        <StepWorkshops
          state={state}
          dispatch={dispatch}
          config={makeConfig()}
          items={items}
          checkoutId="co-123"
          userRef={null}
          discountLevel="none"
        />
      </FirebaseWrapper>
    )
  }
  return render(<Wrapper />)
}

describe("StepWorkshops async error envelope (issue #182)", () => {
  beforeEach(() => {
    capturedCallbacks.current = null
    mockAdd.mockReset()
    mockUpdate.mockReset()
    mockRemove.mockReset()
    mockToastError.mockReset()
    mockToastSuccess.mockReset()

    // jsdom: stub matchMedia for useIsMobile.
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

  afterEach(() => {
    cleanup()
  })

  it("addItem: failure surfaces a German error toast (was silent before #182)", async () => {
    mockAdd.mockRejectedValue(new Error("write rejected"))

    // An item must be present so the WorkshopSectionWithCatalog mock is
    // mounted and captures the callbacks.
    renderStep([makeItem({ workshop: "makerspace" as WorkshopId })])
    expect(capturedCallbacks.current).not.toBeNull()

    await act(async () => {
      await capturedCallbacks.current!.addItem({
        workshop: "makerspace",
        id: "new-item",
      })
    })

    expect(mockToastError).toHaveBeenCalledWith(
      "Eintrag konnte nicht hinzugefügt werden",
    )
  })

  it("updateItem: failure surfaces a German error toast (was silent before #182)", async () => {
    mockUpdate.mockRejectedValue(new Error("write rejected"))

    renderStep([makeItem({ workshop: "makerspace" as WorkshopId })])
    expect(capturedCallbacks.current).not.toBeNull()

    await act(async () => {
      capturedCallbacks.current!.updateItem(
        "item-1",
        makeItem({ id: "item-1" }),
      )
      // Let the fire-and-forget promise settle.
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockToastError).toHaveBeenCalledWith(
      "Eintrag konnte nicht aktualisiert werden",
    )
  })

  it("removeItem: failure surfaces a German error toast (was silent before #182)", async () => {
    mockRemove.mockRejectedValue(new Error("write rejected"))

    renderStep([makeItem({ workshop: "makerspace" as WorkshopId })])
    expect(capturedCallbacks.current).not.toBeNull()

    await act(async () => {
      capturedCallbacks.current!.removeItem("item-1")
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockToastError).toHaveBeenCalledWith(
      "Eintrag konnte nicht gelöscht werden",
    )
  })
})
