// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AccountMenu } from "./account-menu"

const mockNavigate = vi.fn()
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string
    children: React.ReactNode
  } & React.ComponentProps<"a">) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

const mockEnsureElevated = vi.fn()
vi.mock("@/components/checkout/kiosk-elevation-dialog", () => ({
  useKioskElevation: () => ({ ensureElevated: mockEnsureElevated }),
}))

const mockStartOver = vi.fn(async () => {})
vi.mock("@/components/checkout/wizard-context", () => ({
  useWizardContext: () => ({ startOver: mockStartOver }),
}))

// Radix DropdownMenu in jsdom: the trigger opens on pointerdown and the
// content positions via Popper, which needs these stand-ins.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
})

afterEach(() => {
  cleanup()
  mockNavigate.mockReset()
  mockEnsureElevated.mockReset()
  mockStartOver.mockClear()
})

async function openMenu() {
  const user = userEvent.setup()
  const trigger = screen.getByRole("button", { name: "Konto-Menü" })
  await user.click(trigger)
  await screen.findByRole("menu")
  return { user, trigger }
}

describe("AccountMenu", () => {
  it("renders a labelled menu trigger with name, initials and chevron", () => {
    render(<AccountMenu name="Mike Schneider" email="mike@example.com" userId="u1" />)
    const trigger = screen.getByRole("button", { name: "Konto-Menü" })
    expect(trigger).toHaveAttribute("aria-haspopup", "menu")
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(trigger).toHaveTextContent("Mike Schneider")
    expect(screen.getByRole("img", { name: "Mike Schneider" })).toHaveTextContent("MS")
  })

  it("opens a menu with the account header and the named destinations", async () => {
    render(<AccountMenu name="Mike Schneider" email="mike@example.com" userId="u1" />)
    const { trigger } = await openMenu()
    expect(trigger).toHaveAttribute("aria-expanded", "true")

    const menu = screen.getByRole("menu")
    expect(menu).toHaveTextContent("Mike Schneider")
    expect(menu).toHaveTextContent("mike@example.com")

    const items = screen.getAllByRole("menuitem").map((el) => el.textContent)
    expect(items).toEqual([
      "Profil",
      "Nutzungsverlauf",
      "Mitgliedschaft",
      "Abmelden",
    ])
  })

  it("links each destination to its account route for a real session", async () => {
    render(<AccountMenu name="Mike Schneider" email="mike@example.com" userId="u1" />)
    await openMenu()
    expect(screen.getByRole("menuitem", { name: "Profil" })).toHaveAttribute(
      "href",
      "/account/profile",
    )
    expect(
      screen.getByRole("menuitem", { name: "Nutzungsverlauf" }),
    ).toHaveAttribute("href", "/account/usage")
    expect(
      screen.getByRole("menuitem", { name: "Mitgliedschaft" }),
    ).toHaveAttribute("href", "/account/membership")
    expect(mockEnsureElevated).not.toHaveBeenCalled()
  })

  it("omits the e-mail line when none is known", async () => {
    render(<AccountMenu name="Mike Schneider" email={null} userId="u1" />)
    await openMenu()
    expect(screen.getByRole("menu")).not.toHaveTextContent("@")
  })

  it("steps up a kiosk session before navigating", async () => {
    render(
      <AccountMenu name="Mike Schneider" email={null} userId="u1" kioskSession />,
    )
    const { user } = await openMenu()
    const item = screen.getByRole("menuitem", { name: "Mitgliedschaft" })
    expect(item).not.toHaveAttribute("href")
    await user.click(item)

    expect(mockNavigate).not.toHaveBeenCalled()
    expect(mockEnsureElevated).toHaveBeenCalledTimes(1)
    // The queued navigation runs once the step-up resolves.
    const next = mockEnsureElevated.mock.calls[0][0] as () => void
    next()
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/account/membership" })
  })

  it("signs out a kiosk session directly, without stepping up", async () => {
    render(
      <AccountMenu name="Mike Schneider" email={null} userId="u1" kioskSession />,
    )
    const { user } = await openMenu()
    await user.click(screen.getByRole("menuitem", { name: "Abmelden" }))
    expect(mockStartOver).toHaveBeenCalledTimes(1)
    expect(mockEnsureElevated).not.toHaveBeenCalled()
  })

  it("signs out through the wizard's startOver", async () => {
    render(<AccountMenu name="Mike Schneider" email="mike@example.com" userId="u1" />)
    const { user } = await openMenu()
    await user.click(screen.getByRole("menuitem", { name: "Abmelden" }))
    expect(mockStartOver).toHaveBeenCalledTimes(1)
  })
})
