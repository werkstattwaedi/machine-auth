// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * VisitStartedDialog — kiosk confirmation after "Besuch starten":
 *   - shows the success copy with an auto-accepting "Fertig" button
 *   - onDone fires after 8 s (terminal hands itself to the next person)
 *   - clicking "Fertig" fires onDone immediately
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react"
import { VisitStartedDialog } from "./visit-started-dialog"

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("VisitStartedDialog", () => {
  it("renders nothing while closed", () => {
    render(<VisitStartedDialog open={false} onDone={() => {}} />)
    expect(screen.queryByText("Besuch gestartet")).toBeNull()
  })

  it("shows the dialog and auto-fires onDone after 8 s", () => {
    const onDone = vi.fn()
    render(<VisitStartedDialog open onDone={onDone} />)
    expect(screen.getByText("Besuch gestartet")).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(7_900)
    })
    expect(onDone).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(onDone).toHaveBeenCalledOnce()
  })

  it("fires onDone immediately on 'Fertig'", () => {
    const onDone = vi.fn()
    render(<VisitStartedDialog open onDone={onDone} />)
    fireEvent.click(screen.getByRole("button", { name: "Fertig" }))
    expect(onDone).toHaveBeenCalledOnce()
  })
})
