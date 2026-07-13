// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * BadgeOfferCoordinator — offer lifecycle around the wizard's
 * `unregisteredBadge` (issue #515):
 *   - identified session: an unregistered badge opens the purchase offer
 *   - re-tap of the SAME badge while its offer is open (fresh voucher —
 *     each physical tap mints a new one) does NOT re-offer: the open
 *     dialog keeps the first voucher, so its quote effect doesn't re-fire
 *   - a DIFFERENT badge while the offer is open replaces it (newest wins)
 *   - after dismissing, a re-tap (fresh voucher) offers again
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { UnregisteredBadge } from "@modules/lib/token-auth"

// Mutable wizard-context stand-in; tests mutate + rerender.
const mockWizard: {
  unregisteredBadge: UnregisteredBadge | null
  isAnonymous: boolean
} = {
  unregisteredBadge: null,
  isAnonymous: false,
}
vi.mock("./wizard-context", () => ({
  useWizardContext: () => mockWizard,
}))

// The purchase dialog pulls in the full Firebase/mutation stack (covered by
// its own tests); stub it with a marker that records the offer and mirrors
// the real dialog's voucher-keyed dry-run quote effect, so tests can assert
// that a same-badge re-tap does not re-fire the quote (issue #515).
const { quoteEffectVouchers } = vi.hoisted(() => ({
  quoteEffectVouchers: [] as string[],
}))
vi.mock("./badge-purchase-dialog", async () => {
  const { useEffect } = await import("react")
  return {
    BadgePurchaseDialog: ({
      offer,
      onClose,
    }: {
      offer: { tokenId: string; badgeVoucher: string } | null
      onClose: () => void
    }) => {
      const voucher = offer?.badgeVoucher ?? null
      useEffect(() => {
        if (voucher) quoteEffectVouchers.push(voucher)
      }, [voucher])
      return offer ? (
        <div data-testid="badge-purchase-stub">
          {offer.tokenId}:{offer.badgeVoucher}
          <button data-testid="badge-purchase-stub-close" onClick={onClose}>
            close
          </button>
        </div>
      ) : null
    },
  }
})

import { BadgeOfferCoordinator } from "./badge-offer-coordinator"
import { clearPendingBadge } from "./pending-badge-store"

afterEach(() => {
  cleanup()
  clearPendingBadge()
  quoteEffectVouchers.length = 0
  mockWizard.unregisteredBadge = null
  mockWizard.isAnonymous = false
})

describe("BadgeOfferCoordinator", () => {
  it("re-tap of the same badge (fresh voucher) while its offer is open does not re-offer", () => {
    mockWizard.unregisteredBadge = { tokenId: "04aa", badgeVoucher: "v1" }
    const { rerender } = render(<BadgeOfferCoordinator />)
    expect(screen.getByTestId("badge-purchase-stub").textContent).toContain(
      "04aa:v1",
    )
    expect(quoteEffectVouchers).toEqual(["v1"])

    // Same badge tapped again: the SDM counter advanced, so the wizard
    // surfaces a NEW voucher for the SAME tokenId.
    mockWizard.unregisteredBadge = { tokenId: "04aa", badgeVoucher: "v2" }
    rerender(<BadgeOfferCoordinator />)
    // The open offer keeps the first voucher — no quote re-fetch, no reset.
    expect(screen.getByTestId("badge-purchase-stub").textContent).toContain(
      "04aa:v1",
    )
    expect(quoteEffectVouchers).toEqual(["v1"])
  })

  it("a different badge while the offer is open replaces it (newest badge wins)", () => {
    mockWizard.unregisteredBadge = { tokenId: "04aa", badgeVoucher: "v1" }
    const { rerender } = render(<BadgeOfferCoordinator />)
    expect(screen.getByTestId("badge-purchase-stub").textContent).toContain(
      "04aa:v1",
    )

    mockWizard.unregisteredBadge = { tokenId: "04bb", badgeVoucher: "v3" }
    rerender(<BadgeOfferCoordinator />)
    expect(screen.getByTestId("badge-purchase-stub").textContent).toContain(
      "04bb:v3",
    )
    expect(quoteEffectVouchers).toEqual(["v1", "v3"])
  })

  it("after dismissing the offer, a re-tap of the same badge offers again", () => {
    mockWizard.unregisteredBadge = { tokenId: "04aa", badgeVoucher: "v1" }
    const { rerender } = render(<BadgeOfferCoordinator />)
    fireEvent.click(screen.getByTestId("badge-purchase-stub-close"))
    expect(screen.queryByTestId("badge-purchase-stub")).toBeNull()

    // The same-token guard must only suppress re-offers while the offer is
    // OPEN — a deliberate re-tap after Abbrechen reopens it.
    mockWizard.unregisteredBadge = { tokenId: "04aa", badgeVoucher: "v2" }
    rerender(<BadgeOfferCoordinator />)
    expect(screen.getByTestId("badge-purchase-stub").textContent).toContain(
      "04aa:v2",
    )
  })
})
