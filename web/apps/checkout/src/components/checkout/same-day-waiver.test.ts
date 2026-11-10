// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * ADR-0050: the Check Out page previews the same-day usage-fee waiver the
 * server applies on close, so the shown total matches the bill.
 */

import { describe, it, expect } from "vitest"
import type { DocumentReference, Timestamp } from "firebase/firestore"
import type { CheckoutDoc, UserDoc } from "@modules/lib/firestore-entities"
import type { PricingConfig } from "@modules/lib/workshop-config"
import {
  sameDayCheckoutFromWire,
  toSameDayCheckout,
  withSameDayWaiver,
} from "./same-day-waiver"
import { computeCheckoutCosts } from "./step-checkout"
import type { CheckoutPerson } from "./use-checkout-state"

const OWNER = "u-owner"

const config: PricingConfig = {
  entryFees: {
    erwachsen: { regular: 15 },
    kind: { regular: 7.5 },
    firma: { regular: 30 },
  },
  workshops: {} as PricingConfig["workshops"],
  slaLayerPrice: { none: 0.01, member: 0.008 },
  labels: {
    units: {},
    discounts: { none: "Normal", member: "Mitglied" },
  },
}

function ts(iso: string): Timestamp {
  const d = new Date(iso)
  return { toDate: () => d, toMillis: () => d.getTime() } as unknown as Timestamp
}

function ref(id: string): DocumentReference<UserDoc> {
  return { id } as DocumentReference<UserDoc>
}

function person(overrides: Partial<CheckoutPerson> & { id: string }): CheckoutPerson {
  return {
    firstName: "Max",
    lastName: "Muster",
    email: "",
    userType: "erwachsen",
    termsAccepted: true,
    isPreFilled: true,
    usageType: "regular",
    ...overrides,
  }
}

const owner = person({ id: "p-owner", userId: OWNER })
const kid = person({ id: "p-kid", firstName: "Noah", lastName: "Keller", userType: "kind", isPreFilled: false })

// 2026-06-06 in Zurich (CEST, UTC+2).
const morning = "2026-06-06T07:00:00Z"
const openedAt = new Date("2026-06-06T13:00:00Z")

function closed(overrides: Partial<CheckoutDoc> = {}): CheckoutDoc & { id: string } {
  return {
    id: "co-morning",
    userId: ref(OWNER),
    status: "closed",
    usageType: "regular",
    created: ts(morning),
    closedAt: ts(morning),
    workshopsVisited: ["holz"],
    persons: [
      { name: "Max Muster", email: "", userType: "erwachsen", userRef: ref(OWNER), usageType: "regular" },
      { name: "keller  NOAH", email: "", userType: "kind", usageType: "regular" },
    ],
    ...overrides,
  } as CheckoutDoc & { id: string }
}

describe("withSameDayWaiver", () => {
  it("marks the owner and a companion by name already on a visit opened today", () => {
    const out = withSameDayWaiver([owner, kid], OWNER, openedAt, [closed()].map(toSameDayCheckout), "co-open")
    expect(out.map((p) => p.entryFeeWaivedToday ?? false)).toEqual([true, true])
  })

  // CHK-37: a morning that cost nothing covers nothing in the afternoon.
  it("leaves the owner unmarked after a Hangenmoos morning", () => {
    const hangenmoos = closed({
      usageType: "hangenmoos",
      persons: [
        { name: "Max Muster", email: "", userType: "erwachsen", userRef: ref(OWNER), usageType: "hangenmoos" },
      ],
    })
    const out = withSameDayWaiver([owner], OWNER, openedAt, [hangenmoos].map(toSameDayCheckout), "co-open")
    expect(out[0].entryFeeWaivedToday).toBeUndefined()
  })

  it("leaves a companion with another person type unmarked", () => {
    const adultNoah = { ...kid, userType: "erwachsen" as const }
    const out = withSameDayWaiver([adultNoah], OWNER, openedAt, [closed()].map(toSameDayCheckout), "co-open")
    expect(out[0].entryFeeWaivedToday).toBeUndefined()
  })

  it("ignores visits opened on another business day and cancelled ones", () => {
    const yesterday = closed({ created: ts("2026-06-05T13:00:00Z") })
    const cancelled = closed({ status: "cancelled" })
    const out = withSameDayWaiver([owner], OWNER, openedAt, [yesterday, cancelled].map(toSameDayCheckout), "co-open")
    expect(out[0].entryFeeWaivedToday).toBeUndefined()
  })

  // #812: the terminal charged the approved attempt — its persons count.
  it("counts a visit awaiting payment by its approved attempt", () => {
    const awaiting = closed({
      status: "awaiting_payment",
      closedAt: undefined,
      persons: [],
      terminalApproval: { attempt: 2, reportedAt: ts(morning) },
      terminalAttempts: {
        "1": { amount: 7.5, reference: "S-co-1", usageType: "regular", persons: [] },
        "2": {
          amount: 22.5,
          reference: "S-co-2",
          usageType: "regular",
          persons: closed().persons,
        },
      },
    })
    const out = withSameDayWaiver([owner, kid], OWNER, openedAt, [awaiting].map(toSameDayCheckout), "co-open")
    expect(out.map((p) => p.entryFeeWaivedToday ?? false)).toEqual([true, true])
  })

  it("never marks anyone on a guest check-in", () => {
    const out = withSameDayWaiver([kid], null, openedAt, [closed()].map(toSameDayCheckout), null)
    expect(out[0].entryFeeWaivedToday).toBeUndefined()
  })

  it("feeds the summary so the shown usage fee is what the server bills", () => {
    const newcomer = person({ id: "p-new", firstName: "Lea", lastName: "Neu", userType: "kind", isPreFilled: false })
    const persons = withSameDayWaiver([owner, kid, newcomer], OWNER, openedAt, [closed()].map(toSameDayCheckout), "co-open")
    const costs = computeCheckoutCosts({ persons, usageType: "regular", items: [], config })
    expect(costs.personFeesNet).toBe(7.5) // only Lea pays
  })

  // A kiosk badge session gets the day's visits from getSameDayVisits (#854)
  // — e.g. last Monday's, for a checkout forgotten open since then.
  it("counts a visit from getSameDayVisits like one read from Firestore", () => {
    const doc = closed()
    const wire = {
      id: "co-wire",
      status: "closed",
      usageType: "regular",
      created: openedAt.getTime() - 3600_000,
      closedAt: openedAt.getTime() - 1800_000,
      persons: [
        { name: "Owner Person", userType: "erwachsen", userRef: { id: OWNER }, usageType: null },
      ],
    }
    const viaWire = withSameDayWaiver([owner], OWNER, openedAt, [sameDayCheckoutFromWire(wire)], "co-open")
    const viaDoc = withSameDayWaiver([owner], OWNER, openedAt, [doc].map(toSameDayCheckout), "co-open")
    expect(viaWire[0].entryFeeWaivedToday).toBe(true)
    expect(viaDoc[0].entryFeeWaivedToday).toBe(true)
  })
})
