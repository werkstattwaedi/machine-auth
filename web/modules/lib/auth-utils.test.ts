// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { isProfileComplete, type UserDoc } from "./auth"

function makeUserDoc(overrides: Partial<UserDoc> = {}): UserDoc {
  return {
    id: "user-1",
    displayName: "Max Muster",
    rawDisplayName: "Max Muster",
    firstName: "Max",
    lastName: "Muster",
    email: "max@example.com",
    roles: [],
    permissions: [],
    termsAcceptedAt: { toDate: () => new Date("2025-01-01") },
    userType: "erwachsen",
    ...overrides,
  }
}

describe("isProfileComplete", () => {
  it("returns true for a complete erwachsen profile", () => {
    expect(isProfileComplete(makeUserDoc())).toBe(true)
  })

  it("returns false when firstName is missing", () => {
    expect(isProfileComplete(makeUserDoc({ firstName: "" }))).toBe(false)
  })

  it("returns false when lastName is missing", () => {
    expect(isProfileComplete(makeUserDoc({ lastName: "" }))).toBe(false)
  })

  it("returns false when termsAcceptedAt is missing", () => {
    expect(isProfileComplete(makeUserDoc({ termsAcceptedAt: null }))).toBe(
      false,
    )
  })

  it("returns false when termsAcceptedAt is undefined", () => {
    expect(
      isProfileComplete(makeUserDoc({ termsAcceptedAt: undefined })),
    ).toBe(false)
  })

  it("returns false for empty string firstName", () => {
    expect(isProfileComplete(makeUserDoc({ firstName: "" }))).toBe(false)
  })

  it("returns true for firma with complete billing address", () => {
    expect(
      isProfileComplete(
        makeUserDoc({
          userType: "firma",
          billingAddress: {
            company: "ACME AG",
            street: "Bahnhofstrasse 1",
            zip: "8001",
            city: "Zürich",
          },
        }),
      ),
    ).toBe(true)
  })

  it("returns false for firma missing billing address entirely", () => {
    expect(
      isProfileComplete(makeUserDoc({ userType: "firma" })),
    ).toBe(false)
  })

  it("returns false for firma with null billing address", () => {
    expect(
      isProfileComplete(
        makeUserDoc({ userType: "firma", billingAddress: null }),
      ),
    ).toBe(false)
  })

  it("returns false for firma missing company", () => {
    expect(
      isProfileComplete(
        makeUserDoc({
          userType: "firma",
          billingAddress: {
            company: "",
            street: "Bahnhofstrasse 1",
            zip: "8001",
            city: "Zürich",
          },
        }),
      ),
    ).toBe(false)
  })

  it("returns false for firma missing street", () => {
    expect(
      isProfileComplete(
        makeUserDoc({
          userType: "firma",
          billingAddress: {
            company: "ACME AG",
            street: "",
            zip: "8001",
            city: "Zürich",
          },
        }),
      ),
    ).toBe(false)
  })

  it("returns false for firma missing zip", () => {
    expect(
      isProfileComplete(
        makeUserDoc({
          userType: "firma",
          billingAddress: {
            company: "ACME AG",
            street: "Bahnhofstrasse 1",
            zip: "",
            city: "Zürich",
          },
        }),
      ),
    ).toBe(false)
  })

  it("returns false for firma missing city", () => {
    expect(
      isProfileComplete(
        makeUserDoc({
          userType: "firma",
          billingAddress: {
            company: "ACME AG",
            street: "Bahnhofstrasse 1",
            zip: "8001",
            city: "",
          },
        }),
      ),
    ).toBe(false)
  })

  it("returns true for non-firma user without billing address", () => {
    expect(
      isProfileComplete(makeUserDoc({ userType: "erwachsen" })),
    ).toBe(true)
  })

  it("returns true for kind user without billing address", () => {
    expect(
      isProfileComplete(makeUserDoc({ userType: "kind" })),
    ).toBe(true)
  })
})
