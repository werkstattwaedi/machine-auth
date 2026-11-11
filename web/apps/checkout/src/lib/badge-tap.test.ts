// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import { isOwnDeviceTap, ownDeviceTapLoginUrl } from "./badge-tap"

describe("isOwnDeviceTap", () => {
  it("is a tap without the kiosk flag", () => {
    expect(isOwnDeviceTap({ picc: "p", cmac: "c" })).toBe(true)
  })

  it("is not a kiosk tap", () => {
    expect(isOwnDeviceTap({ picc: "p", cmac: "c", kiosk: "" })).toBe(false)
  })

  it("is not a visit without a tap", () => {
    expect(isOwnDeviceTap({})).toBe(false)
    expect(isOwnDeviceTap({ picc: "p" })).toBe(false)
  })
})

describe("ownDeviceTapLoginUrl", () => {
  it("moves a tap on the tag host to the checkout domain's sign-in", () => {
    expect(
      ownDeviceTapLoginUrl(
        { host: "id.werkstattwaedi.ch", protocol: "https:" },
        "checkout.werkstattwaedi.ch",
      ),
    ).toBe("https://checkout.werkstattwaedi.ch/login?from=badge")
  })

  it("stays in the app on the checkout domain", () => {
    expect(
      ownDeviceTapLoginUrl(
        { host: "checkout.werkstattwaedi.ch", protocol: "https:" },
        "checkout.werkstattwaedi.ch",
      ),
    ).toBeNull()
  })
})
