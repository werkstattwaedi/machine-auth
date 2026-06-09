// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Post-payment completion dialog.
 *
 * Behavioral contract:
 *   - Kiosk + anonymous flows show a single "Fertig" button (the person
 *     who just paid is leaving — they do NOT start a new visit), with a
 *     progress fill behind it that drains the 30 s auto-reset timer.
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

    function progressWidth() {
      const fill = screen.getByTestId("completion-autoreset-progress")
      return (fill as HTMLElement).style.width
    }

    it("renders a progress fill on the kiosk button that grows over time", () => {
      render(
        <CompletionDialog
          open
          isLoggedIn={false}
          autoClose
          onNewVisit={() => {}}
        />,
      )
      // Starts empty.
      expect(progressWidth()).toBe("0%")

      // Halfway through the 30 s window the fill is ~50%.
      act(() => {
        vi.advanceTimersByTime(15_000)
      })
      expect(progressWidth()).toBe("50%")
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
      expect(
        screen.queryByTestId("completion-autoreset-progress"),
      ).toBeNull()
      // And never the old countdown text either.
      expect(screen.queryByText(/Sekunden/)).toBeNull()
    })

    it("fires onNewVisit once after 30 seconds", () => {
      const onNewVisit = vi.fn()
      render(
        <CompletionDialog
          open
          isLoggedIn={false}
          autoClose
          onNewVisit={onNewVisit}
        />,
      )

      // Advance 29 s — not fired yet.
      act(() => {
        vi.advanceTimersByTime(29_000)
      })
      expect(onNewVisit).not.toHaveBeenCalled()

      // Cross the 30 s mark — fired exactly once, fill is full.
      act(() => {
        vi.advanceTimersByTime(1_000)
      })
      expect(onNewVisit).toHaveBeenCalledOnce()
      expect(progressWidth()).toBe("100%")
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
