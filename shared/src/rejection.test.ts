// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import {
  RejectionReason,
  rejectionCause,
  parseRejectionCause,
  rejectionCopy,
} from "./rejection"

describe("rejectionCause", () => {
  it("maps each reason to its stable URL cause code", () => {
    expect(rejectionCause(RejectionReason.Unspecified)).toBe("unspecified")
    expect(rejectionCause(RejectionReason.MissingPermission)).toBe(
      "missing_permission"
    )
    expect(rejectionCause(RejectionReason.StaleCheckout)).toBe("stale_checkout")
    expect(rejectionCause(RejectionReason.TokenUnknown)).toBe("token_unknown")
    expect(rejectionCause(RejectionReason.TokenDeactivated)).toBe(
      "token_deactivated"
    )
  })

  it("falls back to unspecified for an out-of-range number", () => {
    expect(rejectionCause(99)).toBe("unspecified")
  })
})

describe("parseRejectionCause", () => {
  it("round-trips a known cause", () => {
    expect(parseRejectionCause("stale_checkout")).toBe("stale_checkout")
    expect(parseRejectionCause("missing_permission")).toBe("missing_permission")
  })

  it("collapses unknown / missing values to unspecified", () => {
    expect(parseRejectionCause("bogus")).toBe("unspecified")
    expect(parseRejectionCause(undefined)).toBe("unspecified")
    expect(parseRejectionCause(null)).toBe("unspecified")
  })
})

describe("rejectionCopy", () => {
  it("uses the stale-checkout heading and interpolates the date", () => {
    const copy = rejectionCopy("stale_checkout", { date: "14.07.2026" })
    expect(copy.heading).toBe("Letzter Besuch noch offen")
    expect(copy.body).toContain("vom 14.07.2026")
    expect(copy.body).toContain("bevor du die Maschinen heute nutzt")
  })

  it("falls back to a date-less stale body when no date is supplied", () => {
    const copy = rejectionCopy("stale_checkout")
    expect(copy.heading).toBe("Letzter Besuch noch offen")
    expect(copy.body).not.toContain("vom")
  })

  it("renders distinct copy for missing-permission (not the stale text)", () => {
    const copy = rejectionCopy("missing_permission")
    expect(copy.heading).toBe("Berechtigung fehlt")
    expect(copy.body).toContain("Berechtigung")
    expect(copy.heading).not.toBe("Letzter Besuch noch offen")
  })

  it("renders a generic fallback for unspecified", () => {
    const copy = rejectionCopy("unspecified")
    expect(copy.heading).toBe("Nicht berechtigt")
    expect(copy.body.length).toBeGreaterThan(0)
  })
})
