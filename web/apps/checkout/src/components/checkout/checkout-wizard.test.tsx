// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression test for the B5 launch-readiness fix (issue #144 +
 * ADR-0025): when `closeCheckoutAndGetPayment` rejects on submit, the
 * wizard MUST surface a German error toast and MUST NOT advance to
 * the "submitted" / payment-result screen.
 *
 * The wizard pulls in a lot of context (auth, token-auth, useCollection,
 * functions, pricing config, …); we mock the ambient dependencies so
 * the test stays focused on the submit error branch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ReactNode } from "react"

// --- toast spy ---
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

// --- httpsCallable spy ---
// The wizard calls `httpsCallable(functions, "closeCheckoutAndGetPayment")`
// and then invokes the returned function. We expose `mockCallable` so
// each test can configure resolve/reject behaviour.
const mockCallable = vi.fn()
vi.mock("firebase/functions", () => ({
  getFunctions: () => ({}),
  httpsCallable: () => mockCallable,
}))

// --- useAuth + useTokenAuth ---
// Fake an account-logged-in user so the wizard renders with a stable
// principal (no anonymous sign-in to thread).
vi.mock("@modules/lib/auth", () => ({
  useAuth: () => ({
    user: { uid: "test-uid", isAnonymous: false },
    userDoc: {
      id: "test-user",
      firstName: "Max",
      lastName: "Muster",
      email: "max@example.com",
      userType: "erwachsen",
      termsAcceptedAt: new Date(),
      roles: [],
    },
    signOut: vi.fn(),
    signInAnonymouslyIfNeeded: vi.fn(),
  }),
}))
vi.mock("@modules/lib/token-auth", () => ({
  useTokenAuth: () => ({
    tokenUser: null,
    loading: false,
    isTagAuth: false,
    tagSignOut: vi.fn(),
  }),
}))

// --- firestore hooks ---
// The wizard uses useCollection in two places (open checkouts, items).
// We return a stable empty list (degenerate "no checkout yet" path) so
// the submit branches into `newCheckout`.
vi.mock("@modules/lib/firestore", () => ({
  useCollection: () => ({ data: [], loading: false, error: null }),
}))

// --- firestore-helpers (refs are unused values in our fakes) ---
vi.mock("@modules/lib/firestore-helpers", () => ({
  userRef: () => ({ id: "test-user", path: "users/test-user" }),
  checkoutsCollection: () => ({ path: "checkouts" }),
  checkoutItemsCollection: () => ({ path: "checkouts/x/items" }),
}))

// --- firebase-context ---
const fakeFunctions = {}
vi.mock("@modules/lib/firebase-context", () => ({
  useDb: () => ({}),
  useFunctions: () => fakeFunctions,
  useFirebaseAuth: () => ({}),
  FirebaseProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

// --- workshop-config: provide a minimal pricing config so the wizard
// passes the configError gate. The hook's real return shape is
// `{ data, loading, error, configError }` (see firestore.ts +
// usePricingConfig). ---
vi.mock("@modules/lib/workshop-config", () => ({
  usePricingConfig: () => ({
    data: {
      entryFees: { erwachsen: { regular: 5 } },
      workshops: { holz: { label: "Holz", order: 1 } },
      slaLayerPrice: { none: 0.01, member: 0.008 },
      labels: {
        units: { h: "Std." },
        discounts: { none: "Normal", member: "Mitglied" },
      },
    },
    loading: false,
    error: null,
    configError: null,
  }),
  getSortedWorkshops: (config: { workshops: Record<string, { label: string; order: number }> }) =>
    Object.entries(config.workshops).sort((a, b) => a[1].order - b[1].order),
}))

// --- pricing helpers used by the wizard / step-checkout ---
vi.mock("@modules/lib/pricing", () => ({
  calculateFee: () => 5,
  USAGE_TYPE_LABELS: { regular: "Regulär" },
  USER_TYPE_LABELS: { erwachsen: "Erwachsen", kind: "Kind" },
}))

// Imports below this line so they pick up the mocks above.
import { CheckoutWizard } from "./checkout-wizard"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  sessionStorage.clear()
})

describe("CheckoutWizard submit error handling (B5)", () => {
  it("does NOT advance to payment-result when the callable rejects", async () => {
    // Configure the callable to reject with a FirebaseError-shaped object
    // (mirrors what the Firebase Functions SDK throws on a rejected
    // callable RPC: it carries `code` + `message`).
    const rejection = Object.assign(
      new Error("Missing or insufficient permissions."),
      { code: "permission-denied", name: "FirebaseError" },
    )
    mockCallable.mockRejectedValueOnce(rejection)

    render(<CheckoutWizard initialStep={2} />)

    // The "submit" button on step 2 ("Senden & bezahlen").
    const submitBtn = await screen.findByRole("button", {
      name: /Senden & bezahlen/,
    })

    // Clicking submits — wrap in act so the async branch settles.
    await act(async () => {
      await userEvent.click(submitBtn)
    })

    // Hook surfaced an error toast (German mapping for permission-denied).
    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(mockToastError.mock.calls[0][0]).toBe(
      "Keine Berechtigung für diese Aktion.",
    )

    // Wizard did NOT advance to the payment-result screen — the back
    // button on step 2 ("Zurück") is still in the DOM, and the
    // payment-result-only "Zurück zum Start" / "Zurück zum Besuch"
    // labels are absent.
    expect(
      screen.queryByRole("button", { name: /Zurück zum Start/ }),
    ).toBeNull()
    expect(
      screen.queryByRole("button", { name: /Zurück zum Besuch/ }),
    ).toBeNull()
    expect(screen.getByRole("button", { name: /Senden & bezahlen/ })).toBeDefined()

    // Inline alert renders the structured error message.
    const alert = screen.getByTestId("checkout-submit-error")
    expect(alert.textContent).toContain("Keine Berechtigung")

    // Submit button is re-enabled for retry (not stuck in `submitting`).
    expect(
      (screen.getByRole("button", { name: /Senden & bezahlen/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })
})
