// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { isValidEmail, validatePerson, validateCheckoutItem, hasItemErrors } from "./validation"
import type { CheckoutPerson } from "./use-checkout-state"
import type { CheckoutItemLocal } from "@/components/usage/inline-rows"

function makePerson(overrides: Partial<CheckoutPerson> = {}): CheckoutPerson {
  return {
    id: "p1",
    firstName: "Max",
    lastName: "Muster",
    email: "max@test.com",
    userType: "erwachsen",
    termsAccepted: true,
    isPreFilled: false,
    ...overrides,
  }
}

function makeItem(overrides: Partial<CheckoutItemLocal> = {}): CheckoutItemLocal {
  return {
    id: "item-1",
    workshop: "holz",
    description: "Test",
    origin: "manual",
    catalogId: null,
    pricingModel: "count",
    quantity: 1,
    unitPrice: 10,
    totalPrice: 10,
    ...overrides,
  }
}

describe("isValidEmail", () => {
  it.each([
    "user@example.com",
    "user.name@example.com",
    "user+tag@example.co.uk",
    "a@b.ch",
  ])("accepts valid email: %s", (email) => {
    expect(isValidEmail(email)).toBe(true)
  })

  it.each([
    "",
    "not-email",
    "@no-local.com",
    "no-domain@",
    "no-tld@example",
    "spaces in@email.com",
    "double@@at.com",
  ])("rejects invalid email: %s", (email) => {
    expect(isValidEmail(email)).toBe(false)
  })
})

describe("validatePerson", () => {
  it("returns empty for a valid person", () => {
    expect(validatePerson(makePerson(), true)).toEqual({})
  })

  it("returns empty for pre-filled person regardless of fields", () => {
    expect(
      validatePerson(makePerson({ isPreFilled: true, firstName: "", email: "" }), true),
    ).toEqual({})
  })

  it("requires firstName", () => {
    const errors = validatePerson(makePerson({ firstName: "" }), true)
    expect(errors.firstName).toBe("Vorname ist erforderlich.")
  })

  it("requires lastName", () => {
    const errors = validatePerson(makePerson({ lastName: "  " }), true)
    expect(errors.lastName).toBe("Nachname ist erforderlich.")
  })

  it("requires email", () => {
    const errors = validatePerson(makePerson({ email: "" }), true)
    expect(errors.email).toBe("E-Mail ist erforderlich.")
  })

  it("validates email format", () => {
    const errors = validatePerson(makePerson({ email: "not-valid" }), true)
    expect(errors.email).toBe(
      "E-Mail muss im Format name@address.xyz eingegeben werden.",
    )
  })

  it("requires terms for anonymous users", () => {
    const errors = validatePerson(makePerson({ termsAccepted: false }), true)
    expect(errors.termsAccepted).toBe("Nutzungsbestimmungen ist erforderlich.")
  })

  it("does not require terms for non-anonymous users", () => {
    const errors = validatePerson(makePerson({ termsAccepted: false }), false)
    expect(errors.termsAccepted).toBeUndefined()
  })

  it("requires billing fields for firma", () => {
    const errors = validatePerson(
      makePerson({ userType: "firma" }),
      true,
    )
    expect(errors.billingCompany).toBe("Firma ist erforderlich.")
    expect(errors.billingStreet).toBe("Strasse / Nr. ist erforderlich.")
    expect(errors.billingZip).toBe("PLZ ist erforderlich.")
    expect(errors.billingCity).toBe("Ort ist erforderlich.")
  })

  it("accepts filled billing fields for firma", () => {
    const errors = validatePerson(
      makePerson({
        userType: "firma",
        billingCompany: "ACME",
        billingStreet: "Main St 1",
        billingZip: "8000",
        billingCity: "Zürich",
      }),
      true,
    )
    expect(errors.billingCompany).toBeUndefined()
    expect(errors.billingStreet).toBeUndefined()
    expect(errors.billingZip).toBeUndefined()
    expect(errors.billingCity).toBeUndefined()
  })

  it("does not require billing fields for non-firma", () => {
    const errors = validatePerson(makePerson({ userType: "erwachsen" }), true)
    expect(errors.billingCompany).toBeUndefined()
  })

  it("can return multiple errors at once", () => {
    const errors = validatePerson(
      makePerson({ firstName: "", lastName: "", email: "", termsAccepted: false }),
      true,
    )
    expect(Object.keys(errors)).toHaveLength(4)
  })

  // --- isPrimary (email optionality for additional persons) ---

  it("requires email for primary person", () => {
    const errors = validatePerson(makePerson({ email: "" }), true, true)
    expect(errors.email).toBe("E-Mail ist erforderlich.")
  })

  it("does not require email for additional person", () => {
    const errors = validatePerson(makePerson({ email: "" }), true, false)
    expect(errors.email).toBeUndefined()
  })

  it("validates email format for additional person when provided", () => {
    const errors = validatePerson(makePerson({ email: "not-valid" }), true, false)
    expect(errors.email).toBe("E-Mail muss im Format name@address.xyz eingegeben werden.")
  })

  it("accepts valid email for additional person", () => {
    const errors = validatePerson(makePerson({ email: "max@test.com" }), true, false)
    expect(errors.email).toBeUndefined()
  })

  it("accepts empty email for additional person", () => {
    const errors = validatePerson(makePerson({ email: "" }), true, false)
    expect(errors.email).toBeUndefined()
  })
})

describe("validateCheckoutItem", () => {
  it("returns empty for a valid catalog item", () => {
    expect(validateCheckoutItem(makeItem({ catalogId: "cat-1" }))).toEqual({})
  })

  it("returns empty for NFC items", () => {
    expect(validateCheckoutItem(makeItem({ origin: "nfc", quantity: 0 }))).toEqual({})
  })

  it("requires quantity > 0", () => {
    const errors = validateCheckoutItem(makeItem({ quantity: 0 }))
    expect(errors.quantity).toBe("Anzahl muss grösser als 0 sein.")
    expect(errors.price).toBeUndefined()
  })

  // --- direct (Pauschal) items ---

  it("requires description for direct items", () => {
    const errors = validateCheckoutItem(makeItem({ pricingModel: "direct", description: "", quantity: 1, totalPrice: 5 }))
    expect(errors.description).toBe("Beschreibung ist erforderlich.")
  })

  it("requires price > 0 for direct items", () => {
    const errors = validateCheckoutItem(makeItem({ pricingModel: "direct", description: "Laser", quantity: 1, totalPrice: 0 }))
    expect(errors.price).toBe("Preis muss grösser als 0 sein.")
    expect(errors.description).toBeUndefined()
  })

  it("returns both description and price errors for direct items", () => {
    const errors = validateCheckoutItem(makeItem({ pricingModel: "direct", description: "", quantity: 1, totalPrice: 0 }))
    expect(errors.description).toBeDefined()
    expect(errors.price).toBeDefined()
  })

  it("accepts direct item with description and price", () => {
    expect(validateCheckoutItem(makeItem({ pricingModel: "direct", description: "Laser", quantity: 1, totalPrice: 25 }))).toEqual({})
  })

  // --- unit price for manually added (non-catalog) items ---

  it("requires unitPrice > 0 for manual count items", () => {
    const errors = validateCheckoutItem(makeItem({ catalogId: null, pricingModel: "count", quantity: 3, unitPrice: 0 }))
    expect(errors.price).toBe("Preis muss grösser als 0 sein.")
    expect(errors.quantity).toBeUndefined()
  })

  it("requires unitPrice > 0 for manual weight items", () => {
    const errors = validateCheckoutItem(makeItem({ catalogId: null, pricingModel: "weight", quantity: 0.5, unitPrice: 0 }))
    expect(errors.price).toBeDefined()
  })

  it("requires unitPrice > 0 for manual time items", () => {
    const errors = validateCheckoutItem(makeItem({ catalogId: null, pricingModel: "time", quantity: 0.5, unitPrice: 0 }))
    expect(errors.price).toBeDefined()
  })

  it("does not require unitPrice for catalog items", () => {
    expect(validateCheckoutItem(makeItem({ catalogId: "cat-1", unitPrice: 0, quantity: 1 }))).toEqual({})
  })

  it("can return both quantity and price errors", () => {
    const errors = validateCheckoutItem(makeItem({ catalogId: null, pricingModel: "count", quantity: 0, unitPrice: 0 }))
    expect(errors.quantity).toBeDefined()
    expect(errors.price).toBeDefined()
  })

  // --- area items ---

  it("requires area dimensions > 0", () => {
    const errors = validateCheckoutItem(
      makeItem({ pricingModel: "area", quantity: 0, unitPrice: 25, formInputs: [{ quantity: 0, unit: "cm" }, { quantity: 100, unit: "cm" }] }),
    )
    expect(errors.quantity).toBe("Masse müssen grösser als 0 sein.")
  })

  it("requires unitPrice > 0 for manual area items", () => {
    const errors = validateCheckoutItem(
      makeItem({ pricingModel: "area", catalogId: null, quantity: 1, unitPrice: 0, formInputs: [{ quantity: 100, unit: "cm" }, { quantity: 100, unit: "cm" }] }),
    )
    expect(errors.price).toBe("Preis muss grösser als 0 sein.")
    expect(errors.quantity).toBeUndefined()
  })

  it("accepts valid area item with catalog price", () => {
    expect(
      validateCheckoutItem(
        makeItem({ pricingModel: "area", catalogId: "cat-2", quantity: 1, unitPrice: 0, formInputs: [{ quantity: 100, unit: "cm" }, { quantity: 100, unit: "cm" }] }),
      ),
    ).toEqual({})
  })

  // --- length items ---

  it("requires length > 0 for length items", () => {
    const errors = validateCheckoutItem(
      makeItem({ pricingModel: "length", quantity: 0, unitPrice: 3, formInputs: [{ quantity: 0, unit: "cm" }] }),
    )
    expect(errors.quantity).toBe("Länge muss grösser als 0 sein.")
  })

  it("requires unitPrice > 0 for manual length items", () => {
    const errors = validateCheckoutItem(
      makeItem({ pricingModel: "length", catalogId: null, quantity: 1.5, unitPrice: 0, formInputs: [{ quantity: 150, unit: "cm" }] }),
    )
    expect(errors.price).toBeDefined()
  })

  // --- negative values ---

  it("rejects negative quantity", () => {
    const errors = validateCheckoutItem(makeItem({ quantity: -3 }))
    expect(errors.quantity).toBeDefined()
  })

  it("rejects negative unitPrice for manual items", () => {
    const errors = validateCheckoutItem(makeItem({ catalogId: null, quantity: 1, unitPrice: -5 }))
    expect(errors.price).toBeDefined()
  })

  it("rejects negative totalPrice for direct items", () => {
    const errors = validateCheckoutItem(makeItem({ pricingModel: "direct", description: "Test", quantity: 1, totalPrice: -10 }))
    expect(errors.price).toBeDefined()
  })

  it("rejects negative area dimensions", () => {
    const errors = validateCheckoutItem(
      makeItem({ pricingModel: "area", unitPrice: 25, formInputs: [{ quantity: -50, unit: "cm" }, { quantity: 100, unit: "cm" }] }),
    )
    expect(errors.quantity).toBeDefined()
  })

  it("rejects negative length", () => {
    const errors = validateCheckoutItem(
      makeItem({ pricingModel: "length", unitPrice: 3, formInputs: [{ quantity: -100, unit: "cm" }] }),
    )
    expect(errors.quantity).toBeDefined()
  })

  // --- reactive clearing (regression) ---

  it("clears errors once item is fixed", () => {
    const item = makeItem({ quantity: 0 })
    expect(hasItemErrors(validateCheckoutItem(item))).toBe(true)

    const fixed = { ...item, quantity: 3 }
    expect(hasItemErrors(validateCheckoutItem(fixed))).toBe(false)
  })

  // --- hasItemErrors ---

  it("hasItemErrors returns false for empty object", () => {
    expect(hasItemErrors({})).toBe(false)
  })

  it("hasItemErrors returns true when errors present", () => {
    expect(hasItemErrors({ quantity: "error" })).toBe(true)
  })
})
