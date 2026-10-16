// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import {
  USAGE_TYPE_DISCOUNTS,
  USAGE_TYPE_LABELS,
  USAGE_DISCOUNT_LABELS,
  USAGE_TYPE_INFO,
  USAGE_TYPE_ORDER,
  OWNER_ONLY_OTHERS_REASON,
  personUsageOptions,
  deriveVisitUsageType,
  machineUsageBlocked,
  usageDeclaration,
  usageDiscount,
  isMachineItem,
  isServiceItem,
  materialSectionLabels,
  type UsageType,
} from "./pricing"

// Issue #284: the discount table is the single authoritative source for
// the fractional per-usage-type waivers. These tests pin the exact table
// Marco + Mike agreed on so a regression in the multipliers fails loudly.
describe("USAGE_TYPE_DISCOUNTS (issue #284)", () => {
  it("matches the agreed multiplier table", () => {
    expect(USAGE_TYPE_DISCOUNTS).toEqual({
      regular: { entryFee: 1, machine: 1, material: 1, tip: 1 },
      ermaessigt: { entryFee: 0.5, machine: 1, material: 1, tip: 1 },
      materialbezug: { entryFee: 0, machine: 0, material: 1, tip: 1 },
      hangenmoos: { entryFee: 0, machine: 1, material: 1, tip: 1 },
      volunteering: { entryFee: 0, machine: 0, material: 1, tip: 1 },
      intern: { entryFee: 0, machine: 0, material: 0, tip: 1 },
    })
  })

  it("never discounts the tip for any usage type", () => {
    for (const ut of Object.keys(USAGE_TYPE_DISCOUNTS) as UsageType[]) {
      expect(usageDiscount(ut).tip).toBe(1)
    }
  })

  it("falls back to the regular (no-discount) row for unknown usage types", () => {
    expect(usageDiscount("nonsense" as UsageType)).toEqual(
      USAGE_TYPE_DISCOUNTS.regular,
    )
  })
})

describe("isMachineItem (issue #105)", () => {
  it("classifies items by explicit type, ignoring origin", () => {
    expect(isMachineItem({ type: "machine" })).toBe(true)
    expect(isMachineItem({ type: "material" })).toBe(false)
  })

  it("treats a missing type as material", () => {
    expect(isMachineItem({})).toBe(false)
    expect(isMachineItem({ type: null })).toBe(false)
  })
})

describe("service items (Dienstleistung, issue #685)", () => {
  it("are not machine usage, so Materialbezug stays selectable", () => {
    const brennen = { type: "service" }
    expect(isServiceItem(brennen)).toBe(true)
    const hasMachineUsage = [brennen].some(isMachineItem)
    expect(hasMachineUsage).toBe(false)
    expect(
      machineUsageBlocked([{ usageType: "materialbezug" }], hasMachineUsage),
    ).toBe(false)
  })

  it("name the material bucket after what it holds", () => {
    const material = { type: "material" }
    const untyped = {}
    const service = { type: "service" }
    expect(materialSectionLabels([]).title).toBe("Materialbezug")
    expect(materialSectionLabels([material, untyped])).toMatchObject({
      title: "Materialbezug",
      noneBilled: "kein Materialbezug",
    })
    expect(materialSectionLabels([service])).toMatchObject({
      title: "Dienstleistungen",
      waived: "Dienstleistungen",
      waivedVerb: "werden",
    })
    expect(materialSectionLabels([material, service]).title).toBe(
      "Material & Dienstleistungen",
    )
  })
})

describe("usage type labels (issue #284)", () => {
  it("labels volunteering as Freiwilligengruppe", () => {
    expect(USAGE_TYPE_LABELS.volunteering).toBe("Freiwilligengruppe")
  })

  it("has a discount reason label for every discounted usage type", () => {
    for (const ut of Object.keys(USAGE_TYPE_DISCOUNTS) as UsageType[]) {
      const d = usageDiscount(ut)
      const discounted =
        d.entryFee < 1 || d.machine < 1 || d.material < 1 || d.tip < 1
      if (discounted) {
        expect(USAGE_DISCOUNT_LABELS[ut], `label for ${ut}`).toBeTruthy()
      }
    }
  })
})

// Issue #570: the visitor-facing description of each usage type lives next
// to the discount table. Pin that the effect sentence names exactly the
// sections the multipliers waive, so retuning a multiplier without touching
// its description fails here instead of misinforming a visitor.
describe("USAGE_TYPE_INFO (issue #570)", () => {
  it("orders every usage type exactly once", () => {
    expect([...USAGE_TYPE_ORDER].sort()).toEqual(
      Object.keys(USAGE_TYPE_DISCOUNTS).sort(),
    )
    expect(USAGE_TYPE_ORDER[0]).toBe("regular")
  })

  it("keeps each effect sentence consistent with the discount row", () => {
    for (const ut of USAGE_TYPE_ORDER) {
      const d = USAGE_TYPE_DISCOUNTS[ut]
      const { effect } = USAGE_TYPE_INFO[ut]
      expect(effect !== "", `${ut} effect`).toBe(d.entryFee < 1)
      expect(/50%/.test(effect), `${ut} half fee`).toBe(d.entryFee === 0.5)
      // materialbezug's machine multiplier is a defensive 0 — machine usage
      // cannot occur there, so the sentence deliberately stays silent.
      if (ut !== "materialbezug") {
        expect(/Maschinen/.test(effect), `${ut} machine`).toBe(d.machine < 1)
      }
      expect(/Material/.test(effect), `${ut} material`).toBe(d.material < 1)
    }
  })

  it("marks exactly Freiwilligengruppe and Interne Nutzung as owner-only", () => {
    for (const ut of USAGE_TYPE_ORDER) {
      expect(USAGE_TYPE_INFO[ut].ownerOnly, ut).toBe(
        ut === "volunteering" || ut === "intern",
      )
    }
  })
})

// Issue #605: the Nutzungsart is chosen per person on the check-in.
describe("personUsageOptions (issue #605)", () => {
  it("offers the owner-only types on the identified person's line, last", () => {
    const options = personUsageOptions({
      isOwner: true,
      anonymous: false,
      othersPresent: false,
    })
    expect(options.map((o) => o.type)).toEqual(USAGE_TYPE_ORDER)
    expect(options.every((o) => o.disabledReason === undefined)).toBe(true)
    expect(USAGE_TYPE_ORDER.slice(-2)).toEqual(["volunteering", "intern"])
  })

  it("disables them, with the reason, while others are on the visit", () => {
    const options = personUsageOptions({
      isOwner: true,
      anonymous: false,
      othersPresent: true,
    })
    for (const o of options) {
      expect(o.disabledReason, o.type).toBe(
        o.type === "volunteering" || o.type === "intern"
          ? OWNER_ONLY_OTHERS_REASON
          : undefined,
      )
    }
  })

  it("never offers them to a further person or a guest check-in", () => {
    const common = ["regular", "materialbezug", "ermaessigt", "hangenmoos"]
    expect(
      personUsageOptions({ isOwner: false, anonymous: false, othersPresent: true }).map(
        (o) => o.type,
      ),
    ).toEqual(common)
    expect(
      personUsageOptions({ isOwner: true, anonymous: true, othersPresent: false }).map(
        (o) => o.type,
      ),
    ).toEqual(common)
  })

  it("keeps a rehydrated selection displayable", () => {
    expect(
      personUsageOptions({
        isOwner: false,
        anonymous: false,
        othersPresent: true,
        current: "intern",
      }).map((o) => o.type),
    ).toContain("intern")
  })
})

describe("deriveVisitUsageType (issue #605)", () => {
  it("takes the owner's Freiwilligengruppe / Interne Nutzung", () => {
    expect(
      deriveVisitUsageType([{ isOwner: true, usageType: "volunteering" }]),
    ).toBe("volunteering")
    expect(deriveVisitUsageType([{ isOwner: true, usageType: "intern" }])).toBe(
      "intern",
    )
  })

  it("is Begleitung only when every person has it", () => {
    expect(
      deriveVisitUsageType([
        { isOwner: true, usageType: "materialbezug" },
        { usageType: "materialbezug" },
      ]),
    ).toBe("materialbezug")
    expect(
      deriveVisitUsageType([
        { isOwner: true, usageType: "materialbezug" },
        { usageType: "regular" },
      ]),
    ).toBe("regular")
  })

  it("is regular for discounts that only touch the usage fee", () => {
    expect(
      deriveVisitUsageType([{ usageType: "ermaessigt" }, { usageType: "hangenmoos" }]),
    ).toBe("regular")
    expect(deriveVisitUsageType([])).toBe("regular")
  })

  it("an owner-only type on another line does not carry the visit", () => {
    expect(
      deriveVisitUsageType([{ isOwner: true }, { usageType: "intern" }]),
    ).toBe("regular")
  })

  it("falls back to the legacy top-level type for persons without one", () => {
    expect(deriveVisitUsageType([{ isOwner: true }], "intern")).toBe("intern")
    expect(deriveVisitUsageType([{}, {}], "materialbezug")).toBe("materialbezug")
  })
})

describe("machineUsageBlocked (issue #605)", () => {
  it("blocks machine time only when every person is on Begleitung", () => {
    const all = [{ usageType: "materialbezug" as const }, { usageType: "materialbezug" as const }]
    expect(machineUsageBlocked(all, true)).toBe(true)
    expect(machineUsageBlocked(all, false)).toBe(false)
    expect(
      machineUsageBlocked([...all, { usageType: "regular" as const }], true),
    ).toBe(false)
    expect(machineUsageBlocked([], true)).toBe(false)
  })
})

describe("usageDeclaration (issue #605)", () => {
  it("is null for regular and names the person otherwise", () => {
    expect(usageDeclaration("regular", { firstName: "Mia", isSelf: false })).toBeNull()
    expect(
      usageDeclaration("materialbezug", { firstName: "Mia", isSelf: false }),
    ).toBe("Mia arbeitet heute nicht selbst in der Werkstatt.")
    expect(
      usageDeclaration("materialbezug", { firstName: "Max", isSelf: true }),
    ).toBe("Du arbeitest heute nicht selbst in der Werkstatt.")
  })

  it("has a sentence for every discounted type", () => {
    for (const ut of USAGE_TYPE_ORDER) {
      const d = usageDeclaration(ut, { firstName: "Mia", isSelf: false })
      expect(d === null, ut).toBe(ut === "regular")
    }
  })
})
