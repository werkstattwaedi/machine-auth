// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Embedded check-in sign-in (design handoff "Kiosk sign-in flow redesign").
 * Covers the identifier gate, the two session flavors (kiosk ephemeral via
 * verifyLoginCodeKiosk + establishKioskSession; own-device persistent via
 * verifyLoginCode), the no-kiosk-sign-up invariant, the own-device sign-up
 * dialog for unknown e-mails, and the cancel-resets-to-idle contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const checkAccountExists = vi.fn()
const requestLoginEmail = vi.fn()
const verifyLoginCode = vi.fn()
const verifyLoginCodeAndCreateProfile = vi.fn()
const completeSignedInSignup = vi.fn()
const signOut = vi.fn()
const signInWithGoogle = vi.fn()
vi.mock("@modules/lib/auth", () => ({
  useAuth: () => ({
    user: null,
    checkAccountExists,
    requestLoginEmail,
    verifyLoginCode,
    verifyLoginCodeAndCreateProfile,
    completeSignedInSignup,
    signOut,
    signInWithGoogle,
  }),
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
const checkPhoneAccountExists = vi.fn()
const exchangeKioskSession = vi.fn()
const RPC_MOCKS: Record<string, (payload: unknown) => unknown> = {
  verifyLoginCodeKiosk: verifyKioskCode,
  checkPhoneAccountExists,
  exchangeKioskSession,
}
vi.mock("@modules/lib/rpc", () => ({
  rpcCallable:
    (_functions: unknown, _group: string, method: string) =>
    (payload: unknown) =>
      RPC_MOCKS[method](payload),
}))

const establishKioskSession = vi.fn()
vi.mock("@modules/lib/token-auth", () => ({
  establishKioskSession: (...args: unknown[]) => establishKioskSession(...args),
}))

// SMS path: stub the Firebase phone-auth surface (the fake auth object from
// the firebase-context mock can't drive the real SDK).
const signInWithPhoneNumber = vi.fn()
const firebaseSignOut = vi.fn()
vi.mock("firebase/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/auth")>()
  return {
    ...actual,
    RecaptchaVerifier: class {
      clear() {}
    },
    signInWithPhoneNumber: (...args: unknown[]) => signInWithPhoneNumber(...args),
    signOut: (...args: unknown[]) => firebaseSignOut(...args),
  }
})

import { CheckinSignin, detectChannel } from "./checkin-signin"

function throttleError() {
  return Object.assign(new Error("throttled"), {
    code: "functions/resource-exhausted",
  })
}

async function typeIdentifierAndSubmit(
  kiosk: boolean,
  email = "user@example.com",
) {
  const user = userEvent.setup()
  render(<CheckinSignin kiosk={kiosk} />)
  await user.type(screen.getByTestId("checkin-identifier"), email)
  await user.click(screen.getByRole("button", { name: "Code senden" }))
  return user
}

async function enterCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  await screen.findByText("Code eingeben")
  await user.type(screen.getByTestId("checkin-code-input"), code)
  await user.click(screen.getByRole("button", { name: /Anmelden/ }))
}

describe("detectChannel", () => {
  it("recognizes a full e-mail address only", () => {
    expect(detectChannel("user@example.com", false)).toBe("email")
    expect(detectChannel("  user@example.com  ", false)).toBe("email")
    expect(detectChannel("user@", false)).toBeNull()
    expect(detectChannel("user", false)).toBeNull()
    expect(detectChannel("", false)).toBeNull()
  })

  it("recognizes phone numbers only when smsEnabled", () => {
    expect(detectChannel("+41 79 123 45 67", true)).toBe("sms")
    expect(detectChannel("079 123 45 67", true)).toBe("sms")
    expect(detectChannel("+41 79 123 45 67", false)).toBeNull()
    // Too few digits to be a phone number.
    expect(detectChannel("+41", true)).toBeNull()
  })
})

describe("CheckinSignin", () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    resolveBridgeBearer.mockResolvedValue("kiosk-bearer")
    establishKioskSession.mockResolvedValue(undefined)
  })

  it("keeps the submit arrow disabled until a valid e-mail is typed", async () => {
    const user = userEvent.setup()
    render(<CheckinSignin kiosk={false} />)
    const submit = screen.getByTestId("checkin-identifier-submit")
    expect(submit).toBeDisabled()
    await user.type(screen.getByTestId("checkin-identifier"), "user@")
    expect(submit).toBeDisabled()
    await user.type(screen.getByTestId("checkin-identifier"), "example.com")
    expect(submit).toBeEnabled()
  })

  it("kiosk: does NOT send a code for an unknown account (no kiosk sign-up)", async () => {
    checkAccountExists.mockResolvedValue({ exists: false })

    await typeIdentifierAndSubmit(true, "stranger@example.com")

    expect(
      await screen.findByText(/existiert noch kein Konto/i),
    ).toBeInTheDocument()
    expect(requestLoginEmail).not.toHaveBeenCalled()
    expect(screen.queryByText("Code eingeben")).toBeNull()
  })

  it("kiosk: opens the code dialog and establishes the kiosk session on verify", async () => {
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

    const user = await typeIdentifierAndSubmit(true)
    await enterCode(user, "123456")

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
    // Kiosk must never mint the persistent login.
    expect(verifyLoginCode).not.toHaveBeenCalled()
  })

  it("kiosk: treats the 60s resend throttle as 'code already sent' and advances", async () => {
    checkAccountExists.mockResolvedValue({ exists: true })
    requestLoginEmail.mockRejectedValue(throttleError())

    await typeIdentifierAndSubmit(true)

    expect(await screen.findByText("Code eingeben")).toBeInTheDocument()
  })

  it("own device: verifies via the persistent login, not the kiosk session", async () => {
    checkAccountExists.mockResolvedValue({ exists: true })
    requestLoginEmail.mockResolvedValue(undefined)
    verifyLoginCode.mockResolvedValue(undefined)

    const user = await typeIdentifierAndSubmit(false)
    await enterCode(user, "654321")

    await waitFor(() =>
      expect(verifyLoginCode).toHaveBeenCalledWith("user@example.com", "654321"),
    )
    expect(verifyKioskCode).not.toHaveBeenCalled()
    expect(establishKioskSession).not.toHaveBeenCalled()
  })

  it("own device: an unknown e-mail opens the sign-up dialog instead", async () => {
    checkAccountExists.mockResolvedValue({ exists: false })
    requestLoginEmail.mockResolvedValue(undefined)

    await typeIdentifierAndSubmit(false, "new@example.com")

    expect(await screen.findByTestId("checkin-signup-dialog")).toBeInTheDocument()
    // The sign-up form needs the code, so one was requested up front.
    expect(requestLoginEmail).toHaveBeenCalledWith("new@example.com")
    expect(screen.queryByText("Code eingeben")).toBeNull()
  })

  it("renders the server error inline on a wrong code", async () => {
    checkAccountExists.mockResolvedValue({ exists: true })
    requestLoginEmail.mockResolvedValue(undefined)
    verifyKioskCode.mockRejectedValue(new Error("Code falsch."))

    const user = await typeIdentifierAndSubmit(true)
    await enterCode(user, "000000")

    expect(await screen.findByText("Code falsch.")).toBeInTheDocument()
    expect(establishKioskSession).not.toHaveBeenCalled()
  })

  it("Abbrechen closes the dialog and clears the identifier (back to idle)", async () => {
    checkAccountExists.mockResolvedValue({ exists: true })
    requestLoginEmail.mockResolvedValue(undefined)

    const user = await typeIdentifierAndSubmit(true)
    await screen.findByText("Code eingeben")
    await user.click(screen.getByTestId("checkin-code-cancel"))

    await waitFor(() =>
      expect(screen.queryByText("Code eingeben")).toBeNull(),
    )
    expect(screen.getByTestId("checkin-identifier")).toHaveValue("")
  })

  it("kiosk renders the NFC slot instead of the Google button", () => {
    render(
      <CheckinSignin kiosk>
        <div data-testid="nfc-slot" />
      </CheckinSignin>,
    )
    expect(screen.getByTestId("nfc-slot")).toBeInTheDocument()
    expect(screen.queryByText("Mit Google anmelden")).toBeNull()
  })

  it("own device renders the Google button", () => {
    render(<CheckinSignin kiosk={false} />)
    expect(screen.getByText("Mit Google anmelden")).toBeInTheDocument()
  })
})

describe("CheckinSignin — SMS channel (smsEnabled)", () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    resolveBridgeBearer.mockResolvedValue("kiosk-bearer")
    establishKioskSession.mockResolvedValue(undefined)
  })

  async function typePhoneAndSubmit(kiosk: boolean, phone = "079 123 45 67") {
    const user = userEvent.setup()
    render(<CheckinSignin kiosk={kiosk} smsEnabled />)
    await user.type(screen.getByTestId("checkin-identifier"), phone)
    await user.click(screen.getByRole("button", { name: "Code senden" }))
    return user
  }

  it("shows the profile hint when the number has no verified account, no SMS sent", async () => {
    checkPhoneAccountExists.mockResolvedValue({
      data: { exists: false, hasAuthUser: false },
    })

    await typePhoneAndSubmit(false)

    expect(
      await screen.findByText(/kein Konto hinterlegt/i),
    ).toBeInTheDocument()
    expect(checkPhoneAccountExists).toHaveBeenCalledWith({
      phone: "+41791234567",
    })
    expect(signInWithPhoneNumber).not.toHaveBeenCalled()
  })

  it("own device: confirms the SMS code in place — no kiosk exchange", async () => {
    checkPhoneAccountExists.mockResolvedValue({
      data: { exists: true, hasAuthUser: true },
    })
    const confirm = vi.fn().mockResolvedValue({})
    signInWithPhoneNumber.mockResolvedValue({ confirm })

    const user = await typePhoneAndSubmit(false)
    await enterCode(user, "123456")

    await waitFor(() => expect(confirm).toHaveBeenCalledWith("123456"))
    // The E.164 identifier surfaces in the dialog subtitle.
    expect(signInWithPhoneNumber).toHaveBeenCalledWith(
      expect.anything(),
      "+41791234567",
      expect.anything(),
    )
    expect(exchangeKioskSession).not.toHaveBeenCalled()
    expect(establishKioskSession).not.toHaveBeenCalled()
  })

  it("kiosk: swaps the confirmed phone session for the ephemeral kiosk session", async () => {
    checkPhoneAccountExists.mockResolvedValue({
      data: { exists: true, hasAuthUser: true },
    })
    const confirm = vi.fn().mockResolvedValue({})
    signInWithPhoneNumber.mockResolvedValue({ confirm })
    exchangeKioskSession.mockResolvedValue({
      data: {
        customToken: "ct-sms",
        userId: "u-1",
        firstName: "Anna",
        activeMembership: true,
      },
    })

    const user = await typePhoneAndSubmit(true)
    await enterCode(user, "654321")

    await waitFor(() => expect(establishKioskSession).toHaveBeenCalled())
    expect(exchangeKioskSession).toHaveBeenCalledWith({ bearer: "kiosk-bearer" })
    const [, customToken, tokenUser] = establishKioskSession.mock.calls[0]
    expect(customToken).toBe("ct-sms")
    expect(tokenUser).toMatchObject({ tokenId: null, userId: "u-1" })
  })

  it("kiosk: a failed exchange signs the phone session out again", async () => {
    checkPhoneAccountExists.mockResolvedValue({
      data: { exists: true, hasAuthUser: true },
    })
    const confirm = vi.fn().mockResolvedValue({})
    signInWithPhoneNumber.mockResolvedValue({ confirm })
    exchangeKioskSession.mockRejectedValue(new Error("kein vollständiges Konto"))
    firebaseSignOut.mockResolvedValue(undefined)

    const user = await typePhoneAndSubmit(true)
    await enterCode(user, "654321")

    expect(
      await screen.findByText(/kein vollständiges Konto/),
    ).toBeInTheDocument()
    expect(firebaseSignOut).toHaveBeenCalled()
    expect(establishKioskSession).not.toHaveBeenCalled()
  })

  it("maps a wrong SMS code to the German inline error", async () => {
    checkPhoneAccountExists.mockResolvedValue({
      data: { exists: true, hasAuthUser: true },
    })
    const confirm = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("bad"), { code: "auth/invalid-verification-code" }),
      )
    signInWithPhoneNumber.mockResolvedValue({ confirm })

    const user = await typePhoneAndSubmit(false)
    await enterCode(user, "000000")

    expect(await screen.findByText("Code falsch.")).toBeInTheDocument()
  })
})
