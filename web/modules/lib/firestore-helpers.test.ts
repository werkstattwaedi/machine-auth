// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest"

// Prevent Firebase initialization (no API key in test env).
vi.mock("./firebase", () => ({ db: {}, auth: {}, functions: {} }))

import { refId } from "./firestore-helpers"

describe("refId", () => {
  it("extracts ID from a path string", () => {
    expect(refId("/users/abc123")).toBe("abc123")
  })

  it("extracts ID from a nested path string", () => {
    expect(refId("/checkouts/co1/items/item1")).toBe("item1")
  })

  it("handles a plain ID string (no slashes)", () => {
    expect(refId("abc123")).toBe("abc123")
  })

  it("extracts ID from an object with id property", () => {
    expect(refId({ id: "xyz789" })).toBe("xyz789")
  })

  it("handles empty string", () => {
    expect(refId("")).toBe("")
  })
})
