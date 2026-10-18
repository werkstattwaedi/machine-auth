// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest"
import {
  AGGREGATED_PAYMENT_METHODS,
  BILL_DOCUMENT_INFO,
  BILL_DOCUMENT_TYPES,
  awaitsSammelrechnung,
  billDocumentOf,
  billMailFor,
  billPaymentMethodOf,
  documentFor,
  isCollectedBeleg,
} from "./bill-document"
import { BILL_MAILS } from "./email-contract"

describe("documentFor", () => {
  it("makes every document that asks for no payment a Beleg", () => {
    expect(documentFor("monthly")).toBe("beleg")
    expect(documentFor("raisenow")).toBe("beleg")
    expect(documentFor("free")).toBe("beleg")
  })

  it("gives a payment the provider confirmed a Quittung", () => {
    expect(documentFor("wallee_terminal")).toBe("quittung")
  })

  it("keeps the QR-Rechnung and an uncommitted bill a Rechnung", () => {
    expect(documentFor("rechnung")).toBe("rechnung")
    expect(documentFor(null)).toBe("rechnung")
  })

  it("names the monthly aggregate a Sammelrechnung", () => {
    expect(documentFor("rechnung", { isSammelrechnung: true })).toBe("sammelrechnung")
  })
})

describe("BILL_DOCUMENT_INFO", () => {
  it("prints BL- only for a Beleg", () => {
    for (const type of BILL_DOCUMENT_TYPES) {
      expect(BILL_DOCUMENT_INFO[type].prefix).toBe(type === "beleg" ? "BL" : "RE")
    }
  })
})

describe("billDocumentOf", () => {
  it("reads the stored document first", () => {
    expect(billDocumentOf({ kind: "invoice", document: "beleg" }, "rechnung")).toBe("beleg")
  })

  it("derives a legacy bill's document as before ADR-0052", () => {
    expect(billDocumentOf({ kind: "beleg" })).toBe("beleg")
    expect(billDocumentOf({ kind: "invoice" }, "monthly")).toBe("sammelrechnung")
    expect(billDocumentOf({ kind: "invoice", checkouts: [{}, {}] }, null)).toBe("sammelrechnung")
    expect(billDocumentOf({ kind: "invoice" }, "raisenow")).toBe("quittung")
    expect(billDocumentOf({ kind: "invoice" }, "rechnung")).toBe("rechnung")
    expect(billDocumentOf({}, null)).toBe("rechnung")
    expect(billDocumentOf({}, "bogus")).toBe("rechnung")
  })

  it("gets a legacy prefix right without the checkout method", () => {
    for (const method of ["monthly", "raisenow", "rechnung", null]) {
      const exact = BILL_DOCUMENT_INFO[billDocumentOf({ kind: "invoice" }, method)].prefix
      expect(BILL_DOCUMENT_INFO[billDocumentOf({ kind: "invoice" })].prefix).toBe(exact)
    }
  })
})

describe("billPaymentMethodOf", () => {
  it("reads the stored method, null included", () => {
    expect(billPaymentMethodOf({ kind: "invoice", paymentMethod: null }, "raisenow")).toBeNull()
    expect(billPaymentMethodOf({ paymentMethod: "raisenow" })).toBe("raisenow")
  })

  it("derives a legacy bill's method", () => {
    expect(billPaymentMethodOf({ kind: "beleg" })).toBe(AGGREGATED_PAYMENT_METHODS[0])
    // The Sammelrechnung itself is paid by QR slip.
    expect(billPaymentMethodOf({ kind: "invoice" }, "monthly")).toBe("rechnung")
    expect(billPaymentMethodOf({ kind: "invoice" }, "raisenow")).toBe("raisenow")
    expect(billPaymentMethodOf({}, null)).toBeNull()
  })
})

describe("isCollectedBeleg / awaitsSammelrechnung", () => {
  it("follows the method, not the document", () => {
    expect(isCollectedBeleg({ document: "beleg", paymentMethod: "monthly" })).toBe(true)
    // The TWINT Beleg and the CHF 0 Beleg never go on the Sammelrechnung.
    expect(isCollectedBeleg({ document: "beleg", paymentMethod: "raisenow" })).toBe(false)
    expect(isCollectedBeleg({ document: "beleg", paymentMethod: null })).toBe(false)
  })

  it("trusts the stored method over a stale legacy kind", () => {
    expect(isCollectedBeleg({ kind: "beleg", paymentMethod: null })).toBe(false)
  })

  it("reads a legacy bill's kind", () => {
    expect(isCollectedBeleg({ kind: "beleg" })).toBe(true)
    expect(isCollectedBeleg({ kind: "invoice" })).toBe(false)
    expect(isCollectedBeleg({})).toBe(false)
  })

  it("awaits only until collected or cancelled", () => {
    const beleg = { paymentMethod: "monthly" as const }
    expect(awaitsSammelrechnung(beleg)).toBe(true)
    expect(awaitsSammelrechnung({ ...beleg, aggregatedIntoBillRef: {} })).toBe(false)
    expect(awaitsSammelrechnung({ ...beleg, cancelledAt: {} })).toBe(false)
  })
})

describe("billMailFor", () => {
  it("tells the two Belege apart", () => {
    expect(billMailFor("beleg", "monthly")).toBe("beleg")
    expect(billMailFor("beleg", "raisenow")).toBe("paid-beleg")
  })

  it("sends every Quittung the receipt mail", () => {
    expect(billMailFor("quittung", "wallee_terminal")).toBe("receipt")
    expect(billMailFor("quittung", "raisenow")).toBe("receipt")
  })

  it("routes the payable documents", () => {
    expect(billMailFor("rechnung", "rechnung")).toBe("invoice")
    expect(billMailFor("rechnung", null)).toBe("invoice")
    expect(billMailFor("sammelrechnung", "rechnung")).toBe("sammelrechnung")
  })

  it("only names contract mails", () => {
    for (const type of BILL_DOCUMENT_TYPES) {
      expect(BILL_MAILS).toContain(billMailFor(type, null))
    }
  })
})
