// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * KioskInactivityWatcher — only fires on kiosk sessions *with state worth
 * preserving* (issue #378). After 5 min of idle it opens a "Bist du noch da?"
 * dialog with a 30 s auto-close. The auto-close calls resetWizard (which
 * navigates back to /checkin). Activity events reset the idle countdown while
 * the dialog is closed. A fresh /checkin?kiosk with an empty form and no
 * checkout must NOT arm the watcher.
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
import {
  KioskInactivityWatcher,
  hasPreservableState,
} from "./kiosk-inactivity-watcher"
import type { CheckoutPerson } from "./use-checkout-state"

const mockUseWizardContext = vi.fn()
vi.mock("./wizard-context", () => ({
  useWizardContext: () => mockUseWizardContext(),
}))

// A pristine empty Person 1 — what a fresh /checkin?kiosk seeds.
function emptyPerson(overrides: Partial<CheckoutPerson> = {}): CheckoutPerson {
  return {
    id: "p1",
    firstName: "",
    lastName: "",
    email: "",
    userType: "erwachsen",
    termsAccepted: false,
    isPreFilled: false,
    ...overrides,
  }
}

// A pristine pre-filled identity (logged-in / tag-tap seed) — populated but
// not typed by the user, so it must NOT count as dirty.
function preFilledPerson(
  overrides: Partial<CheckoutPerson> = {},
): CheckoutPerson {
  return {
    id: "u1",
    firstName: "Max",
    lastName: "Muster",
    email: "max@example.com",
    userType: "erwachsen",
    termsAccepted: true,
    isPreFilled: true,
    userId: "u1",
    ...overrides,
  }
}

// Default context: kiosk on, but no checkout and a single empty person —
// i.e. nothing to preserve, so the watcher should NOT arm.
function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    kiosk: true,
    resetWizard: vi.fn(),
    openCheckout: null,
    checkoutId: null,
    pendingCheckout: false,
    items: [],
    persons: [emptyPerson()],
    ...overrides,
  }
}

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
    mockUseWizardContext.mockReturnValue(
      baseContext({ kiosk: false, resetWizard }),
    )
    const { container } = render(<KioskInactivityWatcher />)
    expect(container.textContent).toBe("")

    // 10 min of "idle" — must not fire resetWizard.
    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000)
    })
    expect(resetWizard).not.toHaveBeenCalled()
  })

  it("does not arm when kiosk + no checkout + pristine empty form", () => {
    const resetWizard = vi.fn()
    mockUseWizardContext.mockReturnValue(baseContext({ resetWizard }))
    const { container } = render(<KioskInactivityWatcher />)
    expect(container.textContent).toBe("")

    // 10 min of idle — dialog must never show and resetWizard never fire.
    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000)
    })
    expect(screen.queryByText(/Bist du noch da/)).toBeNull()
    expect(resetWizard).not.toHaveBeenCalled()
  })

  it("does not arm for a single pristine pre-filled identity person", () => {
    const resetWizard = vi.fn()
    mockUseWizardContext.mockReturnValue(
      baseContext({ resetWizard, persons: [preFilledPerson()] }),
    )
    render(<KioskInactivityWatcher />)

    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000)
    })
    expect(screen.queryByText(/Bist du noch da/)).toBeNull()
    expect(resetWizard).not.toHaveBeenCalled()
  })

  it("does not fire before the 5-minute idle threshold (open checkout)", () => {
    const resetWizard = vi.fn()
    mockUseWizardContext.mockReturnValue(
      baseContext({ resetWizard, openCheckout: { id: "c1" } }),
    )
    render(<KioskInactivityWatcher />)

    // 4 min 30 s — dialog still hidden.
    act(() => {
      vi.advanceTimersByTime(4 * 60 * 1000 + 30 * 1000)
    })
    expect(screen.queryByText(/Bist du noch da/)).toBeNull()
    expect(resetWizard).not.toHaveBeenCalled()
  })

  it("arms when openCheckout exists (pristine persons)", () => {
    const resetWizard = vi.fn()
    mockUseWizardContext.mockReturnValue(
      baseContext({ resetWizard, openCheckout: { id: "c1" } }),
    )
    render(<KioskInactivityWatcher />)

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000)
    })
    expect(screen.getByText(/Bist du noch da/)).toBeTruthy()
    expect(resetWizard).not.toHaveBeenCalled()

    // Auto-close fires resetWizard 30 s later.
    act(() => {
      vi.advanceTimersByTime(30 * 1000)
    })
    expect(resetWizard).toHaveBeenCalledOnce()
  })

  it("arms when a person has a typed-in firstName (not pre-filled)", () => {
    const resetWizard = vi.fn()
    mockUseWizardContext.mockReturnValue(
      baseContext({
        resetWizard,
        persons: [emptyPerson({ firstName: "Anna" })],
      }),
    )
    render(<KioskInactivityWatcher />)

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000)
    })
    expect(screen.getByText(/Bist du noch da/)).toBeTruthy()
  })

  it("arms when a non-pre-filled person accepted terms", () => {
    const resetWizard = vi.fn()
    mockUseWizardContext.mockReturnValue(
      baseContext({
        resetWizard,
        persons: [emptyPerson({ termsAccepted: true })],
      }),
    )
    render(<KioskInactivityWatcher />)

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000)
    })
    expect(screen.getByText(/Bist du noch da/)).toBeTruthy()
  })

  it("arms when the cart has items", () => {
    const resetWizard = vi.fn()
    mockUseWizardContext.mockReturnValue(
      baseContext({ resetWizard, items: [{ id: "i1" }] }),
    )
    render(<KioskInactivityWatcher />)

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000)
    })
    expect(screen.getByText(/Bist du noch da/)).toBeTruthy()
  })

  it("arms when there is more than one person", () => {
    const resetWizard = vi.fn()
    mockUseWizardContext.mockReturnValue(
      baseContext({
        resetWizard,
        persons: [emptyPerson(), emptyPerson({ id: "p2" })],
      }),
    )
    render(<KioskInactivityWatcher />)

    act(() => {
      vi.advanceTimersByTime(5 * 60 * 1000)
    })
    expect(screen.getByText(/Bist du noch da/)).toBeTruthy()
  })

  it("calls resetWizard 30 s after the dialog opens (auto-close)", () => {
    const resetWizard = vi.fn()
    mockUseWizardContext.mockReturnValue(
      baseContext({ resetWizard, openCheckout: { id: "c1" } }),
    )
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

describe("hasPreservableState", () => {
  function args(overrides: Record<string, unknown> = {}) {
    return {
      openCheckout: null,
      checkoutId: null,
      pendingCheckout: false,
      items: [],
      persons: [emptyPerson()],
      ...overrides,
    } as Parameters<typeof hasPreservableState>[0]
  }

  it("is false for no checkout + single empty person + no items", () => {
    expect(hasPreservableState(args())).toBe(false)
  })

  it("is false for a single pristine pre-filled identity person", () => {
    expect(hasPreservableState(args({ persons: [preFilledPerson()] }))).toBe(
      false,
    )
  })

  it("is true when openCheckout is set", () => {
    expect(hasPreservableState(args({ openCheckout: { id: "c1" } }))).toBe(true)
  })

  it("is true when checkoutId is set", () => {
    expect(hasPreservableState(args({ checkoutId: "c1" }))).toBe(true)
  })

  it("is true when pendingCheckout is set", () => {
    expect(hasPreservableState(args({ pendingCheckout: true }))).toBe(true)
  })

  it("is true when there are items", () => {
    expect(hasPreservableState(args({ items: [{ id: "i1" }] }))).toBe(true)
  })

  it("is true when there is more than one person", () => {
    expect(
      hasPreservableState(
        args({ persons: [emptyPerson(), emptyPerson({ id: "p2" })] }),
      ),
    ).toBe(true)
  })

  it("is true when a non-pre-filled person has a typed firstName", () => {
    expect(
      hasPreservableState(args({ persons: [emptyPerson({ firstName: "A" })] })),
    ).toBe(true)
  })

  it("is true when a non-pre-filled person has a typed lastName", () => {
    expect(
      hasPreservableState(args({ persons: [emptyPerson({ lastName: "B" })] })),
    ).toBe(true)
  })

  it("is true when a non-pre-filled person has a typed email", () => {
    expect(
      hasPreservableState(
        args({ persons: [emptyPerson({ email: "a@b.c" })] }),
      ),
    ).toBe(true)
  })

  it("is true when a non-pre-filled person accepted terms", () => {
    expect(
      hasPreservableState(
        args({ persons: [emptyPerson({ termsAccepted: true })] }),
      ),
    ).toBe(true)
  })

  it("ignores whitespace-only typed fields", () => {
    expect(
      hasPreservableState(
        args({ persons: [emptyPerson({ firstName: "   " })] }),
      ),
    ).toBe(false)
  })

  it("does not count a pre-filled person's populated fields as dirty", () => {
    // Pre-filled identity with populated name/email + termsAccepted: true.
    expect(
      hasPreservableState(
        args({ persons: [preFilledPerson({ firstName: "Max" })] }),
      ),
    ).toBe(false)
  })
})
