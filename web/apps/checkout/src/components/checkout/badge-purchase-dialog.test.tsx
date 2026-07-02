// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * BadgePurchaseDialog — the dry-run quote drives the price line (single
 * source of eligibility, server-side), confirm issues the real call and
 * closes, server rejections render inline and keep the dialog open.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@modules/lib/firebase-context", () => ({
  useFunctions: () => ({}),
}))

const addBadge = vi.fn()
vi.mock("@modules/lib/rpc", () => ({
  rpcCallable: () => addBadge,
}))

// useAsyncMutation pulls in sonner + telemetry; a thin pass-through fake
// preserves the ADR-0025 contract the component relies on (re-throw on
// failure, error state for inline rendering).
vi.mock("@modules/hooks/use-async-mutation", () => ({
  useAsyncMutation: () => ({
    mutate: async (fn: () => Promise<unknown>) => {
      try {
        return await fn()
      } catch (err) {
        mutationError.error = {
          code: "failed-precondition",
          message: "Badge konnte nicht hinzugefügt werden.",
          originalError: err,
        }
        throw err
      }
    },
    loading: false,
    get error() {
      return mutationError.error
    },
    reset: () => {
      mutationError.error = null
    },
  }),
}))

const mutationError: { error: unknown } = { error: null }

import { BadgePurchaseDialog } from "./badge-purchase-dialog"

const OFFER = { tokenId: "04c339aa1e1890", badgeVoucher: "voucher-1" }

describe("BadgePurchaseDialog", () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    mutationError.error = null
  })

  it("shows the gratis quote from the dry run", async () => {
    addBadge.mockResolvedValue({
      data: { checkoutId: null, tokenId: OFFER.tokenId, unitPrice: 0, free: true },
    })
    render(<BadgePurchaseDialog offer={OFFER} onClose={() => {}} />)

    expect(
      await screen.findByText(/Gratis \(erster Badge\)/)
    ).toBeInTheDocument()
    expect(addBadge).toHaveBeenCalledWith({
      badgeVoucher: "voucher-1",
      dryRun: true,
    })
  })

  it("shows the CHF price for a non-free badge", async () => {
    addBadge.mockResolvedValue({
      data: { checkoutId: null, tokenId: OFFER.tokenId, unitPrice: 5, free: false },
    })
    render(<BadgePurchaseDialog offer={OFFER} onClose={() => {}} />)

    expect(await screen.findByText(/CHF\s*5/)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Badge kaufen" })
    ).toBeInTheDocument()
  })

  it("confirm issues the real call (no dryRun) and closes", async () => {
    addBadge.mockResolvedValue({
      data: { checkoutId: "co1", tokenId: OFFER.tokenId, unitPrice: 0, free: true },
    })
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<BadgePurchaseDialog offer={OFFER} onClose={onClose} />)

    await screen.findByText(/Gratis/)
    await user.click(screen.getByTestId("badge-purchase-confirm"))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(addBadge).toHaveBeenLastCalledWith({ badgeVoucher: "voucher-1" })
  })

  it("renders the server rejection inline (dry run failed) and disables confirm", async () => {
    addBadge.mockRejectedValue(new Error("Badge ist bereits registriert."))
    render(<BadgePurchaseDialog offer={OFFER} onClose={() => {}} />)

    expect(
      await screen.findByText("Badge ist bereits registriert.")
    ).toBeInTheDocument()
    expect(screen.getByTestId("badge-purchase-confirm")).toBeDisabled()
  })

  it("stays closed without an offer", () => {
    render(<BadgePurchaseDialog offer={null} onClose={() => {}} />)
    expect(screen.queryByTestId("badge-purchase-dialog")).toBeNull()
    expect(addBadge).not.toHaveBeenCalled()
  })
})
