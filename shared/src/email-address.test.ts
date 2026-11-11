// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"

import { isValidEmailAddress } from "./email-address"

describe("isValidEmailAddress", () => {
  it("accepts ordinary addresses", () => {
    for (const ok of [
      "anna@example.ch",
      "anna.muster+oww@mail.example.co.uk",
      "a_b-c@sub-domain.example.ch",
    ]) {
      expect(isValidEmailAddress(ok), ok).toBe(true)
    }
  })

  it("refuses what a mail provider would reject at send time", () => {
    for (const bad of [
      "anna@example", // no dot in the domain
      "anna@@example.ch",
      "anna@exa mple.ch",
      "anna,b@example.ch",
      "<anna@example.ch>",
      "\"anna\"@example.ch",
      "anna@example..ch",
      "anna@-example.ch",
      "anna@example-.ch",
      "anna..b@example.ch",
      ".anna@example.ch",
      "anna.@example.ch",
      "änna@example.ch",
      "anna@exämple.ch",
      "anna@example.ch.",
    ]) {
      expect(isValidEmailAddress(bad), bad).toBe(false)
    }
  })
})
