// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import { grantLine } from "./permissions-tab"

const names = new Map([["admin1", "Mike Schneider"]])
const at = (iso: string) => ({ toMillis: () => new Date(iso).getTime() })

describe("grantLine (ADM-16)", () => {
  it("says since when and by whom", () => {
    expect(
      grantLine(
        { permission: { id: "laser" }, grantedAt: at("2026-11-03T10:00:00Z"), grantedBy: { id: "admin1" }, source: "admin" },
        names,
      ),
    ).toBe("seit 03.11.2026 · von Mike Schneider")
  })

  it("names a course and an unknown granter", () => {
    expect(
      grantLine(
        { permission: { id: "laser" }, grantedAt: at("2026-11-03T10:00:00Z"), grantedBy: { id: "gone" }, source: "course" },
        names,
      ),
    ).toBe("seit 03.11.2026 · von unbekannt · aus einem Kurs")
  })

  it("says the date is unknown for a legacy grant", () => {
    expect(
      grantLine({ permission: { id: "laser" }, grantedAt: null, grantedBy: null, source: "legacy" }, names),
    ).toBe("seit unbekanntem Datum")
  })
})
