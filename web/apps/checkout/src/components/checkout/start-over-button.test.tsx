// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * StartOverButton — the anon "Von vorne beginnen" escape hatch. Self-gates on
 * `isAnonymous && openCheckout`, confirms before discarding, and calls the
 * shared `startOver` primitive (drop session + hard reload). Lives in the
 * wizard chrome so it's reachable on steps 1–3.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { StartOverButton } from "./start-over-button"

const mockUseWizardContext = vi.fn()
vi.mock("./wizard-context", () => ({
  useWizardContext: () => mockUseWizardContext(),
}))

afterEach(() => {
  cleanup()
  mockUseWizardContext.mockReset()
})

function setCtx(over: Record<string, unknown> = {}) {
  const startOver = vi.fn()
  mockUseWizardContext.mockReturnValue({
    isAnonymous: true,
    openCheckout: { id: "co1" },
    startOver,
    ...over,
  })
  return startOver
}

const button = () =>
  screen.queryByRole("button", { name: /Von vorne beginnen/ })

describe("StartOverButton — gating", () => {
  it("renders nothing for a non-anonymous session", () => {
    setCtx({ isAnonymous: false })
    render(<StartOverButton />)
    expect(button()).toBeNull()
  })

  it("renders nothing when there is no open checkout", () => {
    setCtx({ openCheckout: null })
    render(<StartOverButton />)
    expect(button()).toBeNull()
  })

  it("renders for an anonymous session with an open checkout", () => {
    setCtx()
    render(<StartOverButton />)
    expect(button()).toBeTruthy()
  })
})

describe("StartOverButton — confirm flow", () => {
  it("confirming 'Verwerfen' calls startOver", () => {
    const startOver = setCtx()
    render(<StartOverButton />)
    fireEvent.click(button()!)
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }))
    expect(startOver).toHaveBeenCalledTimes(1)
  })

  it("'Abbrechen' dismisses without calling startOver", () => {
    const startOver = setCtx()
    render(<StartOverButton />)
    fireEvent.click(button()!)
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }))
    expect(startOver).not.toHaveBeenCalled()
  })
})
