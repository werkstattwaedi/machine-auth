// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"

import { maskEmail, maskPhone } from "./contact-mask"

describe("maskEmail", () => {
  it("keeps two characters of the local part and the host, plus the TLD", () => {
    expect(maskEmail("michschn@gmail.com")).toBe("mi•••@gm•••.com")
    expect(maskEmail("badge2@test.com")).toBe("ba•••@te•••.com")
  })

  it("keeps short parts as they are", () => {
    expect(maskEmail("ab@c.ch")).toBe("ab•••@c•••.ch")
  })

  it("masks the whole value when there is no local part", () => {
    expect(maskEmail("no-at-sign")).toBe("•••")
    expect(maskEmail("@example.com")).toBe("•••")
  })
})

describe("maskPhone", () => {
  it("keeps the country code, the prefix and the last two digits", () => {
    expect(maskPhone("+41791234528")).toBe("+41 79 ••• •• 28")
  })

  it("masks a number too short to split", () => {
    expect(maskPhone("+4179")).toBe("•••")
  })
})
