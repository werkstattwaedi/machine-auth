// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * KioskInactivityWatcher — only fires on kiosk sessions. After 5 min of
 * idle, opens a "Bist du noch da?" dialog with a 30 s auto-close. The
 * auto-close calls resetWizard (which navigates back to /checkin).
 * Activity events reset the idle countdown while the dialog is closed.
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
import { KioskInactivityWatcher } from "./kiosk-inactivity-watcher"

const mockUseWizardContext = vi.fn()
vi.mock("./wizard-context", () => ({
  useWizardContext: () => mockUseWizardContext(),
}))

afterEach(() => {
  cleanup()
  mockUseWizardContext.mockReset()
})

describe("KioskInactivityWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("renders nothing for non-kiosk sessions", () => {
    const resetWizard = vi.fn()
    mockUseWizardContext.mockReturnValue({ kiosk: false, resetWizard })
    const { container } = render(<KioskInactivityWatcher />)
    expect(container.textContent).toBe("")

    // 10 min of "idle" — must not fire resetWizard.
    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000)
    })
    expect(resetWizard).not.toHaveBeenCalled()
  })

  it("does not fire before the 5-minute idle threshold (kiosk)", () => {
    const resetWizard = vi.fn()
    mockUseWizardContext.mockReturnValue({ kiosk: true, resetWizard })
    render(<KioskInactivityWatcher />)

    // 4 min 30 s — dialog still hidden.
    act(() => {
      vi.advanceTimersByTime(4 * 60 * 1000 + 30 * 1000)
    })
    expect(screen.queryByText(/Bist du noch da/)).toBeNull()
    expect(resetWizard).not.toHaveBeenCalled()
  })

  it("opens the dialog after 5 minutes of idle (kiosk)", () => {
    const resetWizard = vi.fn()
    mockUseWizardContext.mockReturnValue({ kiosk: true, resetWizard })
    render(<KioskInactivityWatcher />)

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000)
    })
    expect(screen.getByText(/Bist du noch da/)).toBeTruthy()
    // Auto-close timer not yet fired.
    expect(resetWizard).not.toHaveBeenCalled()
  })

  it("calls resetWizard 30 s after the dialog opens (auto-close)", () => {
    const resetWizard = vi.fn()
    mockUseWizardContext.mockReturnValue({ kiosk: true, resetWizard })
    render(<KioskInactivityWatcher />)

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000)
    })
    expect(screen.getByText(/Bist du noch da/)).toBeTruthy()

    // 29 s into the popup — still up.
    act(() => {
      vi.advanceTimersByTime(29 * 1000)
    })
    expect(resetWizard).not.toHaveBeenCalled()

    // Cross the 30 s mark.
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(resetWizard).toHaveBeenCalledOnce()
  })
})
