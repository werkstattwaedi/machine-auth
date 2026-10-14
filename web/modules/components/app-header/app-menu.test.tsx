// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ReactNode } from "react"
import { History, LogIn, RotateCcw, User } from "lucide-react"

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    search: _search,
    ...rest
  }: { to: string; children: ReactNode; search?: unknown } & Record<string, unknown>) => (
    <a href={to} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))

const { AppMenu } = await import("./app-menu")

// useIsMobile reads window.innerWidth and listens on matchMedia "change".
let mediaListeners: Array<() => void> = []
function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
}
function resize(width: number) {
  setViewport(width)
  act(() => mediaListeners.forEach((l) => l()))
}

beforeEach(() => {
  mediaListeners = []
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: (_: string, l: () => void) => mediaListeners.push(l),
    removeEventListener: (_: string, l: () => void) => {
      mediaListeners = mediaListeners.filter((x) => x !== l)
    },
  }))
  setViewport(1280)
})

afterEach(() => {
  cleanup()
  delete window.Marker
  delete window.__Marker
})

function installMarker() {
  const capture = vi.fn()
  window.__Marker = {}
  window.Marker = { capture }
  return capture
}

const identity = { name: "Mike Schneider", email: "mike@example.com", userId: "u1" }
const menuItems = [
  { to: "/account/profile", label: "Profil", icon: User },
  { to: "/account/usage", label: "Nutzungsverlauf", icon: History },
]
const navItems = [
  { to: "/account/usage", label: "Nutzungsverlauf", icon: History },
  { to: "/account/profile", label: "Profil", icon: User },
]

describe("AppMenu — desktop dropdown", () => {
  it("lists the menu items, Problem melden and Abmelden", async () => {
    const capture = installMarker()
    const onSignOut = vi.fn()
    render(
      <AppMenu
        identity={identity}
        menuItems={menuItems}
        navItems={navItems}
        onSignOut={onSignOut}
      />,
    )
    const user = userEvent.setup()
    const trigger = screen.getByRole("button", { name: "Konto-Menü" })
    expect(trigger).toHaveTextContent("Mike Schneider")
    await user.click(trigger)

    const menu = await screen.findByRole("menu")
    expect(menu).toHaveTextContent("mike@example.com")
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Profil",
      "Nutzungsverlauf",
      "Problem melden",
      "Abmelden",
    ])
    expect(screen.getByRole("menuitem", { name: "Profil" })).toHaveAttribute(
      "href",
      "/account/profile",
    )

    await user.click(screen.getByRole("menuitem", { name: "Problem melden" }))
    expect(capture).toHaveBeenCalledWith("fullscreen")

    await user.click(trigger)
    await user.click(await screen.findByRole("menuitem", { name: "Abmelden" }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it("hides Problem melden when the feedback widget is not loaded", async () => {
    render(<AppMenu identity={identity} onSignOut={vi.fn()} />)
    await userEvent.setup().click(screen.getByRole("button", { name: "Konto-Menü" }))
    await screen.findByRole("menu")
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Abmelden",
    ])
  })
})

describe("AppMenu — mobile sheet", () => {
  it("opens a sheet with identity, CTA, navigation and the utility entries", async () => {
    installMarker()
    setViewport(375)
    const onSignOut = vi.fn()
    render(
      <AppMenu
        identity={identity}
        menuItems={menuItems}
        navItems={navItems}
        headerAction={<a href="/">Neuer Besuch starten</a>}
        onSignOut={onSignOut}
      />,
    )
    const user = userEvent.setup()
    // The mobile trigger has no name text, only avatar + ☰.
    const trigger = screen.getByRole("button", { name: "Menü" })
    expect(trigger).not.toHaveTextContent("Mike Schneider")
    await user.click(trigger)

    const sheet = await screen.findByRole("dialog")
    expect(within(sheet).getByText("Mike Schneider")).toBeTruthy()
    expect(within(sheet).getByText("mike@example.com")).toBeTruthy()
    // Sidebar order (navItems), not the dropdown's (menuItems).
    const rows = Array.from(sheet.querySelectorAll("nav a, nav button")).map(
      (el) => el.textContent,
    )
    expect(rows).toEqual([
      "Neuer Besuch starten",
      "Nutzungsverlauf",
      "Profil",
      "Problem melden",
      "Abmelden",
    ])

    await user.click(within(sheet).getByRole("button", { name: "Abmelden" }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
    // Choosing an entry closes the sheet.
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("closes the sheet when a navigation entry is chosen", async () => {
    setViewport(375)
    render(<AppMenu identity={identity} navItems={navItems} onSignOut={vi.fn()} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "Menü" }))
    const sheet = await screen.findByRole("dialog")
    await user.click(within(sheet).getByRole("link", { name: "Profil" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("closes on a resize across the breakpoint instead of reopening as the other kind", async () => {
    setViewport(375)
    render(<AppMenu identity={identity} navItems={navItems} onSignOut={vi.fn()} />)
    await userEvent.setup().click(screen.getByRole("button", { name: "Menü" }))
    expect(await screen.findByRole("dialog")).toBeTruthy()

    resize(1280)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByRole("menu")).toBeNull()
    expect(screen.getByRole("button", { name: "Konto-Menü" })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
  })
})

describe("AppMenu — anonymous", () => {
  const startOver = { label: "Von vorne beginnen", icon: RotateCcw, onSelect: vi.fn() }

  it("renders nothing when there is nothing to offer", () => {
    const { container } = render(<AppMenu />)
    expect(container).toBeEmptyDOMElement()
  })

  it("offers Problem melden and the trailing entries behind a 'Menü' pill", async () => {
    installMarker()
    render(<AppMenu trailingItems={[startOver]} />)
    const trigger = screen.getByRole("button", { name: "Menü" })
    expect(trigger).toHaveTextContent("Menü")
    const user = userEvent.setup()
    await user.click(trigger)
    await screen.findByRole("menu")
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Problem melden",
      "Von vorne beginnen",
    ])
    await user.click(screen.getByRole("menuitem", { name: "Von vorne beginnen" }))
    expect(startOver.onSelect).toHaveBeenCalledTimes(1)
  })

  // The MarkerIO loader mounts after the outlet and installs its stub after
  // the menu's first commit; the trigger must still appear.
  it("appears once the feedback widget installs after the first render", async () => {
    render(<AppMenu />)
    expect(screen.queryByRole("button", { name: "Menü" })).toBeNull()
    installMarker()
    expect(await screen.findByRole("button", { name: "Menü" })).toBeTruthy()
  })

  it("shows only Problem melden without trailing entries", async () => {
    installMarker()
    render(<AppMenu />)
    await userEvent.setup().click(screen.getByRole("button", { name: "Menü" }))
    await screen.findByRole("menu")
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Problem melden",
    ])
  })

  it("uses an icon-only trigger and a titled sheet on mobile", async () => {
    installMarker()
    setViewport(375)
    render(<AppMenu trailingItems={[{ ...startOver, icon: LogIn }]} />)
    const trigger = screen.getByRole("button", { name: "Menü" })
    expect(trigger).not.toHaveTextContent("Menü")
    await userEvent.setup().click(trigger)
    const sheet = await screen.findByRole("dialog", { name: "Menü" })
    expect(within(sheet).getByRole("button", { name: "Problem melden" })).toBeTruthy()
    expect(within(sheet).getByRole("button", { name: "Von vorne beginnen" })).toBeTruthy()
  })
})
