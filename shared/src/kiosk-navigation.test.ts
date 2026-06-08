// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  decideKioskOverlay,
  detectKioskPaymentConfirmation,
  RAISENOW_PAYLINK_ORIGIN,
} from "./kiosk-navigation"

const OVERLAY_ALLOWLIST = [
  "https://werkstattwaedi.ch",
  RAISENOW_PAYLINK_ORIGIN,
] as const

describe("decideKioskOverlay", () => {
  it("opens an allowlisted off-origin URL in the overlay", () => {
    expect(
      decideKioskOverlay("https://werkstattwaedi.ch/nutzungsbestimmungen", {
        allowedOverlayOrigins: OVERLAY_ALLOWLIST,
      })
    ).toEqual({ open: true })
  })

  it("opens the RaiseNow paylink in the overlay", () => {
    expect(
      decideKioskOverlay(
        "https://pay.raisenow.io/hxnqv?amount.values=0.50&lng=de",
        { allowedOverlayOrigins: OVERLAY_ALLOWLIST }
      )
    ).toEqual({ open: true })
  })

  it("opens any path on an allowlisted origin", () => {
    expect(
      decideKioskOverlay("https://werkstattwaedi.ch/foo/bar?x=1#frag", {
        allowedOverlayOrigins: OVERLAY_ALLOWLIST,
      })
    ).toEqual({ open: true })
  })

  it("denies a same-host URL on a different port", () => {
    expect(
      decideKioskOverlay("https://werkstattwaedi.ch:8443/x", {
        allowedOverlayOrigins: OVERLAY_ALLOWLIST,
      })
    ).toEqual({ open: false })
  })

  it("denies a same-host URL on a different scheme", () => {
    expect(
      decideKioskOverlay("http://werkstattwaedi.ch/x", {
        allowedOverlayOrigins: OVERLAY_ALLOWLIST,
      })
    ).toEqual({ open: false })
  })

  it("matches on origin, not on a substring of the host", () => {
    // pay.raisenow.io.evil.example must NOT match the raisenow origin.
    expect(
      decideKioskOverlay("https://pay.raisenow.io.evil.example/x", {
        allowedOverlayOrigins: OVERLAY_ALLOWLIST,
      })
    ).toEqual({ open: false })
  })

  it("denies a malformed URL without throwing", () => {
    expect(
      decideKioskOverlay("not a url", {
        allowedOverlayOrigins: OVERLAY_ALLOWLIST,
      })
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

describe("detectKioskPaymentConfirmation", () => {
  // Real URLs from the issue (#416).
  const payUrl =
    "https://pay.raisenow.io/hxnqv?amount.values=0.50&amount.custom=false" +
    "&reference.creditor.value=RF57004200019&supporter.first_name.value=Mike" +
    "&supporter.last_name.value=Schneider&supporter.email.value=michschn%40gmail.com&lng=de"
  const confirmedUrl =
    payUrl +
    "&rnw-view=payment_result&epms_payment_uuid=ef247e5e-6325-4a43-8791-f4a94fbc7e90"

  it("does not mark the bare paylink as paid", () => {
    expect(detectKioskPaymentConfirmation(payUrl)).toEqual({
      paid: false,
      paymentUuid: null,
    })
  })

  it("marks paid and returns the uuid on the payment_result URL", () => {
    expect(detectKioskPaymentConfirmation(confirmedUrl)).toEqual({
      paid: true,
      paymentUuid: "ef247e5e-6325-4a43-8791-f4a94fbc7e90",
    })
  })

  it("requires the epms_payment_uuid marker (rnw-view alone is not paid)", () => {
    expect(
      detectKioskPaymentConfirmation(payUrl + "&rnw-view=payment_result")
    ).toEqual({ paid: false, paymentUuid: null })
  })

  it("requires a non-empty epms_payment_uuid", () => {
    expect(
      detectKioskPaymentConfirmation(
        payUrl + "&rnw-view=payment_result&epms_payment_uuid="
      )
    ).toEqual({ paid: false, paymentUuid: null })
  })

  it("ignores the markers on an off-origin URL", () => {
    expect(
      detectKioskPaymentConfirmation(
        "https://evil.example/x?rnw-view=payment_result&epms_payment_uuid=abc"
      )
    ).toEqual({ paid: false, paymentUuid: null })
  })

  it("treats a malformed URL as not paid", () => {
    expect(detectKioskPaymentConfirmation("not a url")).toEqual({
      paid: false,
      paymentUuid: null,
    })
  })
})
