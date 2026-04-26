// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { currency, formatCHF, formatDate, formatDateTime, locale } from "./format"

describe("formatCHF", () => {
  it("formats whole numbers", () => {
    expect(formatCHF(15)).toMatch(/15/)
    expect(formatCHF(15)).toMatch(/CHF/)
  })

  it("formats decimals", () => {
    expect(formatCHF(7.5)).toMatch(/7/)
  })

  it("formats zero", () => {
    expect(formatCHF(0)).toMatch(/0/)
  })
})

describe("formatDate", () => {
  it("formats a Date object", () => {
    const date = new Date(2025, 0, 15) // Jan 15, 2025
    const result = formatDate(date)
    expect(result).toMatch(/15/)
    expect(result).toMatch(/01/)
    expect(result).toMatch(/2025/)
  })

  it("formats a Firestore-like Timestamp", () => {
    const timestamp = { toDate: () => new Date(2025, 5, 1) }
    const result = formatDate(timestamp)
    expect(result).toMatch(/01/)
    expect(result).toMatch(/06/)
    expect(result).toMatch(/2025/)
  })

  it("returns dash for null", () => {
    expect(formatDate(null)).toBe("–")
  })

  it("returns dash for undefined", () => {
    expect(formatDate(undefined)).toBe("–")
  })
})

describe("formatDateTime", () => {
  it("formats a Date with time", () => {
    const date = new Date(2025, 0, 15, 14, 30)
    const result = formatDateTime(date)
    expect(result).toMatch(/15/)
    expect(result).toMatch(/14/)
    expect(result).toMatch(/30/)
  })

  it("returns dash for null", () => {
    expect(formatDateTime(null)).toBe("–")
  })
})

describe("env-driven constants (issue #149)", () => {
  // The module reads VITE_LOCALE and VITE_CURRENCY at load time and exports
  // them as `locale` / `currency`. The fail-loud check happens during
  // import — if either env var were missing, this test file would not even
  // load. We verify the exported values match what `.env.development`
  // declares so callers (e.g. `getShortUnit`) see consistent values.
  it("exports locale from VITE_LOCALE", () => {
    expect(locale).toBe(import.meta.env.VITE_LOCALE)
    expect(locale.length).toBeGreaterThan(0)
  })

  it("exports currency from VITE_CURRENCY", () => {
    expect(currency).toBe(import.meta.env.VITE_CURRENCY)
    expect(currency.length).toBeGreaterThan(0)
  })
})
