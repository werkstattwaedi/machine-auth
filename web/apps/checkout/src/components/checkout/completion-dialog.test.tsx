// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Post-payment completion dialog.
 *
 * Behavioral contract:
 *   - Kiosk + anonymous flows show a single "Fertig" button (the person
 *     who just paid is leaving — they do NOT start a new visit), with a
 *     progress fill behind it that drains the 8 s auto-reset timer
 *     (AutoActionButton).
 *   - Logged-in users see "Neuer Besuch starten" (+ "Vergangene Besuche")
 *     and have no timeout (they're at their own laptop).
 *
 * Issue #419: the kiosk copy used to say "Neuer Besuch starten" /
 * "Neuer Besuch startet automatisch in N Sekunden…", which confused the
 * leaving person at a shared terminal.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CompletionDialog } from "./completion-dialog"

afterEach(cleanup)

describe("CompletionDialog", () => {
  it("kiosk/anonymous shows only 'Fertig', never the 'Neuer Besuch' wording", () => {
    render(
      <CompletionDialog
        open
        isLoggedIn={false}
        autoClose
        onNewVisit={() => {}}
      />,
    )
    expect(screen.getByRole("button", { name: /Fertig/ })).toBeTruthy()
    // The confusing "new visit" framing must be gone on the kiosk path.
    expect(
      screen.queryByRole("button", { name: /Neuer Besuch/ }),
    ).toBeNull()
    expect(
      screen.queryByRole("button", { name: /Vergangene Besuche/ }),
    ).toBeNull()
    // Body copy is the short "bis bald", not the new-visit prompt.
    expect(screen.getByText("Vielen Dank und bis bald.")).toBeTruthy()
  })

  it("offers both buttons with the new-visit wording for logged-in users", () => {
    render(
      <CompletionDialog
        open
        isLoggedIn
        autoClose={false}
        onNewVisit={() => {}}
        onGoToHistory={() => {}}
      />,
    )
    expect(
      screen.getByRole("button", { name: /Neuer Besuch starten/ }),
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: /Vergangene Besuche/ }),
    ).toBeTruthy()
    // Logged-in path keeps the original "Fertig"-free wording.
    expect(screen.queryByText(/bis bald/)).toBeNull()
  })

  it("calls onNewVisit when the kiosk 'Fertig' button is clicked", async () => {
    const onNewVisit = vi.fn()
    const user = userEvent.setup()
    render(
      <CompletionDialog
        open
        isLoggedIn={false}
        autoClose
        onNewVisit={onNewVisit}
      />,
    )
    await user.click(screen.getByRole("button", { name: /Fertig/ }))
    expect(onNewVisit).toHaveBeenCalledOnce()
  })

  it("calls onNewVisit when 'Neuer Besuch starten' is clicked", async () => {
    const onNewVisit = vi.fn()
    const user = userEvent.setup()
    render(
      <CompletionDialog
        open
        isLoggedIn={false}
        autoClose={false}
        onNewVisit={onNewVisit}
      />,
    )
    await user.click(
      screen.getByRole("button", { name: /Neuer Besuch starten/ }),
    )
    expect(onNewVisit).toHaveBeenCalledOnce()
  })

  it("calls onGoToHistory when 'Vergangene Besuche' is clicked", async () => {
    const onGoToHistory = vi.fn()
    const user = userEvent.setup()
    render(
      <CompletionDialog
        open
        isLoggedIn
        autoClose={false}
        onNewVisit={() => {}}
        onGoToHistory={onGoToHistory}
      />,
    )
    await user.click(
      screen.getByRole("button", { name: /Vergangene Besuche/ }),
    )
    expect(onGoToHistory).toHaveBeenCalledOnce()
  })

  describe("auto-reset progress", () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it("renders the auto-fill on the kiosk button spanning the 8 s window", () => {
      render(
        <CompletionDialog
          open
          isLoggedIn={false}
          autoClose
          onNewVisit={() => {}}
        />,
      )
      const fill = screen.getByTestId(
        "auto-action-progress",
      ) as HTMLElement
      // One CSS transition over the full duration — the smoothness contract.
      expect(fill.style.transitionDuration).toBe("8000ms")
    })

    it("does not render a progress fill when autoClose is false", () => {
      render(
        <CompletionDialog
          open
          isLoggedIn
          autoClose={false}
          onNewVisit={() => {}}
        />,
      )
      expect(screen.queryByTestId("auto-action-progress")).toBeNull()
      // And never the old countdown text either.
      expect(screen.queryByText(/Sekunden/)).toBeNull()
    })

    it("fires onNewVisit once after 8 seconds", () => {
      const onNewVisit = vi.fn()
      render(
        <CompletionDialog
          open
          isLoggedIn={false}
          autoClose
          onNewVisit={onNewVisit}
        />,
      )

      // Just short of the 8 s mark — not fired yet.
      act(() => {
        vi.advanceTimersByTime(7_900)
      })
      expect(onNewVisit).not.toHaveBeenCalled()

      // Cross the 8 s mark — fired exactly once.
      act(() => {
        vi.advanceTimersByTime(100)
      })
      expect(onNewVisit).toHaveBeenCalledOnce()
    })

    it("never fires onNewVisit when autoClose is false", () => {
      const onNewVisit = vi.fn()
      render(
        <CompletionDialog
          open
          isLoggedIn
          autoClose={false}
          onNewVisit={onNewVisit}
        />,
      )
      act(() => {
        vi.advanceTimersByTime(60_000)
      })
      expect(onNewVisit).not.toHaveBeenCalled()
    })
  })
})
