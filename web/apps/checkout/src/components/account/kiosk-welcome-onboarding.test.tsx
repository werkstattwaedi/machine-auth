// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * KioskWelcomeOnboarding — a session signed in by badge tap alone steps up
 * (ADR-0041) on leaving the welcome step, before the profile form shows the
 * stored data; a cancelled step-up stays on step 1. Code sign-ins (already
 * elevated) go straight on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@modules/lib/firebase-context", () => ({
  useDb: () => ({}),
  useFunctions: () => ({}),
}))
vi.mock("@modules/lib/firestore-helpers", () => ({
  userRef: () => ({}),
  membershipRef: () => ({}),
}))
vi.mock("@modules/lib/firestore", () => ({
  useDocument: () => ({
    data: {
      email: "imported@example.com",
      firstName: "Franziska",
      lastName: "Imported",
      phone: "+41791234567",
      userType: "erwachsen",
      termsAcceptedAt: null,
    },
  }),
}))
vi.mock("@modules/lib/rpc", () => ({ rpcCallable: () => vi.fn() }))
vi.mock("@modules/hooks/use-async-mutation", () => ({
  useAsyncMutation: () => ({
    mutate: async (fn: () => Promise<unknown>) => fn(),
    loading: false,
  }),
}))

const authState = { isKioskElevated: false }
vi.mock("@modules/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@modules/lib/auth")>()),
  useAuth: () => authState,
}))

const ensureElevated = vi.fn()
vi.mock("@/components/checkout/kiosk-elevation-dialog", () => ({
  useKioskElevation: () => ({ ensureElevated }),
}))

import { KioskWelcomeOnboarding } from "./kiosk-welcome-onboarding"

describe("KioskWelcomeOnboarding step-up", () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    authState.isKioskElevated = false
  })

  it("a badge-tap session confirms a code before the profile step", async () => {
    const user = userEvent.setup()
    render(<KioskWelcomeOnboarding userId="member1" />)

    await user.click(screen.getByTestId("welcome-next"))
    expect(ensureElevated).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("welcome-firstname")).toBeNull()

    const [onElevated] = ensureElevated.mock.calls[0]
    onElevated()
    expect(await screen.findByTestId("welcome-firstname")).toBeInTheDocument()
  })

  it("a cancelled step-up stays on the welcome step", async () => {
    const user = userEvent.setup()
    render(<KioskWelcomeOnboarding userId="member1" />)

    await user.click(screen.getByTestId("welcome-next"))
    const [, onCancel] = ensureElevated.mock.calls[0]
    onCancel()

    await waitFor(() =>
      expect(screen.getByText(/Schritt 1 von 4 ·/)).toBeInTheDocument()
    )
    expect(screen.queryByTestId("welcome-firstname")).toBeNull()
  })

  it("an elevated session goes straight to the profile step", async () => {
    authState.isKioskElevated = true
    const user = userEvent.setup()
    render(<KioskWelcomeOnboarding userId="member1" />)

    await user.click(screen.getByTestId("welcome-next"))
    expect(await screen.findByTestId("welcome-firstname")).toBeInTheDocument()
    expect(ensureElevated).not.toHaveBeenCalled()
  })
})
