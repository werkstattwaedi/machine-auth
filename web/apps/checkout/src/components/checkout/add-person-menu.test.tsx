// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Issue #605: "Person hinzufügen" offers the identified person's saved
 * persons in a menu (each removable after an inline confirmation) and
 * stays a plain button without any.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AddPersonMenu } from "./add-person-menu"
import type { SavedPersonEntry } from "./use-checkout-state"

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
  // Radix Tooltip positions its content with Floating UI.
  if (!("ResizeObserver" in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
  }
})

afterEach(cleanup)

const mia: SavedPersonEntry = { id: "s-mia", firstName: "Mia", lastName: "Muster", userType: "kind" }
const leo: SavedPersonEntry = { id: "s-leo", firstName: "Leo", lastName: "Muster", userType: "kind" }

function renderMenu(
  props: Partial<React.ComponentProps<typeof AddPersonMenu>> = {},
) {
  const handlers = {
    onAddNew: vi.fn(),
    onAddSaved: vi.fn(),
    onDeleteSaved: vi.fn().mockResolvedValue(undefined),
    onOpen: vi.fn(),
  }
  render(<AddPersonMenu savedPersons={[mia, leo]} {...handlers} {...props} />)
  return { ...handlers, ...props }
}

async function openMenu() {
  const user = userEvent.setup()
  await act(async () => {
    await user.click(screen.getByRole("button", { name: /Person hinzufügen/ }))
  })
  await screen.findByRole("menu")
  return user
}

describe("AddPersonMenu", () => {
  it("is a plain button without saved persons", async () => {
    const { onAddNew } = renderMenu({ savedPersons: [] })
    const user = userEvent.setup()
    await act(async () => {
      await user.click(screen.getByRole("button", { name: /Person hinzufügen/ }))
    })
    expect(screen.queryByRole("menu")).toBeNull()
    expect(onAddNew).toHaveBeenCalledTimes(1)
  })

  it("lists the saved persons, then a new person", async () => {
    const { onOpen } = renderMenu()
    await openMenu()
    expect(onOpen).toHaveBeenCalled()
    const items = screen.getAllByRole("menuitem").map((i) => i.textContent?.trim())
    expect(items[0]).toBe("Mia Muster")
    expect(items).toContain("Leo Muster")
    expect(items[items.length - 1]).toMatch(/Neue Person/)
  })

  it("adds a saved person", async () => {
    const { onAddSaved } = renderMenu()
    const user = await openMenu()
    await act(async () => {
      await user.click(screen.getByRole("menuitem", { name: "Leo Muster" }))
    })
    expect(onAddSaved).toHaveBeenCalledWith(leo)
  })

  it("adds a new person", async () => {
    const { onAddNew } = renderMenu()
    const user = await openMenu()
    await act(async () => {
      await user.click(screen.getByRole("menuitem", { name: /Neue Person/ }))
    })
    expect(onAddNew).toHaveBeenCalledTimes(1)
  })

  it("asks before removing, and Abbrechen keeps the person", async () => {
    const { onDeleteSaved } = renderMenu()
    const user = await openMenu()
    await act(async () => {
      await user.click(
        screen.getByRole("menuitem", { name: "Mia Muster nicht mehr vorschlagen" }),
      )
    })
    // The menu stays open with the confirmation inside it.
    expect(screen.getByRole("menu")).toBeTruthy()
    expect(screen.getByTestId("saved-person-confirm")).toBeTruthy()
    await act(async () => {
      await user.click(screen.getByRole("menuitem", { name: "Abbrechen" }))
    })
    expect(screen.queryByTestId("saved-person-confirm")).toBeNull()
    expect(onDeleteSaved).not.toHaveBeenCalled()
  })

  it("removes after the confirmation", async () => {
    const { onDeleteSaved } = renderMenu()
    const user = await openMenu()
    await act(async () => {
      await user.click(
        screen.getByRole("menuitem", { name: "Leo Muster nicht mehr vorschlagen" }),
      )
    })
    await act(async () => {
      await user.click(screen.getByRole("menuitem", { name: "Entfernen" }))
    })
    expect(onDeleteSaved).toHaveBeenCalledWith(leo)
    expect(screen.queryByTestId("saved-person-confirm")).toBeNull()
  })

  it("keeps the confirmation open when the delete failed", async () => {
    renderMenu({ onDeleteSaved: vi.fn().mockRejectedValue(new Error("boom")) })
    const user = await openMenu()
    await act(async () => {
      await user.click(
        screen.getByRole("menuitem", { name: "Mia Muster nicht mehr vorschlagen" }),
      )
    })
    await act(async () => {
      await user.click(screen.getByRole("menuitem", { name: "Entfernen" }))
    })
    expect(screen.getByTestId("saved-person-confirm")).toBeTruthy()
  })

  it("is disabled with a reason, shown as a tooltip (#779)", async () => {
    const { onAddNew } = renderMenu({ disabledReason: "Nicht jetzt." })
    const button = screen.getByRole("button", { name: /Person hinzufügen/ })
    expect(button).toBeDisabled()
    // No inline line under the button; screen readers still get the reason.
    expect(screen.queryByTestId("add-person-disabled-reason")).toBeNull()
    expect(screen.queryByRole("tooltip")).toBeNull()
    expect(button).toHaveAccessibleDescription("Nicht jetzt.")

    // A tap (touch / kiosk: no hover) opens the tooltip …
    const user = userEvent.setup()
    await act(async () => {
      await user.pointer({
        keys: "[TouchA]",
        target: screen.getByTestId("add-person-disabled"),
      })
    })
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Nicht jetzt.")

    // … and a tap elsewhere closes it.
    await act(async () => {
      await user.pointer({ keys: "[TouchA]", target: document.body })
    })
    expect(screen.queryByRole("tooltip")).toBeNull()
    expect(onAddNew).not.toHaveBeenCalled()
  })

  it("opens the reason tooltip on keyboard focus", async () => {
    renderMenu({ disabledReason: "Nicht jetzt." })
    const user = userEvent.setup()
    await act(async () => {
      await user.tab()
    })
    expect(screen.getByTestId("add-person-disabled")).toHaveFocus()
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Nicht jetzt.")
  })
})
