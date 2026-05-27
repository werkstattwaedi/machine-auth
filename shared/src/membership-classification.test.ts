// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  isMembershipItem,
  partitionMembership,
} from "./membership-classification"

const MEMBERSHIP_ID = "membership-sku-001"
const opts = { membershipCatalogId: MEMBERSHIP_ID }

describe("isMembershipItem", () => {
  it("matches a string catalogId equal to the membership SKU", () => {
    expect(isMembershipItem({ catalogId: MEMBERSHIP_ID }, opts)).toBe(true)
  })

  it("matches an object catalogId (DocumentReference-like) by .id", () => {
    expect(isMembershipItem({ catalogId: { id: MEMBERSHIP_ID } }, opts)).toBe(
      true,
    )
  })

  it("does not match a different catalogId", () => {
    expect(isMembershipItem({ catalogId: "other-sku" }, opts)).toBe(false)
    expect(isMembershipItem({ catalogId: { id: "other-sku" } }, opts)).toBe(
      false,
    )
  })

  it("does not match an item without a catalogId", () => {
    expect(isMembershipItem({}, opts)).toBe(false)
    expect(isMembershipItem({ catalogId: null }, opts)).toBe(false)
    expect(isMembershipItem({ catalogId: undefined }, opts)).toBe(false)
  })

  it("classifies nothing when the membership SKU id is missing", () => {
    expect(
      isMembershipItem(
        { catalogId: MEMBERSHIP_ID },
        { membershipCatalogId: null },
      ),
    ).toBe(false)
    expect(
      isMembershipItem(
        { catalogId: MEMBERSHIP_ID },
        { membershipCatalogId: undefined },
      ),
    ).toBe(false)
    expect(
      isMembershipItem(
        { catalogId: MEMBERSHIP_ID },
        { membershipCatalogId: "" },
      ),
    ).toBe(false)
  })
})

describe("partitionMembership", () => {
  it("returns empty buckets for empty input", () => {
    const { membershipItems, otherItems } = partitionMembership([], opts)
    expect(membershipItems).toEqual([])
    expect(otherItems).toEqual([])
  })

  it("puts a membership-only cart entirely in membershipItems", () => {
    const items = [{ catalogId: MEMBERSHIP_ID, label: "single" }]
    const { membershipItems, otherItems } = partitionMembership(items, opts)
    expect(membershipItems).toEqual(items)
    expect(otherItems).toEqual([])
  })

  it("splits a mixed cart, preserving order within each bucket", () => {
    const items = [
      { catalogId: "wood-1", label: "a" },
      { catalogId: { id: MEMBERSHIP_ID }, label: "membership" },
      { catalogId: "wood-2", label: "b" },
    ]
    const { membershipItems, otherItems } = partitionMembership(items, opts)
    expect(membershipItems.map((i) => i.label)).toEqual(["membership"])
    expect(otherItems.map((i) => i.label)).toEqual(["a", "b"])
  })

  it("treats an item without a catalogId as a non-membership item", () => {
    const items = [{ label: "ad-hoc" }, { catalogId: null, label: "blank" }]
    const { membershipItems, otherItems } = partitionMembership(items, opts)
    expect(membershipItems).toEqual([])
    expect(otherItems).toEqual(items)
  })

  it("classifies nothing as membership when the SKU id is missing", () => {
    const items = [{ catalogId: MEMBERSHIP_ID, label: "would-be-membership" }]
    const { membershipItems, otherItems } = partitionMembership(items, {
      membershipCatalogId: null,
    })
    expect(membershipItems).toEqual([])
    expect(otherItems).toEqual(items)
  })
})
