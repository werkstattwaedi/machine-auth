// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import type { DocumentReference } from "firebase/firestore"
import type { CheckoutItemDoc } from "@modules/lib/firestore-entities"
import {
  correctionBlockedReason,
  draftFromCheckout,
  estimateSummary,
  isUnchanged,
  newItemRow,
  rowTotal,
  toWireEntry,
  validateDraft,
  validateReason,
  type CorrectionDraft,
} from "./visit-correction"

const ref = (id: string) => ({ id }) as unknown as DocumentReference
const FEES: Record<string, number | null> = { erwachsen: 15, kind: 7.5, firma: 30 }

const items: Array<CheckoutItemDoc & { id: string }> = [
  {
    id: "i1",
    workshop: "holz",
    description: "Laser",
    origin: "nfc",
    type: "machine",
    catalogId: null,
    quantity: 1.5,
    unitPrice: 30,
    totalPrice: 45,
  } as unknown as CheckoutItemDoc & { id: string },
  {
    id: "i2",
    workshop: "holz",
    description: "Ahorn",
    origin: "manual",
    catalogId: ref("cat-ahorn") as never,
    variantId: "default",
    quantity: 0.5,
    unitPrice: 56,
    totalPrice: 28,
  } as unknown as CheckoutItemDoc & { id: string },
]

function draft(): CorrectionDraft {
  return draftFromCheckout(
    {
      usageType: "regular",
      persons: [
        { name: "Anna", email: "anna@example.com", userType: "erwachsen", userRef: ref("u-anna") as never },
        { name: "Kid", email: "", userType: "kind", entryFeeWaivedToday: true },
      ],
      summary: { totalPrice: 95.5, entryFees: 22.5, machineCost: 45, materialCost: 28, tip: 0, discountAmount: 0 },
    },
    items,
  )
}

describe("draftFromCheckout", () => {
  it("maps persons (userRef → userId, waiver) and items (catalogId ref → id, type default material)", () => {
    const d = draft()
    expect(d.usageType).toBe("regular")
    expect(d.persons).toEqual([
      { name: "Anna", email: "anna@example.com", userType: "erwachsen", userId: "u-anna", entryFeeWaivedToday: false, billingAddress: null },
      { name: "Kid", email: "", userType: "kind", userId: null, entryFeeWaivedToday: true, billingAddress: null },
    ])
    expect(d.items.map((i) => [i.key, i.type, i.catalogId, i.variantId])).toEqual([
      ["i1", "machine", null, null],
      ["i2", "material", "cat-ahorn", "default"],
    ])
    expect(d.tip).toBe(0)
  })

  it("falls back to regular for an unknown usage type", () => {
    expect(draftFromCheckout({ usageType: "membership", persons: [], summary: undefined }, []).usageType).toBe("regular")
  })
})

describe("rowTotal", () => {
  it("rounds to 5 Rappen", () => {
    expect(rowTotal({ quantity: 3, unitPrice: 0.33 })).toBe(1)
    expect(rowTotal({ quantity: 1.5, unitPrice: 30 })).toBe(45)
    expect(rowTotal({ quantity: 0.333, unitPrice: 10 })).toBe(3.35)
  })
})

describe("validateDraft", () => {
  it("accepts the untouched draft", () => {
    expect(validateDraft(draft())).toEqual([])
  })

  it("reports missing description, non-positive quantity, negative price, no persons, negative tip", () => {
    const d = draft()
    d.persons = []
    d.items[0].description = "  "
    d.items[0].quantity = 0
    d.items[1].unitPrice = -1
    d.tip = -2
    const errors = validateDraft(d)
    expect(errors).toContain("Mindestens eine Person ist nötig.")
    expect(errors).toContain("Position 1: Bezeichnung fehlt.")
    expect(errors).toContain("Position 1: Menge muss grösser als 0 sein.")
    expect(errors).toContain("Position 2: Einzelpreis ist ungültig.")
    expect(errors).toContain("Trinkgeld darf nicht negativ sein.")
  })

  it("rejects materialbezug with machine rows", () => {
    const d = draft()
    d.usageType = "materialbezug"
    expect(validateDraft(d)).toEqual(["Materialbezug ist nicht möglich, wenn Maschinen genutzt wurden."])
  })
})

describe("validateReason", () => {
  it("needs at least 3 characters and at most 500", () => {
    expect(validateReason("  ab ")).toMatch(/mindestens 3/)
    expect(validateReason("x".repeat(501))).toMatch(/höchstens 500/)
    expect(validateReason("Menge falsch")).toBeNull()
  })
})

describe("isUnchanged", () => {
  it("ignores whitespace and float noise but sees real edits", () => {
    const a = draft()
    const b = draft()
    b.items[1].description = " Ahorn "
    expect(isUnchanged(a, b)).toBe(true)
    b.items[1].quantity = 0.75
    expect(isUnchanged(a, b)).toBe(false)
    const c = draft()
    c.persons[0].entryFeeWaivedToday = true
    expect(isUnchanged(a, c)).toBe(false)
    const d = draft()
    d.items.push(newItemRow("holz", "new-1"))
    expect(isUnchanged(a, d)).toBe(false)
  })
})

describe("estimateSummary", () => {
  it("prices the draft like the server (waived kid, regular)", () => {
    const s = estimateSummary(draft(), (ut) => FEES[ut] ?? null)!
    expect(s.entryFees).toBe(15)
    expect(s.machineCost).toBe(45)
    expect(s.materialCost).toBe(28)
    expect(s.totalPrice).toBe(88)
  })

  it("is null while a fee row is missing", () => {
    expect(estimateSummary(draft(), () => null)).toBeNull()
  })
})

describe("correctionBlockedReason", () => {
  const refs = { membershipCatalogId: "cat-membership", badgeCatalogId: "cat-badge" }
  const unpaid = { paidAt: null, cancelledAt: null, source: "checkout" as const }

  it("allows a closed, unpaid, plain visit", () => {
    expect(correctionBlockedReason({ status: "closed" }, unpaid, items, refs)).toBeNull()
  })

  it("names the blocking condition", () => {
    expect(correctionBlockedReason({ status: "cancelled" }, unpaid, [], refs)).toMatch(/bereits storniert/)
    expect(correctionBlockedReason({ status: "open" }, unpaid, [], refs)).toMatch(/abgeschlossene/)
    expect(correctionBlockedReason({ status: "closed" }, null, [], refs)).toMatch(/keine Rechnung/)
    expect(correctionBlockedReason({ status: "closed" }, { ...unpaid, paidAt: {} as never }, [], refs)).toMatch(/bereits bezahlt/)
    expect(correctionBlockedReason({ status: "closed" }, { ...unpaid, source: "membership-renewal" }, [], refs)).toMatch(/Mitgliederbeitrag/)
    const membershipItem = { catalogId: ref("cat-membership") as never, variantId: "single" }
    expect(correctionBlockedReason({ status: "closed" }, unpaid, [membershipItem], refs)).toMatch(/Mitgliedschaft oder Badge/)
    // No membership SKU configured → nothing to exclude.
    expect(
      correctionBlockedReason({ status: "closed" }, unpaid, [membershipItem], {
        membershipCatalogId: null,
        badgeCatalogId: null,
      }),
    ).toBeNull()
  })
})

describe("toWireEntry", () => {

  it("emits the callable payload with per-row totals", () => {
    const entry = toWireEntry("co-1", draft())
    expect(entry.checkoutId).toBe("co-1")
    expect(entry.replacement?.items[1]).toEqual({
      workshop: "holz",
      description: "Ahorn",
      type: "material",
      catalogId: "cat-ahorn",
      variantId: "default",
      origin: "manual",
      quantity: 0.5,
      unitPrice: 56,
      totalPrice: 28,
    })
    expect(entry.replacement?.persons[1]).toEqual({
      name: "Kid",
      email: "",
      userType: "kind",
      userId: null,
      entryFeeWaivedToday: true,
      billingAddress: null,
    })
  })
})
