// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import {
  billBaseNumber,
  billRevision,
  currency,
  formatBelegNumber,

  formatBillReference,
  formatCHF,
  formatDate,
  formatDateTime,
  formatInvoiceNumber,
  formatRelativeTime,
  locale,
} from "./format"

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

// Stored numbers are base × 10 + revision digit (ADR-0042): 50 is bill 5,
// original; 51 is its first correction.
describe("bill reference formatting (#405, ADR-0042)", () => {
  it("formatInvoiceNumber pads the base to RE-XXXXXX", () => {
    expect(formatInvoiceNumber(50)).toBe("RE-000005")
    expect(formatInvoiceNumber(1234560)).toBe("RE-123456")
    expect(formatInvoiceNumber(42000010)).toBe("RE-4200001")
  })

  it("appends the revision suffix for corrected re-issues", () => {
    expect(formatInvoiceNumber(51)).toBe("RE-000005-2")
    expect(formatInvoiceNumber(42000011)).toBe("RE-4200001-2")
    expect(formatInvoiceNumber(42000019)).toBe("RE-4200001-10")
    expect(formatBelegNumber(51)).toBe("BL-000005-2")
  })

  it("formatBelegNumber pads to BL-XXXXXX", () => {
    expect(formatBelegNumber(50)).toBe("BL-000005")
    expect(formatBelegNumber(420)).toBe("BL-000042")
  })

  it("formatBillReference uses BL- for a Beleg and RE- otherwise", () => {
    expect(formatBillReference(70, "beleg")).toBe("BL-000007")
    expect(formatBillReference(70, "invoice")).toBe("RE-000007")
    // Missing kind (legacy doc) is treated as an invoice.
    expect(formatBillReference(70, undefined)).toBe("RE-000007")
  })

  it("billBaseNumber / billRevision split the stored number", () => {
    expect(billBaseNumber(42000011)).toBe(4200001)
    expect(billRevision(42000010)).toBe(1)
    expect(billRevision(42000011)).toBe(2)
    expect(billRevision(42000019)).toBe(10)
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

describe("formatRelativeTime", () => {
  const now = new Date(2026, 5, 14, 12, 0, 0)

  it("returns 'gerade eben' for instants under a minute ago", () => {
    expect(formatRelativeTime(new Date(2026, 5, 14, 11, 59, 30), now)).toBe(
      "gerade eben",
    )
  })

  it("reports minutes", () => {
    const result = formatRelativeTime(new Date(2026, 5, 14, 11, 35), now)
    expect(result).toMatch(/25/)
    expect(result.toLowerCase()).toContain("vor")
  })

  it("reports hours", () => {
    const result = formatRelativeTime(new Date(2026, 5, 14, 9, 0), now)
    expect(result).toMatch(/3/)
  })

  it("reports days", () => {
    const result = formatRelativeTime(new Date(2026, 5, 12, 12, 0), now)
    expect(result).toMatch(/2/)
    expect(result.toLowerCase()).toContain("tag")
  })

  it("accepts a Firestore-like Timestamp", () => {
    const ts = { toDate: () => new Date(2026, 5, 12, 12, 0) }
    expect(formatRelativeTime(ts, now)).toMatch(/2/)
  })

  it("returns dash for null", () => {
    expect(formatRelativeTime(null, now)).toBe("–")
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
