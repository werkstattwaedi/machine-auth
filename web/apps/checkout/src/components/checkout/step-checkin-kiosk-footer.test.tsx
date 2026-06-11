// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * StepCheckin footer — kiosk redesign:
 *   - with onStartVisit (kiosk): "Besuch starten" is the filled primary,
 *     "Material erfassen" the outline secondary; no "Weiter"
 *   - without it (browser): the single "Weiter" stays
 *   - both kiosk actions run the same form validation path
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { StepCheckin } from "./step-checkin"
import type { CheckoutPerson } from "./use-checkout-state"

afterEach(cleanup)

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
      onSignOut={vi.fn()}
      onAdvance={opts.onAdvance}
      onStartVisit={opts.onStartVisit}
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
})
