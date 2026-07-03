// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kiosk email-code sign-in dialog (ADR-0022). Covers the stage flow and the
 * two invariants that matter: no code is sent for an unknown account (no
 * kiosk sign-up), and a successful verify establishes the kiosk session via
 * establishKioskSession with `tokenId: null` (badge-less session) and the
 * bridge bearer wired through.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const checkAccountExists = vi.fn()
const requestLoginEmail = vi.fn()
vi.mock("@modules/lib/auth", () => ({
  useAuth: () => ({ checkAccountExists, requestLoginEmail }),
}))

vi.mock("@modules/lib/firebase-context", () => ({
  useFunctions: () => ({}),
  useFirebaseAuth: () => ({ name: "fake-auth" }),
}))

const resolveBridgeBearer = vi.fn()
vi.mock("@modules/lib/use-bridge", () => ({
  resolveBridgeBearer: (...args: unknown[]) => resolveBridgeBearer(...args),
}))

const verifyKioskCode = vi.fn()
vi.mock("@modules/lib/rpc", () => ({
  rpcCallable: () => verifyKioskCode,
}))

const establishKioskSession = vi.fn()
vi.mock("@modules/lib/token-auth", () => ({
  establishKioskSession: (...args: unknown[]) => establishKioskSession(...args),
}))

import { KioskEmailSignin } from "./kiosk-email-signin"

function throttleError() {
  return Object.assign(new Error("throttled"), {
    code: "functions/resource-exhausted",
  })
}

async function openDialogAndSubmitEmail(email = "user@example.com") {
  const user = userEvent.setup()
  render(<KioskEmailSignin />)
  await user.click(
    screen.getByRole("button", { name: /mit e-mail-code anmelden/i })
  )
  await user.type(screen.getByPlaceholderText("E-Mail-Adresse"), email)
  await user.click(screen.getByRole("button", { name: "Code senden" }))
  return user
}

describe("KioskEmailSignin", () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    resolveBridgeBearer.mockResolvedValue("kiosk-bearer")
    establishKioskSession.mockResolvedValue(undefined)
  })

  it("does NOT send a code for an unknown account and shows the notice", async () => {
    checkAccountExists.mockResolvedValue({ exists: false })

    await openDialogAndSubmitEmail("stranger@example.com")

    expect(
      await screen.findByText(/existiert noch kein Konto/i)
    ).toBeInTheDocument()
    expect(requestLoginEmail).not.toHaveBeenCalled()
  })

  it("advances to the code stage for an existing account", async () => {
    checkAccountExists.mockResolvedValue({ exists: true })
    requestLoginEmail.mockResolvedValue(undefined)

    await openDialogAndSubmitEmail()

    expect(await screen.findByText(/Code eingeben/i)).toBeInTheDocument()
    expect(requestLoginEmail).toHaveBeenCalledWith("user@example.com")
  })

  it("treats the 60s resend throttle as 'code already sent' and advances", async () => {
    checkAccountExists.mockResolvedValue({ exists: true })
    requestLoginEmail.mockRejectedValue(throttleError())

    await openDialogAndSubmitEmail()

    expect(await screen.findByText(/Code eingeben/i)).toBeInTheDocument()
  })

  it("verifies the code with the bridge bearer and establishes the kiosk session", async () => {
    checkAccountExists.mockResolvedValue({ exists: true })
    requestLoginEmail.mockResolvedValue(undefined)
    verifyKioskCode.mockResolvedValue({
      data: {
        customToken: "ct-123",
        userId: "u-1",
        firstName: "Anna",
        lastName: "Muster",
        email: "user@example.com",
        userType: "erwachsen",
        activeMembership: true,
      },
    })

    const user = await openDialogAndSubmitEmail()
    await screen.findByText(/Code eingeben/i)
    await user.type(screen.getByPlaceholderText("6-stelliger Code"), "123456")
    await user.click(screen.getByRole("button", { name: "Anmelden" }))

    await waitFor(() => expect(establishKioskSession).toHaveBeenCalled())
    expect(verifyKioskCode).toHaveBeenCalledWith({
      email: "user@example.com",
      code: "123456",
      bearer: "kiosk-bearer",
    })
    const [, customToken, tokenUser] = establishKioskSession.mock.calls[0]
    expect(customToken).toBe("ct-123")
    expect(tokenUser).toMatchObject({
      tokenId: null,
      userId: "u-1",
      firstName: "Anna",
      activeMembership: true,
    })
  })

  it("renders the server error inline on a wrong code", async () => {
    checkAccountExists.mockResolvedValue({ exists: true })
    requestLoginEmail.mockResolvedValue(undefined)
    verifyKioskCode.mockRejectedValue(new Error("Code falsch."))

    const user = await openDialogAndSubmitEmail()
    await screen.findByText(/Code eingeben/i)
    await user.type(screen.getByPlaceholderText("6-stelliger Code"), "000000")
    await user.click(screen.getByRole("button", { name: "Anmelden" }))

    expect(await screen.findByText("Code falsch.")).toBeInTheDocument()
    expect(establishKioskSession).not.toHaveBeenCalled()
  })
})
