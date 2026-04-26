// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect, vi } from "vitest"

// Prevent Firebase initialization (no API key in test env).
vi.mock("./firebase", () => ({ db: {}, auth: {}, functions: {} }))

import {
  getSortedWorkshops,
  getUnitLabel,
  getShortUnit,
  validatePricingConfig,
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
    // SLA resin is priced per liter (unitPrice = CHF/l on each resin entry).
    ["sla", "Liter"],
  ] as [PricingModel, string][])("%s → %s", (model, expected) => {
    expect(getUnitLabel(config, model)).toBe(expected)
  })

  it("falls back to defaults when labels missing", () => {
    const emptyConfig = { labels: {} } as unknown as PricingConfig
    expect(getUnitLabel(emptyConfig, "time")).toBe("Std.")
    expect(getUnitLabel(emptyConfig, "area")).toBe("m²")
    expect(getUnitLabel(emptyConfig, "sla")).toBe("l")
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
    ["sla", "l"],
  ] as [PricingModel, string][])("%s → %s", (model, expected) => {
    expect(getShortUnit(model)).toBe(expected)
  })
})

describe("validatePricingConfig (issue #149)", () => {
  // The fail-loud check that gates the checkout UI from rendering with a
  // malformed `config/pricing` document. Each invalid case must return a
  // non-null error string identifying the offending field.
  const valid: unknown = {
    entryFees: {
      erwachsen: { regular: 5, materialbezug: 0, intern: 0, hangenmoos: 0 },
      kind: { regular: 2.5, materialbezug: 0, intern: 0, hangenmoos: 0 },
      firma: { regular: 5, materialbezug: 0, intern: 0, hangenmoos: 0 },
    },
    workshops: { holz: { label: "Holz", order: 1 } },
    labels: { units: { h: "Std." }, discounts: { none: "" } },
    slaLayerPrice: { none: 0.001, member: 0.001, intern: 0 },
  }

  it("returns null for a valid config", () => {
    expect(validatePricingConfig(valid)).toBeNull()
  })

  it("rejects a missing document (null)", () => {
    expect(validatePricingConfig(null)).toMatch(/missing/)
  })

  it("rejects a non-object value", () => {
    expect(validatePricingConfig("not-a-doc")).toMatch(/missing|not an object/)
  })

  it("rejects a config with no entryFees", () => {
    const broken = { ...(valid as object), entryFees: undefined }
    expect(validatePricingConfig(broken)).toMatch(/entryFees/)
  })

  it("rejects a config with a missing user type row", () => {
    const broken = {
      ...(valid as object),
      entryFees: {
        erwachsen: { regular: 5, materialbezug: 0, intern: 0, hangenmoos: 0 },
        kind: { regular: 2.5, materialbezug: 0, intern: 0, hangenmoos: 0 },
        // firma missing
      },
    }
    expect(validatePricingConfig(broken)).toMatch(/firma/)
  })

  it("rejects a config with a missing usage type column", () => {
    const broken = {
      ...(valid as object),
      entryFees: {
        erwachsen: { regular: 5, materialbezug: 0, intern: 0 /* hangenmoos missing */ },
        kind: { regular: 2.5, materialbezug: 0, intern: 0, hangenmoos: 0 },
        firma: { regular: 5, materialbezug: 0, intern: 0, hangenmoos: 0 },
      },
    }
    expect(validatePricingConfig(broken)).toMatch(/hangenmoos/)
  })

  it("rejects a config with non-numeric fee", () => {
    const broken = {
      ...(valid as object),
      entryFees: {
        erwachsen: { regular: "free", materialbezug: 0, intern: 0, hangenmoos: 0 },
        kind: { regular: 2.5, materialbezug: 0, intern: 0, hangenmoos: 0 },
        firma: { regular: 5, materialbezug: 0, intern: 0, hangenmoos: 0 },
      },
    }
    expect(validatePricingConfig(broken)).toMatch(/erwachsen.*regular.*number/)
  })

  it("rejects a config with no slaLayerPrice", () => {
    const broken = { ...(valid as object), slaLayerPrice: undefined }
    expect(validatePricingConfig(broken)).toMatch(/slaLayerPrice/)
  })

  it("rejects slaLayerPrice with a missing discount level", () => {
    const broken = { ...(valid as object), slaLayerPrice: { none: 0.001, member: 0.001 } }
    expect(validatePricingConfig(broken)).toMatch(/intern/)
  })
})
