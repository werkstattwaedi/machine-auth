// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { decideKioskOverlay } from "./kiosk-navigation"

const ALLOWLIST = ["https://werkstattwaedi.ch"] as const

describe("decideKioskOverlay", () => {
  it("opens the Nutzungsbestimmungen page (allowlisted origin)", () => {
    expect(
      decideKioskOverlay("https://werkstattwaedi.ch/nutzungsbestimmungen", {
        allowedOverlayOrigins: ALLOWLIST,
      })
    ).toEqual({ open: true })
  })

  it("opens any path on an allowlisted origin", () => {
    expect(
      decideKioskOverlay("https://werkstattwaedi.ch/foo/bar?x=1#frag", {
        allowedOverlayOrigins: ALLOWLIST,
      })
    ).toEqual({ open: true })
  })

  it("denies an off-origin, non-allowlisted URL (not a generic launcher)", () => {
    expect(
      decideKioskOverlay("https://evil.example/x", {
        allowedOverlayOrigins: ALLOWLIST,
      })
    ).toEqual({ open: false })
  })

  it("denies a same-host URL on a different port", () => {
    expect(
      decideKioskOverlay("https://werkstattwaedi.ch:8443/x", {
        allowedOverlayOrigins: ALLOWLIST,
      })
    ).toEqual({ open: false })
  })

  it("denies a same-host URL on a different scheme", () => {
    expect(
      decideKioskOverlay("http://werkstattwaedi.ch/x", {
        allowedOverlayOrigins: ALLOWLIST,
      })
    ).toEqual({ open: false })
  })

  it("denies a malformed URL without throwing", () => {
    expect(
      decideKioskOverlay("not a url", { allowedOverlayOrigins: ALLOWLIST })
    ).toEqual({ open: false })
  })

  it("denies everything when the allowlist is empty", () => {
    expect(
      decideKioskOverlay("https://werkstattwaedi.ch/nutzungsbestimmungen", {
        allowedOverlayOrigins: [],
      })
    ).toEqual({ open: false })
  })
})
