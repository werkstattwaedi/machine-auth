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
  googleSignInPending: false,
}

vi.mock("@modules/lib/auth", () => ({
  useAuth: () => auth,
  isProfileComplete: () => false,
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

// The page prewarms authCall on mount (ADR-0037); neither the functions
// context nor a real ping exists in this harness.
vi.mock("@modules/lib/firebase-context", () => ({
  useFunctions: () => ({}),
}))
vi.mock("@modules/lib/rpc", () => ({
  prewarm: vi.fn(),
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
    auth.user = null
    auth.userDoc = null
    auth.sessionKind = null
    auth.googleSignInPending = false
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
    auth.checkAccountExists = vi.fn().mockResolvedValue({ exists: true, hasAuthUser: true, hasProfile: true })
    render(<LoginPage defaultRedirect="/visit" signupEnabled />)

    enterEmail("known@example.com")

    await waitFor(() => expect(screen.getByTestId("login-code-stage")).toBeTruthy())
    expect(auth.requestLoginEmail).toHaveBeenCalledWith("known@example.com")
    expect(screen.queryByTestId("signup-firstname")).toBeNull()
  })

  it("shows the inline sign-up form for a new account after email submit", async () => {
    auth.checkAccountExists = vi.fn().mockResolvedValue({ exists: false, hasAuthUser: false, hasProfile: false })
    render(<LoginPage defaultRedirect="/visit" signupEnabled />)

    enterEmail("new@example.com")

    await waitFor(() => expect(screen.getByTestId("login-signup-stage")).toBeTruthy())
    expect(screen.getByTestId("signup-firstname")).toBeTruthy()
    expect(screen.getByTestId("signup-code-input")).toBeTruthy()
    expect(screen.getByTestId("signup-membertype-firma")).toBeTruthy()
  })

  it("shows the code field (sign-in) for an imported member with a profile but no accepted terms", async () => {
    // hasProfile=true, exists=false: a users doc exists but terms aren't
    // accepted (imported/admin-created). Must sign IN, not sign up — the
    // post-login redirect handles profile completion with prefilled data.
    auth.checkAccountExists = vi
      .fn()
      .mockResolvedValue({ exists: false, hasAuthUser: true, hasProfile: true })
    render(<LoginPage defaultRedirect="/visit" signupEnabled />)

    enterEmail("imported@example.com")

    await waitFor(() => expect(screen.getByTestId("login-code-stage")).toBeTruthy())
    expect(auth.requestLoginEmail).toHaveBeenCalledWith("imported@example.com")
    expect(screen.queryByTestId("login-signup-stage")).toBeNull()
    expect(screen.queryByTestId("signup-firstname")).toBeNull()
  })

  it("skips the existence check for admin and goes straight to the code field", async () => {
    render(<LoginPage defaultRedirect="/users" />)
    enterEmail("admin@example.com")

    await waitFor(() => expect(screen.getByTestId("login-code-stage")).toBeTruthy())
    expect(auth.checkAccountExists).not.toHaveBeenCalled()
    expect(auth.requestLoginEmail).toHaveBeenCalledWith("admin@example.com")
  })

  it("reveals the firma address fields when Firma is selected in sign-up", async () => {
    auth.checkAccountExists = vi.fn().mockResolvedValue({ exists: false, hasAuthUser: false, hasProfile: false })
    render(<LoginPage defaultRedirect="/visit" signupEnabled />)
    enterEmail("firma@example.com")

    await waitFor(() => expect(screen.getByTestId("login-signup-stage")).toBeTruthy())
    expect(screen.queryByLabelText("Strasse und Hausnummer")).toBeNull()
    fireEvent.click(screen.getByTestId("signup-membertype-firma"))
    expect(screen.getByLabelText("Strasse und Hausnummer")).toBeTruthy()
  })
  // ADR-0043 Google guard: the auth-state listener reports the popup's user
  // before signInWithGoogle has decided whether to keep the session. A member
  // whose account lives under another uid is signed out again a moment later
  // — the page must not have pinned the sign-up form for them by then, or
  // they are left signed out in front of a form that cannot submit, with the
  // "Konto existiert bereits" banner (e-mail stage only) never shown.
  describe("doc-less signed-in principal vs. a pending Google sign-in", () => {
    const docLessUser = { uid: "google-uid", isAnonymous: false }

    it("drops a doc-less principal into inline sign-up once nothing is pending", () => {
      auth.user = docLessUser
      auth.sessionKind = "real"
      render(<LoginPage defaultRedirect="/visit" signupEnabled />)

      expect(screen.getByTestId("login-signup-stage")).toBeTruthy()
    })

    it("stays on the e-mail stage while the Google sign-in is still deciding", () => {
      auth.user = docLessUser
      auth.sessionKind = "real"
      auth.googleSignInPending = true
      const { rerender } = render(
        <LoginPage defaultRedirect="/visit" signupEnabled />,
      )

      expect(screen.getByTestId("login-email-stage")).toBeTruthy()
      expect(screen.queryByTestId("login-signup-stage")).toBeNull()
      expect(navigateMock).not.toHaveBeenCalled()

      // The guard refused: signed out, nothing pending → still the e-mail
      // stage, ready for the e-mail code.
      auth.user = null
      auth.sessionKind = null
      auth.googleSignInPending = false
      rerender(<LoginPage defaultRedirect="/visit" signupEnabled />)

      expect(screen.getByTestId("login-email-stage")).toBeTruthy()
      expect(screen.queryByTestId("login-signup-stage")).toBeNull()
    })
  })
})
