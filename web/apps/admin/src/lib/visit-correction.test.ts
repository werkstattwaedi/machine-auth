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
      userId: ref("u-anna") as never,
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
    expect(d.ownerId).toBe("u-anna")
    expect(d.persons).toEqual([
      { name: "Anna", email: "anna@example.com", userType: "erwachsen", userId: "u-anna", entryFeeWaivedToday: false, usageType: "regular", billingAddress: null },
      { name: "Kid", email: "", userType: "kind", userId: null, entryFeeWaivedToday: true, usageType: "regular", billingAddress: null },
    ])
    expect(d.items.map((i) => [i.key, i.type, i.catalogId, i.variantId])).toEqual([
      ["i1", "machine", null, null],
      ["i2", "material", "cat-ahorn", "default"],
    ])
    expect(d.tip).toBe(0)
  })

  it("falls back to regular for an unknown usage type", () => {
    const d = draftFromCheckout(
      { usageType: "membership", persons: [{ name: "A", email: "", userType: "erwachsen" }], summary: undefined },
      [],
    )
    expect(d.persons[0].usageType).toBe("regular")
  })

  it("prefers each person's own usage type (#605)", () => {
    const d = draftFromCheckout(
      {
        usageType: "regular",
        persons: [
          { name: "A", email: "", userType: "erwachsen", usageType: "materialbezug" },
          { name: "B", email: "", userType: "kind" },
        ],
        summary: undefined,
      },
      [],
    )
    expect(d.persons.map((p) => p.usageType)).toEqual(["materialbezug", "regular"])
  })

  it("seeds a legacy owner-only type only on the owner alone (#605)", () => {
    const owner = { name: "A", email: "", userType: "erwachsen" as const, userRef: ref("u-a") as never }
    const alone = draftFromCheckout(
      { usageType: "volunteering", userId: ref("u-a") as never, persons: [owner], summary: undefined },
      [],
    )
    expect(alone.persons[0].usageType).toBe("volunteering")
    const withKid = draftFromCheckout(
      {
        usageType: "intern",
        userId: ref("u-a") as never,
        persons: [owner, { name: "K", email: "", userType: "kind" }],
        summary: undefined,
      },
      [],
    )
    expect(withKid.persons.map((p) => p.usageType)).toEqual(["regular", "regular"])
  })

  it("keeps a guest's savedPersonId, not one on an account line (#605)", () => {
    const d = draftFromCheckout(
      {
        usageType: "regular",
        userId: ref("u-a") as never,
        persons: [
          { name: "A", email: "", userType: "erwachsen", userRef: ref("u-a") as never, savedPersonId: "sp-x" },
          { name: "K", email: "", userType: "kind", savedPersonId: "sp-kid" },
          { name: "L", email: "", userType: "kind" },
        ],
        summary: undefined,
      },
      [],
    )
    expect(d.persons.map((p) => p.savedPersonId)).toEqual([undefined, "sp-kid", undefined])
    expect(d.persons[2]).not.toHaveProperty("savedPersonId")
  })
})

describe("rowTotal", () => {
  it("rounds to cents exactly like the checkout wizard", () => {
    expect(rowTotal({ quantity: 3, unitPrice: 0.33 })).toBe(0.99)
    expect(rowTotal({ quantity: 1.5, unitPrice: 30 })).toBe(45)
    // The staging smoke test: 0.5 × 18.15 was stored as 9.07 by the wizard.
    expect(rowTotal({ quantity: 0.5, unitPrice: 18.15 })).toBe(9.07)
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

  it("rejects machine rows when everyone only accompanies (CHK-8)", () => {
    const d = draft()
    d.persons.forEach((p) => (p.usageType = "materialbezug"))
    expect(validateDraft(d)).toHaveLength(1)
    d.persons[1].usageType = "regular"
    expect(validateDraft(d)).toEqual([])
  })

  it("allows an owner-only type only on the owner alone (CHK-32)", () => {
    const d = draft()
    d.persons[0].usageType = "volunteering"
    // Owner, but not alone.
    expect(validateDraft(d)).toHaveLength(1)
    d.persons = [d.persons[0]]
    expect(validateDraft(d)).toEqual([])
    // Not the owner.
    const e = draft()
    e.persons[1].usageType = "intern"
    expect(validateDraft(e).length).toBeGreaterThan(0)
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
    const e = draft()
    e.persons[1].usageType = "ermaessigt"
    expect(isUnchanged(a, e)).toBe(false)
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

  it("charges each person their own type's fee (#605)", () => {
    const d = draft()
    d.persons[0].usageType = "materialbezug"
    d.persons[1].entryFeeWaivedToday = false
    const s = estimateSummary(d, (ut) => FEES[ut] ?? null)!
    // Adult accompanies (0), the child pays 7.50; machines stay billed.
    expect(s.totalPrice).toBe(7.5 + 45 + 28)
  })

  it("is null while a fee row is missing", () => {
    expect(estimateSummary(draft(), () => null)).toBeNull()
  })
})

describe("correctionBlockedReason", () => {
  const refs = { membershipCatalogId: "cat-membership", badgeCatalogId: "cat-badge" }
  const unpaid = {
    paidAt: null,
    cancelledAt: null,
    source: "checkout" as const,
    kind: "invoice" as const,
    referenceNumber: 42000010,
  }

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
    // A Beleg never carries paidAt itself — its Sammelrechnung decides.
    const beleg = { ...unpaid, kind: "beleg" as const }
    expect(correctionBlockedReason({ status: "closed" }, beleg, [], refs, { paidAt: null, cancelledAt: null })).toBeNull()
    expect(
      correctionBlockedReason({ status: "closed" }, beleg, [], refs, { paidAt: {} as never, cancelledAt: null }),
    ).toMatch(/Sammelrechnung .* bereits bezahlt/)
    // Tenth revision (digit 9) cannot be corrected again.
    expect(correctionBlockedReason({ status: "closed" }, { ...unpaid, referenceNumber: 42000019 }, [], refs)).toMatch(
      /maximale Anzahl/,
    )
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
      usageType: "regular",
      billingAddress: null,
    })
    expect(entry.replacement).not.toHaveProperty("usageType")
  })

  it("sends each person's type, no visit-wide one (#605)", () => {
    const d = draft()
    d.persons[0].usageType = "volunteering"
    d.persons = [d.persons[0]]
    const entry = toWireEntry("co-1", d)
    expect(entry.replacement?.persons[0].usageType).toBe("volunteering")
    expect(entry.replacement?.persons[0].userId).toBe("u-anna")
    expect(entry.replacement).not.toHaveProperty("usageType")
  })

  it("carries a guest's savedPersonId, never on an account line (#605)", () => {
    const d = draft()
    d.persons[1].savedPersonId = "sp-kid"
    d.persons[0].savedPersonId = "sp-bogus"
    const entry = toWireEntry("co-1", d)
    expect(entry.replacement?.persons[1].savedPersonId).toBe("sp-kid")
    expect(entry.replacement?.persons[0]).not.toHaveProperty("savedPersonId")
  })
})
