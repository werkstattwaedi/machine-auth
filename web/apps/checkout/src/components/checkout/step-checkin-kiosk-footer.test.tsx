// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * StepCheckin footer — kiosk redesign:
 *   - with onStartVisit (kiosk): "Besuch starten" is the filled primary,
 *     "Material erfassen" the outline secondary; no "Weiter"
 *   - without it (browser): the single "Weiter" stays
 *   - both kiosk actions run the same form validation path
 *   - issue #732: with autoStartMs the primary fills and fires on its own;
 *     any touch (pointerdown / keydown / scroll) or an opening dialog ends
 *     the countdown for good; the filling button is the only cue (no text)
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react"
import { StepCheckin } from "./step-checkin"
import type { CheckoutPerson } from "./use-checkout-state"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const tagPerson: CheckoutPerson = {
  id: "p1",
  firstName: "Max",
  lastName: "Muster",
  email: "max@example.com",
  userType: "erwachsen",
  termsAccepted: true,
  isPreFilled: true,
  userId: null,
}

function renderCheckin(opts: {
  onStartVisit?: () => Promise<void>
  onAdvance?: () => Promise<void>
  visitStarted?: boolean
  autoStartMs?: number
  onCountdownCancel?: () => void
}) {
  return render(
    <StepCheckin
      persons={[tagPerson]}
      personsDispatch={vi.fn()}
      isAnonymous={false}
      kiosk
      isAccountLoggedIn={false}
      signedInUserId={null}
      signedInEmail={null}
      isMember={false}
      onAdvance={opts.onAdvance}
      onStartVisit={opts.onStartVisit}
      visitStarted={opts.visitStarted}
      autoStartMs={opts.autoStartMs}
      onCountdownCancel={opts.onCountdownCancel}
    />,
  )
}

describe("StepCheckin kiosk footer", () => {
  it("renders 'Besuch starten' as primary and 'Material erfassen' as secondary", () => {
    renderCheckin({ onStartVisit: vi.fn().mockResolvedValue(undefined) })
    expect(
      screen.getByRole("button", { name: /Besuch starten/ }),
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: /Material erfassen/ }),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Weiter$/ })).toBeNull()
  })

  it("keeps the single 'Weiter' without onStartVisit (browser flow)", () => {
    renderCheckin({})
    expect(screen.getByRole("button", { name: /Weiter/ })).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: /Besuch starten/ }),
    ).toBeNull()
  })

  it("'Besuch starten' runs onStartVisit for a valid form", async () => {
    const onStartVisit = vi.fn().mockResolvedValue(undefined)
    renderCheckin({ onStartVisit })
    fireEvent.click(screen.getByRole("button", { name: /Besuch starten/ }))
    await waitFor(() => expect(onStartVisit).toHaveBeenCalledOnce())
  })

  it("'Material erfassen' runs onAdvance (the /visit path)", async () => {
    const onAdvance = vi.fn().mockResolvedValue(undefined)
    renderCheckin({
      onStartVisit: vi.fn().mockResolvedValue(undefined),
      onAdvance,
    })
    fireEvent.click(screen.getByRole("button", { name: /Material erfassen/ }))
    await waitFor(() => expect(onAdvance).toHaveBeenCalledOnce())
  })

  // Issue #465: once a checkout is already running the visit is started, so
  // "Besuch starten" must disappear and "Material erfassen" becomes the
  // primary action.
  it("drops 'Besuch starten' and keeps only 'Material erfassen' when a checkout is already open", () => {
    renderCheckin({
      onStartVisit: vi.fn().mockResolvedValue(undefined),
      onAdvance: vi.fn().mockResolvedValue(undefined),
      visitStarted: true,
    })
    expect(
      screen.getByRole("button", { name: /Material erfassen/ }),
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: /Besuch starten/ }),
    ).toBeNull()
    expect(screen.queryByRole("button", { name: /^Weiter$/ })).toBeNull()
  })

  it("shows 'Besuch starten' as primary when no checkout is open yet", () => {
    renderCheckin({
      onStartVisit: vi.fn().mockResolvedValue(undefined),
      onAdvance: vi.fn().mockResolvedValue(undefined),
      visitStarted: false,
    })
    expect(
      screen.getByRole("button", { name: /Besuch starten/ }),
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: /Material erfassen/ }),
    ).toBeTruthy()
  })

  it("'Material erfassen' runs onAdvance when a checkout is already open", async () => {
    const onAdvance = vi.fn().mockResolvedValue(undefined)
    renderCheckin({
      onStartVisit: vi.fn().mockResolvedValue(undefined),
      onAdvance,
      visitStarted: true,
    })
    fireEvent.click(screen.getByRole("button", { name: /Material erfassen/ }))
    await waitFor(() => expect(onAdvance).toHaveBeenCalledOnce())
  })

  describe("auto-start countdown (issue #732)", () => {
    it("fires onStartVisit after the countdown", async () => {
      vi.useFakeTimers()
      const onStartVisit = vi.fn().mockResolvedValue(undefined)
      renderCheckin({ onStartVisit, autoStartMs: 5_000 })
      expect(
        screen.getByTestId("checkin-start-visit").dataset.countdown,
      ).toBe("running")
      expect(screen.getByTestId("auto-start-progress")).toBeTruthy()
      await act(async () => {
        vi.advanceTimersByTime(4_999)
      })
      expect(onStartVisit).not.toHaveBeenCalled()
      await act(async () => {
        vi.advanceTimersByTime(1)
      })
      expect(onStartVisit).toHaveBeenCalledOnce()
    })

    it("renders no countdown text — the filling button is the only cue", () => {
      renderCheckin({
        onStartVisit: vi.fn().mockResolvedValue(undefined),
        autoStartMs: 5_000,
      })
      expect(screen.queryByText(/automatisch|startet in/i)).toBeNull()
    })

    it.each([
      ["pointerdown", () => fireEvent.pointerDown(document.body)],
      ["keydown", () => fireEvent.keyDown(document.body, { key: "a" })],
      ["scroll", () => fireEvent.scroll(window)],
    ])("a %s anywhere cancels it for good", async (_name, touch) => {
      vi.useFakeTimers()
      const onStartVisit = vi.fn().mockResolvedValue(undefined)
      const onCountdownCancel = vi.fn()
      renderCheckin({ onStartVisit, autoStartMs: 5_000, onCountdownCancel })
      await act(async () => {
        vi.advanceTimersByTime(1_000)
        touch()
      })
      expect(onCountdownCancel).toHaveBeenCalledOnce()
      expect(screen.queryByTestId("auto-start-progress")).toBeNull()
      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })
      expect(onStartVisit).not.toHaveBeenCalled()
      // "Besuch starten" stays the primary, without a timer.
      expect(screen.getByRole("button", { name: /Besuch starten/ })).toBeTruthy()
    })

    it("a dialog opening over the screen cancels it", async () => {
      vi.useFakeTimers()
      const onStartVisit = vi.fn().mockResolvedValue(undefined)
      const onCountdownCancel = vi.fn()
      renderCheckin({ onStartVisit, autoStartMs: 5_000, onCountdownCancel })
      const dialog = document.createElement("div")
      dialog.setAttribute("role", "alertdialog")
      await act(async () => {
        document.body.appendChild(dialog)
        // MutationObserver callbacks run as microtasks.
        await Promise.resolve()
      })
      try {
        expect(onCountdownCancel).toHaveBeenCalledOnce()
        await act(async () => {
          vi.advanceTimersByTime(10_000)
        })
        expect(onStartVisit).not.toHaveBeenCalled()
      } finally {
        dialog.remove()
      }
    })

    it("runs no countdown without autoStartMs", async () => {
      vi.useFakeTimers()
      const onStartVisit = vi.fn().mockResolvedValue(undefined)
      renderCheckin({ onStartVisit })
      expect(screen.queryByTestId("auto-start-progress")).toBeNull()
      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })
      expect(onStartVisit).not.toHaveBeenCalled()
    })

    it("runs no countdown once the visit is started", async () => {
      vi.useFakeTimers()
      const onStartVisit = vi.fn().mockResolvedValue(undefined)
      renderCheckin({ onStartVisit, autoStartMs: 5_000, visitStarted: true })
      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })
      expect(onStartVisit).not.toHaveBeenCalled()
    })
  })
})
