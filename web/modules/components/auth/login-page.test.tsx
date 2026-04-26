// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

const navigateMock = vi.fn()

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}))

vi.mock("@modules/lib/auth", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    requestLoginEmail: vi.fn(),
    verifyLoginCode: vi.fn(),
    signInWithGoogle: vi.fn(),
    pendingGoogleLink: false,
  }),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const { LoginPage } = await import("./login-page")

describe("LoginPage", () => {
  beforeEach(() => {
    navigateMock.mockClear()
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it("hides the sign-up link when signupEnabled is false", () => {
    render(<LoginPage defaultRedirect="/users" />)

    expect(screen.queryByText("Konto erstellen")).toBeNull()
  })

  it("shows the sign-up link when signupEnabled is true", () => {
    render(<LoginPage defaultRedirect="/visit" signupEnabled />)

    expect(screen.getByText("Konto erstellen")).toBeTruthy()
  })

  it("renders the subtitle when provided", () => {
    render(<LoginPage defaultRedirect="/users" subtitle="Administration" />)

    expect(screen.getByText("Administration")).toBeTruthy()
  })

  it("places the Google button before the email form when googleButtonPosition='top'", () => {
    render(
      <LoginPage
        defaultRedirect="/users"
        googleButtonPosition="top"
      />,
    )

    const googleBtn = screen.getByText("Mit Google anmelden")
    const emailForm = screen.getByTestId("login-email-stage")
    expect(googleBtn.compareDocumentPosition(emailForm)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it("places the Google button after the email form when googleButtonPosition='bottom'", () => {
    render(
      <LoginPage
        defaultRedirect="/visit"
        signupEnabled
        googleButtonPosition="bottom"
      />,
    )

    const googleBtn = screen.getByText("Mit Google anmelden")
    const emailForm = screen.getByTestId("login-email-stage")
    expect(emailForm.compareDocumentPosition(googleBtn)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it("uses 'Konto erstellen' heading when mode=signup and signup is enabled", () => {
    render(
      <LoginPage
        defaultRedirect="/visit"
        signupEnabled
        mode="signup"
      />,
    )

    // Heading shows "Konto erstellen"; the alternative-link reads "Anmelden"
    // (offering to switch back to login). Just verify both appear in signup mode.
    expect(screen.getAllByText("Konto erstellen").length).toBeGreaterThan(0)
    expect(screen.getByText("Bereits registriert?")).toBeTruthy()
  })
})
