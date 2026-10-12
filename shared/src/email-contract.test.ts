// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  BILL_DOCUMENTS,
  EMAIL_CONTRACT,
  MAIL_NAMES,
  billMail,
  mailCombinations,
  templateAlias,
} from "./email-contract"
import { PAYMENT_METHODS } from "./payment-methods"

describe("templateAlias", () => {
  it("prefixes the environment", () => {
    expect(templateAlias("prod", "login", {})).toBe("prod-login")
    expect(templateAlias("staging", "bill-receipt", {})).toBe("staging-bill-receipt")
  })

  it("never names a payment method", () => {
    for (const mail of MAIL_NAMES) {
      for (const dims of mailCombinations(mail)) {
        const segments = templateAlias("prod", mail, dims as never).split("-")
        for (const method of [...PAYMENT_METHODS, "twint"]) {
          expect(segments).not.toContain(method)
        }
      }
    }
  })
})

describe("billMail", () => {
  it("maps every bill document to a contract mail", () => {
    for (const document of BILL_DOCUMENTS) {
      expect(EMAIL_CONTRACT[billMail(document)]).toBeDefined()
    }
  })
})

describe("mailCombinations", () => {
  it("yields one empty combination for a mail without dimensions", () => {
    expect(mailCombinations("login")).toEqual([{}])
  })
})

describe("EMAIL_CONTRACT", () => {
  it("declares each variable once, in Resend's placeholder alphabet", () => {
    for (const mail of MAIL_NAMES) {
      const vars: readonly string[] = EMAIL_CONTRACT[mail].variables
      expect(new Set(vars).size).toBe(vars.length)
      for (const v of vars) expect(v).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })
})
