// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * CHK-51 (ADR-0053): the owner's line only ever holds a usage type their
 * Workspace groups offer — a volunteer lands on Freiwilligengruppe, an
 * account outside a group drops back to Reguläre Nutzung.
 */

import { describe, expect, it } from "vitest"
import { ownerUsageCorrection } from "./wizard-context"
import type { UsageType } from "@modules/lib/pricing"

const owner = (usageType: UsageType) => ({ id: "p1", userId: "u1", usageType })
const visitor = { id: "p2", userId: null, usageType: "regular" as UsageType }

describe("ownerUsageCorrection", () => {
  it("moves a volunteer's pre-filled line to Freiwilligengruppe", () => {
    expect(ownerUsageCorrection([owner("regular")], "u1", ["volunteering"])).toEqual({
      id: "p1",
      usageType: "volunteering",
    })
  })

  it("keeps a volunteer on Interne Nutzung when they are in that group too", () => {
    expect(ownerUsageCorrection([owner("intern")], "u1", ["volunteering", "intern"])).toBeNull()
  })

  it("drops a group type the account is no longer in", () => {
    expect(ownerUsageCorrection([owner("volunteering")], "u1", [])).toEqual({
      id: "p1",
      usageType: "regular",
    })
  })

  it("leaves Interne Nutzung next to a visitor for the check-in to show (CHK-52)", () => {
    expect(ownerUsageCorrection([owner("intern"), visitor], "u1", ["intern"])).toBeNull()
  })

  it("leaves everyone else alone", () => {
    expect(ownerUsageCorrection([owner("ermaessigt")], "u1", [])).toBeNull()
    expect(ownerUsageCorrection([visitor], "u1", ["volunteering"])).toBeNull()
    expect(ownerUsageCorrection([owner("regular")], null, ["volunteering"])).toBeNull()
  })
})
