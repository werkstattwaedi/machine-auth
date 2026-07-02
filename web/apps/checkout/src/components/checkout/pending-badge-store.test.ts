// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearPendingBadge,
  consumePendingBadge,
  peekPendingBadge,
  setPendingBadge,
} from "./pending-badge-store"

const BADGE = { tokenId: "04c339aa1e1890", badgeVoucher: "voucher-1" }

describe("pending-badge-store", () => {
  beforeEach(() => {
    clearPendingBadge()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    clearPendingBadge()
  })

  it("peek returns the parked badge without consuming it", () => {
    setPendingBadge(BADGE)
    expect(peekPendingBadge()).toMatchObject(BADGE)
    expect(peekPendingBadge()).toMatchObject(BADGE)
  })

  it("consume returns the badge once and clears it", () => {
    setPendingBadge(BADGE)
    expect(consumePendingBadge()).toMatchObject(BADGE)
    expect(consumePendingBadge()).toBeNull()
    expect(peekPendingBadge()).toBeNull()
  })

  it("drops an expired entry (client-side TTL mirror)", () => {
    setPendingBadge(BADGE)
    vi.advanceTimersByTime(16 * 60 * 1000)
    expect(peekPendingBadge()).toBeNull()
  })

  it("survives module-state loss via the sessionStorage mirror", () => {
    setPendingBadge(BADGE)
    // Simulate a reload: the in-memory copy is gone but sessionStorage holds
    // the mirror. clearPendingBadge wipes both, so read the raw mirror first.
    const raw = sessionStorage.getItem("oww.pendingBadge")
    clearPendingBadge()
    sessionStorage.setItem("oww.pendingBadge", raw!)
    expect(peekPendingBadge()).toMatchObject(BADGE)
  })

  it("ignores a corrupted mirror", () => {
    sessionStorage.setItem("oww.pendingBadge", "{not json")
    expect(peekPendingBadge()).toBeNull()
  })
})
