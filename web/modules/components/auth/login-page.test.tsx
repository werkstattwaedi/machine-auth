// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"

// jsdom lacks ResizeObserver, which the radix Checkbox in the sign-up form uses.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const navigateMock = vi.fn()

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}))

// Mutable auth surface so each test can tune the mocked methods.
const auth = {
  user: null as unknown,
  userDoc: null as unknown,
  userDocLoading: false,
  loading: false,
  sessionKind: null as unknown,
  checkAccountExists: vi.fn(),
  requestLoginEmail: vi.fn(),
  verifyLoginCode: vi.fn(),
  verifyLoginCodeAndCreateProfile: vi.fn(),
  completeSignedInSignup: vi.fn(),
  signInWithGoogle: vi.fn(),
  pendingGoogleLink: false,
}

vi.mock("@modules/lib/auth", () => ({
  useAuth: () => auth,
  isProfileComplete: () => false,
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const { LoginPage } = await import("./login-page")

function enterEmail(value = "new@example.com") {
  fireEvent.change(screen.getByTestId("login-email-input"), {
    target: { value },
  })
  fireEvent.click(screen.getByTestId("login-email-submit"))
}

describe("LoginPage", () => {
  beforeEach(() => {
    navigateMock.mockClear()
    auth.checkAccountExists = vi.fn()
    auth.requestLoginEmail = vi.fn().mockResolvedValue(undefined)
    auth.signInWithGoogle = vi.fn()
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it("shows the plain sign-in heading for admin (signupEnabled false)", () => {
    render(<LoginPage defaultRedirect="/users" />)
    expect(screen.getByText("Anmelden")).toBeTruthy()
  })

  it("shows the combined heading when signupEnabled is true", () => {
    render(<LoginPage defaultRedirect="/visit" signupEnabled />)
    expect(screen.getByText("Anmelden oder Konto erstellen")).toBeTruthy()
  })

  it("renders the subtitle when provided", () => {
    render(<LoginPage defaultRedirect="/users" subtitle="Administration" />)
    expect(screen.getByText("Administration")).toBeTruthy()
  })

  it("places the Google button before the email form when googleButtonPosition='top'", () => {
    render(<LoginPage defaultRedirect="/users" googleButtonPosition="top" />)
    const googleBtn = screen.getByText("Mit Google anmelden")
    const emailForm = screen.getByTestId("login-email-stage")
    expect(googleBtn.compareDocumentPosition(emailForm)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it("places the Google button after the email form when googleButtonPosition='bottom'", () => {
    render(<LoginPage defaultRedirect="/visit" signupEnabled googleButtonPosition="bottom" />)
    const googleBtn = screen.getByText("Mit Google anmelden")
    const emailForm = screen.getByTestId("login-email-stage")
    expect(emailForm.compareDocumentPosition(googleBtn)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it("shows only the code field for an existing account after email submit", async () => {
    auth.checkAccountExists = vi.fn().mockResolvedValue({ exists: true, hasAuthUser: true })
    render(<LoginPage defaultRedirect="/visit" signupEnabled />)

    enterEmail("known@example.com")

    await waitFor(() => expect(screen.getByTestId("login-code-stage")).toBeTruthy())
    expect(auth.requestLoginEmail).toHaveBeenCalledWith("known@example.com")
    expect(screen.queryByTestId("signup-firstname")).toBeNull()
  })

  it("shows the inline sign-up form for a new account after email submit", async () => {
    auth.checkAccountExists = vi.fn().mockResolvedValue({ exists: false, hasAuthUser: false })
    render(<LoginPage defaultRedirect="/visit" signupEnabled />)

    enterEmail("new@example.com")

    await waitFor(() => expect(screen.getByTestId("login-signup-stage")).toBeTruthy())
    expect(screen.getByTestId("signup-firstname")).toBeTruthy()
    expect(screen.getByTestId("signup-code-input")).toBeTruthy()
    expect(screen.getByTestId("signup-membertype-firma")).toBeTruthy()
  })

  it("skips the existence check for admin and goes straight to the code field", async () => {
    render(<LoginPage defaultRedirect="/users" />)
    enterEmail("admin@example.com")

    await waitFor(() => expect(screen.getByTestId("login-code-stage")).toBeTruthy())
    expect(auth.checkAccountExists).not.toHaveBeenCalled()
    expect(auth.requestLoginEmail).toHaveBeenCalledWith("admin@example.com")
  })

  it("reveals the firma address fields when Firma is selected in sign-up", async () => {
    auth.checkAccountExists = vi.fn().mockResolvedValue({ exists: false, hasAuthUser: false })
    render(<LoginPage defaultRedirect="/visit" signupEnabled />)
    enterEmail("firma@example.com")

    await waitFor(() => expect(screen.getByTestId("login-signup-stage")).toBeTruthy())
    expect(screen.queryByLabelText("Strasse und Hausnummer")).toBeNull()
    fireEvent.click(screen.getByTestId("signup-membertype-firma"))
    expect(screen.getByLabelText("Strasse und Hausnummer")).toBeTruthy()
  })
})
