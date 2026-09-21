// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import {
  USAGE_TYPE_DISCOUNTS,
  USAGE_TYPE_LABELS,
  USAGE_DISCOUNT_LABELS,
  USAGE_TYPE_INFO,
  USAGE_TYPE_ORDER,
  MATERIALBEZUG_MACHINE_REASON,
  selectableUsageTypes,
  usageTypeOptions,
  resolveUsageType,
  usageDiscount,
  isMachineItem,
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

  it("only regular has no declaration; audits only on KulturLegi + Hangenmoos", () => {
    for (const ut of USAGE_TYPE_ORDER) {
      const info = USAGE_TYPE_INFO[ut]
      expect(info.declaration === null).toBe(ut === "regular")
      expect(/stichprobenweise/.test(info.declaration ?? "")).toBe(
        ut === "ermaessigt" || ut === "hangenmoos",
      )
    }
  })

  it("hides the account-only types from anonymous checkouts", () => {
    expect(selectableUsageTypes({ anonymous: false })).toEqual(
      USAGE_TYPE_ORDER,
    )
    expect(selectableUsageTypes({ anonymous: true })).toEqual([
      "regular",
      "ermaessigt",
      "hangenmoos",
      "materialbezug",
    ])
    // A rehydrated account-only selection stays displayable.
    expect(
      selectableUsageTypes({ anonymous: true, current: "intern" }),
    ).toContain("intern")
  })
})

// Issue #628: „Nur Materialbezug" + machine usage is rejected by the server
// (`assertUsageTypeAllowed`), so the checkout must not offer it as
// selectable — and must never submit it.
describe("usageTypeOptions / resolveUsageType (issue #628)", () => {
  it("disables only materialbezug, with the reason, when the cart has machine usage", () => {
    const options = usageTypeOptions({ anonymous: false, hasMachineUsage: true })
    expect(options.map((o) => o.type)).toEqual(USAGE_TYPE_ORDER)
    for (const o of options) {
      if (o.type === "materialbezug") {
        expect(o.disabledReason).toBe(MATERIALBEZUG_MACHINE_REASON)
      } else {
        expect(o.disabledReason, o.type).toBeUndefined()
      }
    }
  })

  it("disables nothing without machine usage", () => {
    const options = usageTypeOptions({ anonymous: false, hasMachineUsage: false })
    expect(options.map((o) => o.type)).toEqual(USAGE_TYPE_ORDER)
    expect(options.every((o) => o.disabledReason === undefined)).toBe(true)
  })

  it("keeps the anonymous filter and the rehydrated `current`", () => {
    expect(
      usageTypeOptions({ anonymous: true, hasMachineUsage: true }).map(
        (o) => o.type,
      ),
    ).toEqual(selectableUsageTypes({ anonymous: true }))
    const withCurrent = usageTypeOptions({
      anonymous: true,
      current: "intern",
      hasMachineUsage: true,
    })
    expect(withCurrent.map((o) => o.type)).toContain("intern")
    // A rehydrated materialbezug stays displayable but is still disabled.
    const rehydrated = usageTypeOptions({
      anonymous: true,
      current: "materialbezug",
      hasMachineUsage: true,
    })
    expect(rehydrated.find((o) => o.type === "materialbezug")?.disabledReason).toBe(
      MATERIALBEZUG_MACHINE_REASON,
    )
  })

  it("resolves materialbezug + machine usage to regular, everything else unchanged", () => {
    expect(resolveUsageType("materialbezug", { hasMachineUsage: true })).toBe(
      "regular",
    )
    for (const ut of USAGE_TYPE_ORDER) {
      expect(resolveUsageType(ut, { hasMachineUsage: false }), ut).toBe(ut)
      if (ut !== "materialbezug") {
        expect(resolveUsageType(ut, { hasMachineUsage: true }), ut).toBe(ut)
      }
    }
  })
})
