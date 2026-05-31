// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Post-payment completion dialog.
 *
 * Behavioral contract:
 *   - "Neuer Besuch starten" is always present.
 *   - Logged-in users additionally see "Vergangene Besuche".
 *   - Kiosk + anonymous flows auto-close to a new visit after 30 s.
 *   - Logged-in users have no timeout (they're at their own laptop).
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
  it("renders only 'Neuer Besuch starten' for anonymous/kiosk users", () => {
    render(
      <CompletionDialog
        open
        isLoggedIn={false}
        autoClose
        onNewVisit={() => {}}
      />,
    )
    expect(
      screen.getByRole("button", { name: /Neuer Besuch starten/ }),
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: /Vergangene Besuche/ }),
    ).toBeNull()
  })

  it("offers both buttons for logged-in users", () => {
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

  describe("auto-close countdown", () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it("shows a countdown line when autoClose is true", () => {
      render(
        <CompletionDialog
          open
          isLoggedIn={false}
          autoClose
          onNewVisit={() => {}}
        />,
      )
      expect(screen.getByText(/30 Sekunden/)).toBeTruthy()
    })

    it("does not show the countdown when autoClose is false", () => {
      render(
        <CompletionDialog
          open
          isLoggedIn
          autoClose={false}
          onNewVisit={() => {}}
        />,
      )
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

      // Cross the 30 s mark — fired exactly once.
      act(() => {
        vi.advanceTimersByTime(1_000)
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
