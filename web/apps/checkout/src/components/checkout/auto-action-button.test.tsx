// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * AutoActionButton — shared auto-accept dialog action:
 *   - fires onAction exactly once after durationMs
 *   - a click fires immediately and disarms the timer (no double fire)
 *   - the fill is a single CSS transition over the full duration (smooth),
 *     not the old per-tick percent repaint
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@modules/components/ui/alert-dialog"
import { AutoActionButton } from "./auto-action-button"

function renderButton(durationMs: number, onAction: () => void) {
  return render(
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogTitle>Test</AlertDialogTitle>
        <AlertDialogFooter>
          <AutoActionButton durationMs={durationMs} onAction={onAction}>
            Fertig
          </AutoActionButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>,
  )
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("AutoActionButton", () => {
  it("fires onAction once when the duration elapses", () => {
    const onAction = vi.fn()
    renderButton(8_000, onAction)

    act(() => {
      vi.advanceTimersByTime(7_900)
    })
    expect(onAction).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(onAction).toHaveBeenCalledOnce()

    // Long after — still exactly once.
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(onAction).toHaveBeenCalledOnce()
  })

  it("a click fires immediately and the later timer does not double-fire", () => {
    const onAction = vi.fn()
    renderButton(8_000, onAction)

    fireEvent.click(screen.getByRole("button", { name: "Fertig" }))
    expect(onAction).toHaveBeenCalledOnce()

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(onAction).toHaveBeenCalledOnce()
  })

  it("drives the fill as one full-duration CSS transition (smooth, no stepping)", () => {
    renderButton(8_000, () => {})
    const fill = screen.getByTestId("auto-action-progress") as HTMLElement

    // Before the arming frame the fill is empty…
    expect(fill.style.width).toBe("0%")
    // …and the transition is configured to span the whole duration linearly.
    expect(fill.style.transitionDuration).toBe("8000ms")
    expect(fill.style.transitionTimingFunction).toBe("linear")

    // After the double-rAF arming tick the TARGET width is 100% — the
    // browser compositor interpolates; there are no JS-driven width steps.
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(fill.style.width).toBe("100%")
  })
})
