// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest"
import { parseSwissPhone } from "./phone"

describe("parseSwissPhone", () => {
  it("returns empty for blank input", async () => {
    expect(await parseSwissPhone("")).toEqual({ ok: false, reason: "empty" })
    expect(await parseSwissPhone(null)).toEqual({ ok: false, reason: "empty" })
    expect(await parseSwissPhone(undefined)).toEqual({
      ok: false,
      reason: "empty",
    })
    expect(await parseSwissPhone("   ")).toEqual({ ok: false, reason: "empty" })
  })

  it("normalises Swiss mobile numbers to E.164", async () => {
    expect(await parseSwissPhone("+41 79 123 45 67")).toEqual({
      ok: true,
      e164: "+41791234567",
    })
    expect(await parseSwissPhone("0791234567")).toEqual({
      ok: true,
      e164: "+41791234567",
    })
    expect(await parseSwissPhone("079 123 45 67")).toEqual({
      ok: true,
      e164: "+41791234567",
    })
    expect(await parseSwissPhone("+41791234567")).toEqual({
      ok: true,
      e164: "+41791234567",
    })
  })

  it("normalises Swiss landline numbers to E.164", async () => {
    expect(await parseSwissPhone("044 123 45 67")).toEqual({
      ok: true,
      e164: "+41441234567",
    })
    expect(await parseSwissPhone("+41 44 123 45 67")).toEqual({
      ok: true,
      e164: "+41441234567",
    })
  })

  it("rejects garbage input as invalid (issue #298 — `adfasdf`)", async () => {
    expect(await parseSwissPhone("asdfasdf")).toEqual({
      ok: false,
      reason: "invalid",
    })
    expect(await parseSwissPhone("adfasdf")).toEqual({
      ok: false,
      reason: "invalid",
    })
  })

  it("rejects numbers that are too short or malformed", async () => {
    expect(await parseSwissPhone("12345")).toEqual({
      ok: false,
      reason: "invalid",
    })
    expect(await parseSwissPhone("07")).toEqual({
      ok: false,
      reason: "invalid",
    })
  })
})
