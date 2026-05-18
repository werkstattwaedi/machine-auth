// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, within, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { NoMembership } from "./index"

afterEach(cleanup)

/**
 * Regression test for #261: the membership purchase page must show Marco's
 * approved wording — kicker labels, per-plan bullets, Statuten PDF link, and
 * the (Twint oder E-Banking) Self-Checkout note. These assertions pin every
 * phrase that came out of the marker.io ticket so accidental copy edits get
 * caught at the unit-test level (faster feedback than the screenshot tests).
 */
describe("NoMembership", () => {
  function renderIt() {
    const onPurchase = vi.fn()
    render(<NoMembership onPurchase={onPurchase} loading={false} />)
    return { onPurchase }
  }

  it("renders the kicker labels above each plan title", () => {
    renderIt()
    // "Für dich" / "Für deine Familie" are kicker eyebrows above the plan
    // titles ("Einzel-Mitgliedschaft" / "Familien-Mitgliedschaft"). The
    // CSS uppercases them, but the text in the DOM keeps the source casing.
    expect(screen.getByText("Für dich")).toBeInTheDocument()
    expect(screen.getByText(/Für deine\s+Familie/)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Einzel-Mitgliedschaft/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Familien-Mitgliedschaft/ }),
    ).toBeInTheDocument()
  })

  it("lists the bullets for the Einzel plan (2 bullets)", () => {
    renderIt()
    const einzel = screen.getByRole("button", {
      name: /Einzel-Mitgliedschaft/,
    })
    const items = within(einzel).getAllByRole("listitem")
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent("Vergünstigungen bei der Maschinennutzung")
    expect(items[1]).toHaveTextContent(
      "Ein Stimmrecht an der jährlichen Mitgliederversammlung",
    )
  })

  it("lists the bullets for the Familien plan (3 bullets incl. household)", () => {
    renderIt()
    const familie = screen.getByRole("button", {
      name: /Familien-Mitgliedschaft/,
    })
    const items = within(familie).getAllByRole("listitem")
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent("Vergünstigungen bei der Maschinennutzung")
    expect(items[1]).toHaveTextContent(
      "Ein Stimmrecht an der jährlichen Mitgliederversammlung",
    )
    expect(items[2]).toHaveTextContent(
      "Gültig für alle im selben Haushalt lebende Personen",
    )
  })

  it("shows CHF 50 / CHF 70 and the Zum Self-Checkout CTA on both cards", () => {
    renderIt()
    const einzel = screen.getByRole("button", {
      name: /Einzel-Mitgliedschaft/,
    })
    const familie = screen.getByRole("button", {
      name: /Familien-Mitgliedschaft/,
    })
    expect(within(einzel).getByText(/CHF\s*50/)).toBeInTheDocument()
    expect(within(familie).getByText(/CHF\s*70/)).toBeInTheDocument()
    expect(within(einzel).getByText(/Zum Self-Checkout/)).toBeInTheDocument()
    expect(within(familie).getByText(/Zum Self-Checkout/)).toBeInTheDocument()
  })

  it("links the Statuten PDF on the Squarespace CDN", () => {
    renderIt()
    const link = screen.getByTestId("membership-statuten-link")
    expect(link).toHaveAttribute(
      "href",
      "https://static1.squarespace.com/static/64671911eefe89405a1c141c/t/64c0d17d08167476c68a6a2d/1690358141557/230609+OWW+Statuten+aktualisiert.pdf",
    )
    // Opens in a new tab so the user doesn't lose checkout state.
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"))
  })

  it("renders the Self-Checkout payment note with Twint/E-Banking", () => {
    renderIt()
    expect(
      screen.getByText(
        /Die Mitgliedschaft wird über den Self-Checkout abgerechnet \(Twint oder E-Banking\)/,
      ),
    ).toBeInTheDocument()
  })

  it("invokes onPurchase with the correct plan when a card is clicked", async () => {
    const user = userEvent.setup()
    const { onPurchase } = renderIt()

    await user.click(
      screen.getByRole("button", { name: /Einzel-Mitgliedschaft/ }),
    )
    expect(onPurchase).toHaveBeenLastCalledWith("single", false)

    await user.click(
      screen.getByRole("button", { name: /Familien-Mitgliedschaft/ }),
    )
    expect(onPurchase).toHaveBeenLastCalledWith("family", false)
  })
})
