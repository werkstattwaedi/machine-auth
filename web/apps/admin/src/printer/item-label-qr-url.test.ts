// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Regression coverage for issue #375: item label QR codes were generated
 * without the `https://` scheme (`checkout.werkstattwaedi.ch/visit/add/item/9011`),
 * which the checkout QR parser rejects as "not a OWW qr code" because it only
 * accepts fully-schemed URLs or bare paths. The generated URL must therefore
 * include the scheme. (We deliberately do NOT add a scheme-less fallback to the
 * parser — the fix is at generation time only.)
 */

import { describe, it, expect } from "vitest"
import { buildItemLabelQrUrl } from "./item-label-qr-url"

describe("buildItemLabelQrUrl", () => {
  it("prepends the https:// scheme so the checkout parser accepts it", () => {
    const url = buildItemLabelQrUrl("checkout.werkstattwaedi.ch", "9011")
    expect(url).toBe("https://checkout.werkstattwaedi.ch/visit/add/item/9011")
  })

  it("produces a URL that parses to a valid absolute URL with the host preserved", () => {
    // The pre-fix scheme-less string threw on `new URL(...)`; this asserts the
    // scheme is present by relying on the WHATWG URL parser.
    const parsed = new URL(buildItemLabelQrUrl("checkout.werkstattwaedi.ch", "9011"))
    expect(parsed.protocol).toBe("https:")
    expect(parsed.host).toBe("checkout.werkstattwaedi.ch")
    expect(parsed.pathname).toBe("/visit/add/item/9011")
  })

  it("works with a localhost dev domain that includes a port", () => {
    expect(buildItemLabelQrUrl("localhost:5173", "6011")).toBe(
      "https://localhost:5173/visit/add/item/6011",
    )
  })
})
