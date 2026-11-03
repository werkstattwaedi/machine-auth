// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import { dispatchSearch } from "./dispatch-search"

describe("dispatchSearch", () => {
  it("carries the old checkout's from onto the wizard step", () => {
    expect(dispatchSearch({ from: "legacy" })).toEqual({ from: "legacy" })
  })

  it("keeps the tag tap and normalises the kiosk flag", () => {
    expect(
      dispatchSearch({ picc: "p", cmac: "c", kiosk: "1", from: "legacy" }),
    ).toEqual({ picc: "p", cmac: "c", kiosk: "", from: "legacy" })
  })

  it("drops absent and empty params", () => {
    expect(dispatchSearch({ picc: "", cmac: undefined, from: "" })).toEqual({})
  })
})
