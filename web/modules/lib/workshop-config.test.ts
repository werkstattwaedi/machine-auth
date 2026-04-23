// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest"

// Prevent Firebase initialization (no API key in test env).
vi.mock("./firebase", () => ({ db: {}, auth: {}, functions: {} }))

import {
  getSortedWorkshops,
  getUnitLabel,
  getShortUnit,
  type PricingConfig,
  type PricingModel,
} from "./workshop-config"

describe("getSortedWorkshops", () => {
  it("sorts workshops by order field", () => {
    const config = {
      workshops: {
        metall: { label: "Metall", order: 2 },
        holz: { label: "Holz", order: 1 },
        textil: { label: "Textil", order: 3 },
      },
    } as unknown as PricingConfig

    const sorted = getSortedWorkshops(config)
    expect(sorted.map(([id]) => id)).toEqual(["holz", "metall", "textil"])
  })

  it("handles empty workshops", () => {
    const config = { workshops: {} } as unknown as PricingConfig
    expect(getSortedWorkshops(config)).toEqual([])
  })
})

describe("getUnitLabel", () => {
  const config: PricingConfig = {
    labels: {
      units: { h: "Stunden", m2: "Quadratmeter", m: "Meter", stk: "Stück", kg: "Kilogramm", chf: "Franken", l: "Liter" },
      discounts: { none: "", member: "", intern: "" },
    },
  } as unknown as PricingConfig

  it.each([
    ["time", "Stunden"],
    ["area", "Quadratmeter"],
    ["length", "Meter"],
    ["count", "Stück"],
    ["weight", "Kilogramm"],
    ["direct", "Franken"],
    // SLA resin is priced per liter (unitPrice = CHF/L on each resin entry).
    ["sla", "Liter"],
  ] as [PricingModel, string][])("%s → %s", (model, expected) => {
    expect(getUnitLabel(config, model)).toBe(expected)
  })

  it("falls back to defaults when labels missing", () => {
    const emptyConfig = { labels: {} } as unknown as PricingConfig
    expect(getUnitLabel(emptyConfig, "time")).toBe("Std.")
    expect(getUnitLabel(emptyConfig, "area")).toBe("m²")
    expect(getUnitLabel(emptyConfig, "sla")).toBe("L")
  })
})

describe("getShortUnit", () => {
  it.each([
    ["time", "h"],
    ["area", "m²"],
    ["length", "m"],
    ["count", "Stk."],
    ["weight", "kg"],
    ["direct", "CHF"],
    ["sla", "L"],
  ] as [PricingModel, string][])("%s → %s", (model, expected) => {
    expect(getShortUnit(model)).toBe(expected)
  })
})
