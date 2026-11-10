// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * KioskWelcomeOnboarding — runs when the session payload says the profile
 * is incomplete (#854: a badge tap alone may not read the users doc). On
 * leaving the welcome step it steps up (ADR-0041) and only then reads the
 * stored profile for the form; a cancelled step-up stays on step 1 without
 * reading anything.
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
const getDoc = vi.fn()
vi.mock("firebase/firestore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/firestore")>()),
  getDoc: (...args: unknown[]) => getDoc(...args),
}))
vi.mock("@modules/lib/rpc", () => ({ rpcCallable: () => vi.fn() }))
vi.mock("@modules/hooks/use-async-mutation", () => ({
  useAsyncMutation: () => ({
    mutate: async (fn: () => Promise<unknown>) => fn(),
    loading: false,
  }),
}))

const ensureElevated = vi.fn()
vi.mock("@/components/checkout/kiosk-elevation-dialog", () => ({
  useKioskElevation: () => ({ ensureElevated }),
}))

import { KioskWelcomeOnboarding } from "./kiosk-welcome-onboarding"

const TOKEN_USER = {
  tokenId: "04aa",
  userId: "member1",
  firstName: "Franziska",
  lastName: "Imported",
  email: "imported@example.com",
  userType: "erwachsen",
  profileComplete: false,
}

describe("KioskWelcomeOnboarding", () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    getDoc.mockResolvedValue({
      data: () => ({
        firstName: "Franziska",
        lastName: "Imported",
        phone: "+41791234567",
      }),
    })
  })

  it("steps up before reading the stored profile for step 2", async () => {
    const user = userEvent.setup()
    render(<KioskWelcomeOnboarding tokenUser={TOKEN_USER} />)

    await user.click(screen.getByTestId("welcome-next"))
    expect(ensureElevated).toHaveBeenCalledTimes(1)
    expect(getDoc).not.toHaveBeenCalled()
    expect(screen.queryByTestId("welcome-phone")).toBeNull()

    const [onElevated] = ensureElevated.mock.calls[0]
    onElevated()
    expect(await screen.findByTestId("welcome-phone")).toHaveValue(
      "+41791234567",
    )
    expect(getDoc).toHaveBeenCalledTimes(1)
  })

  it("a cancelled step-up stays on the welcome step and reads nothing", async () => {
    const user = userEvent.setup()
    render(<KioskWelcomeOnboarding tokenUser={TOKEN_USER} />)

    await user.click(screen.getByTestId("welcome-next"))
    const [, onCancel] = ensureElevated.mock.calls[0]
    onCancel()

    await waitFor(() =>
      expect(screen.getByText(/Schritt 1 von 4 ·/)).toBeInTheDocument(),
    )
    expect(screen.queryByTestId("welcome-firstname")).toBeNull()
    expect(getDoc).not.toHaveBeenCalled()
  })

  it("stays on the welcome step when reading the profile fails", async () => {
    getDoc.mockRejectedValue(new Error("permission-denied"))
    const user = userEvent.setup()
    render(<KioskWelcomeOnboarding tokenUser={TOKEN_USER} />)

    await user.click(screen.getByTestId("welcome-next"))
    const [onElevated] = ensureElevated.mock.calls[0]
    onElevated()

    await waitFor(() => expect(getDoc).toHaveBeenCalled())
    expect(screen.getByText(/Schritt 1 von 4 ·/)).toBeInTheDocument()
    expect(screen.queryByTestId("welcome-firstname")).toBeNull()
  })

  it("renders nothing when the payload says the profile is complete", () => {
    render(
      <KioskWelcomeOnboarding
        tokenUser={{ ...TOKEN_USER, profileComplete: true }}
      />,
    )
    expect(screen.queryByTestId("welcome-onboarding-dialog")).toBeNull()
  })

  it("renders nothing for a payload without the flag", () => {
    const { profileComplete: _, ...legacy } = TOKEN_USER
    render(<KioskWelcomeOnboarding tokenUser={legacy} />)
    expect(screen.queryByTestId("welcome-onboarding-dialog")).toBeNull()
  })
})
