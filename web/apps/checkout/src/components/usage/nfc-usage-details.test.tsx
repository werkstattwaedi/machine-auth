// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The per-session breakdown of an NFC machine row (issue #648). At the kiosk
 * a badge tap signs in as a synthetic `tag:` principal with no account
 * profile, so the breakdown must key its `usage_machine` query on the
 * person the visit is identified as — not on the signed-in account.
 */

import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"

import { NfcMachineItemRow, type CheckoutItemLocal } from "./inline-rows"

vi.mock("@modules/lib/firebase-context", () => ({ useDb: () => ({}) }))
vi.mock("@modules/lib/firestore-helpers", () => ({
  checkoutItemRef: (_db: unknown, checkoutId: string, itemId: string) => ({
    path: `checkouts/${checkoutId}/items/${itemId}`,
  }),
  machinesCollection: () => ({ path: "machine" }),
  usageMachineCollection: () => ({ path: "usage_machine" }),
  userRef: (_db: unknown, id: string) => ({ id, path: `users/${id}` }),
}))
vi.mock("firebase/firestore", () => ({
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
}))

// A badge (tag) session: no account profile behind the signed-in principal.
vi.mock("@modules/lib/auth", () => ({
  useAuth: () => ({ user: { uid: "tag:04aabbcc" }, userDoc: null }),
}))

const SESSION_START = new Date(2026, 8, 19, 14, 2)

type Constraint = { field: string; op: string; value: unknown }
const usageQueries: Constraint[][] = []

vi.mock("@modules/lib/firestore", () => ({
  useCollection: (
    ref: { path: string } | null,
    ...constraints: Constraint[]
  ) => {
    if (ref?.path === "machine") {
      return { data: [{ id: "laser", name: "Laser Cutter" }], loading: false }
    }
    if (ref?.path !== "usage_machine") return { data: [], loading: false }
    usageQueries.push(constraints)
    const owner = constraints.find((c) => c.field === "userId")?.value as
      | { id: string }
      | undefined
    return {
      data:
        owner?.id === "badge-user"
          ? [
              {
                id: "u1",
                machine: { id: "laser" },
                startTime: { toDate: () => SESSION_START },
                endTime: {
                  toDate: () => new Date(SESSION_START.getTime() + 98 * 60_000),
                },
              },
            ]
          : [],
      loading: false,
    }
  },
}))

afterEach(cleanup)
beforeEach(() => {
  usageQueries.length = 0
})

const item: CheckoutItemLocal = {
  id: "item-1",
  workshop: "holz",
  description: "Laser Cutter",
  origin: "nfc",
  type: "machine",
  catalogId: "laser",
  pricingModel: "time",
  quantity: 98 / 60,
  unitPrice: 20,
  totalPrice: 32.6,
}

describe("NfcUsageDetails in a badge session (issue #648)", () => {
  it("queries the visit owner's sessions, not the signed-in account's", async () => {
    render(
      <NfcMachineItemRow
        item={item}
        checkoutId="checkout-1"
        ownerRef={{ id: "badge-user" } as never}
      />,
    )
    await userEvent.click(screen.getByLabelText("Aufklappen"))

    const last = usageQueries.at(-1)
    expect(last?.find((c) => c.field === "userId")?.value).toEqual({
      id: "badge-user",
    })
    expect(last?.find((c) => c.field === "checkoutItemRef")?.value).toEqual({
      path: "checkouts/checkout-1/items/item-1",
    })
    // The session row renders (start time of the one usage record).
    expect(screen.getByText("14:02")).toBeTruthy()
  })
})
