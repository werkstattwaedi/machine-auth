// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * StaleCheckoutBanner — renders only when the user's open checkout
 * predates today's 3 AM Europe/Zurich session-day rollover, and
 * surfaces the stale doc's `created` date (de-CH format).
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { Timestamp } from "firebase/firestore"
import { StaleCheckoutBanner } from "./stale-checkout-banner"

const mockUseWizardContext = vi.fn()
vi.mock("./wizard-context", () => ({
  useWizardContext: () => mockUseWizardContext(),
}))

afterEach(() => {
  cleanup()
  mockUseWizardContext.mockReset()
})

function withCreated(date: Date | null) {
  const openCheckout = date
    ? { created: Timestamp.fromDate(date) }
    : null
  mockUseWizardContext.mockReturnValue({ openCheckout })
}

describe("StaleCheckoutBanner", () => {
  it("renders nothing when there is no open checkout", () => {
    withCreated(null)
    const { container } = render(<StaleCheckoutBanner />)
    expect(container.textContent).toBe("")
  })

  it("renders nothing for a checkout from today", () => {
    // Pin the wall clock: with a real clock, "2 h ago" crosses the 03:00
    // Europe/Zurich session-day rollover whenever the suite runs between
    // 03:00 and 05:00 local — the banner then correctly renders and this
    // assertion goes red (seen in CI at 02:39 UTC and locally at 04:40).
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2026-05-15T12:00:00Z"))
      const created = new Date(Date.now() - 2 * 60 * 60 * 1000)
      withCreated(created)
      const { container } = render(<StaleCheckoutBanner />)
      expect(container.textContent).toBe("")
    } finally {
      vi.useRealTimers()
    }
  })

  it("renders the banner for a checkout from a week ago", () => {
    const created = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    withCreated(created)
    render(<StaleCheckoutBanner />)
    expect(
      screen.getByText(/Offener Besuch vom/),
    ).toBeTruthy()
    // Description nudges the user to finish before unlocking machines.
    expect(
      screen.getByText(/zuerst ab/),
    ).toBeTruthy()
  })

  it("formats the date as de-CH dd.mm.yyyy", () => {
    // Pick a fixed date well in the past so it's unambiguously stale.
    const created = new Date(Date.UTC(2026, 4, 8, 12, 0, 0)) // 2026-05-08
    withCreated(created)
    render(<StaleCheckoutBanner />)
    // de-CH = dd.mm.yyyy.
    expect(screen.getByText(/Offener Besuch vom 08\.05\.2026/)).toBeTruthy()
  })
})
