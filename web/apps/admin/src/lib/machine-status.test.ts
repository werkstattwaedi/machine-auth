// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { Timestamp } from "firebase/firestore"
import { machineStatus } from "./machine-status"

describe("machineStatus", () => {
  it("is free when no block is set", () => {
    expect(machineStatus({})).toBe("free")
    expect(machineStatus({ blocked: null })).toBe("free")
  })

  it("distinguishes problem blocks from maintenance", () => {
    const base = { note: null, byName: null, at: Timestamp.now() }
    expect(machineStatus({ blocked: { ...base, kind: "problem" } })).toBe(
      "blocked",
    )
    expect(machineStatus({ blocked: { ...base, kind: "maintenance" } })).toBe(
      "maintenance",
    )
  })
})
