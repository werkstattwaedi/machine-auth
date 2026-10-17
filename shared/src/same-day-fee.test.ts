// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import {
  normalizePersonName,
  sameDayCoveredPersons,
  samedayPersonKey,
  type SameDayCheckout,
  type SameDayPerson,
} from "./same-day-fee"

const OWNER = "owner-1"

// Zurich is UTC+2 in June (CEST).
const morning = new Date("2026-06-06T07:00:00Z") // 09:00
const afternoon = new Date("2026-06-06T13:00:00Z") // 15:00
const lateNight = new Date("2026-06-06T23:30:00Z") // 01:30 next calendar day, same business day
const nextDay = new Date("2026-06-07T07:00:00Z") // 09:00 the day after

const owner: SameDayPerson = { name: "Olga Owner", userType: "erwachsen", userRef: { id: OWNER } }
const anna: SameDayPerson = { name: "Anna Alpha", userType: "kind" }

function visit(over: Partial<SameDayCheckout> = {}): SameDayCheckout {
  return {
    id: "earlier",
    status: "closed",
    created: morning,
    closedAt: morning,
    persons: [owner, anna],
    ...over,
  }
}

function covered(
  persons: SameDayPerson[],
  earlierCheckouts: SameDayCheckout[],
  extra: Partial<Parameters<typeof sameDayCoveredPersons>[0]> = {},
): boolean[] {
  return sameDayCoveredPersons({
    persons,
    ownerId: OWNER,
    openedAt: afternoon,
    earlierCheckouts,
    ...extra,
  })
}

describe("normalizePersonName", () => {
  it("lowercases, trims, collapses whitespace and sorts the words", () => {
    expect(normalizePersonName(" Anna   Alpha ")).toBe("alpha anna")
    expect(normalizePersonName("alpha anna")).toBe("alpha anna")
  })

  it("does not fold diacritics", () => {
    expect(normalizePersonName("Jörg Müller")).not.toBe(normalizePersonName("Jorg Muller"))
  })
})

describe("samedayPersonKey", () => {
  it("keys the owner's line by account id, whatever the name", () => {
    expect(samedayPersonKey(owner, OWNER)).toBe(`account:${OWNER}`)
    expect(samedayPersonKey({ ...owner, name: "Renamed" }, OWNER)).toBe(`account:${OWNER}`)
  })

  it("keys everyone else by normalized name and person type", () => {
    expect(samedayPersonKey(anna, OWNER)).toBe("name:kind:alpha anna")
  })

  it("keys a line linking another account by name (older family links)", () => {
    expect(samedayPersonKey({ ...anna, userRef: { id: "other" } }, OWNER)).toBe(
      "name:kind:alpha anna",
    )
  })

  it("has no key without an owner or without a name", () => {
    expect(samedayPersonKey(owner, null)).toBeNull()
    expect(samedayPersonKey({ name: "  ", userType: "kind" }, OWNER)).toBeNull()
  })
})

describe("sameDayCoveredPersons", () => {
  it("covers the owner by account and a companion by name", () => {
    expect(covered([owner, anna], [visit()])).toEqual([true, true])
  })

  it("matches names regardless of case, spacing and word order", () => {
    const retyped = { name: "  alpha   ANNA ", userType: "kind" }
    expect(covered([retyped], [visit()])).toEqual([true])
  })

  it("does not cover the same name with another person type", () => {
    expect(covered([{ name: "Anna Alpha", userType: "erwachsen" }], [visit()])).toEqual([false])
  })

  it("does not cover a person who was not on the earlier visit", () => {
    expect(covered([{ name: "Bob Beta", userType: "kind" }], [visit()])).toEqual([false])
  })

  it("covers regardless of the earlier line's usage type or fee", () => {
    const earlier = visit({
      usageType: "hangenmoos",
      persons: [{ ...owner, usageType: "hangenmoos", entryFeeWaivedToday: true } as SameDayPerson],
    })
    expect(covered([owner], [earlier])).toEqual([true])
  })

  it("compares opening days: a visit opened yesterday and closed today does not count", () => {
    const opensYesterday = visit({
      created: new Date("2026-06-05T15:00:00Z"),
      closedAt: morning,
    })
    expect(covered([owner], [opensYesterday])).toEqual([false])
  })

  it("compares opening days: a visit opened today and closed after the boundary counts", () => {
    // The earlier visit closed the next business day; the current one was
    // opened the same day it was.
    const closedTomorrow = visit({ created: morning, closedAt: nextDay })
    expect(covered([owner], [closedTomorrow], { openedAt: lateNight })).toEqual([true])
  })

  it("uses the current visit's opening day, not now", () => {
    expect(covered([owner], [visit()], { openedAt: nextDay })).toEqual([false])
  })

  it("ignores cancelled visits", () => {
    expect(covered([owner], [visit({ status: "cancelled" })])).toEqual([false])
    expect(covered([owner], [visit({ cancelledAt: new Date() })])).toEqual([false])
  })

  it("ignores open visits", () => {
    expect(covered([owner], [visit({ status: "open" })])).toEqual([false])
  })

  it("ignores purchase-only checkouts (everyone on Begleitung, CHK-9)", () => {
    expect(covered([owner], [visit({ usageType: "materialbezug" })])).toEqual([false])
  })

  it("skips the current checkout", () => {
    expect(covered([owner], [visit({ id: "current" })], { currentCheckoutId: "current" })).toEqual([
      false,
    ])
  })

  it("with closedBefore only counts visits closed before it", () => {
    const later = visit({ id: "later", created: afternoon, closedAt: afternoon })
    expect(covered([owner], [later], { openedAt: morning, closedBefore: morning })).toEqual([false])
    expect(covered([owner], [visit()], { closedBefore: afternoon })).toEqual([true])
  })

  it("never covers guests (no owner)", () => {
    expect(covered([anna], [visit()], { ownerId: null })).toEqual([false])
  })
})
