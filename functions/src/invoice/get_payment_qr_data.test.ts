// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Pins the RaiseNow PayLink URL contract. TWINT silently ignores unknown
 * query parameters, so a wrong parameter name doesn't fail — it produces
 * payments WITHOUT our creditor reference, which the statement import then
 * can't match. The reference must travel as `reference.creditor` (not the
 * `reference.creditor.value` spelling used for supporter fields).
 */

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import { buildPaymentData } from "./get_payment_qr_data";
import type { BillEntity } from "./types";

// defineString params resolve from process.env at .value() time.
const TEST_ENV: Record<string, string> = {
  PAYMENT_IBAN: "CH2130000001250094239",
  PAYMENT_RECIPIENT_NAME: "Offene Werkstatt Wädenswil",
  PAYMENT_RECIPIENT_POSTAL_CODE: "8820",
  PAYMENT_RECIPIENT_CITY: "Wädenswil",
  PAYMENT_RECIPIENT_COUNTRY: "CH",
  PAYMENT_CURRENCY: "CHF",
  RAISENOW_PAYLINK_SOLUTION_ID: "tstslnid",
};

function testBill(): BillEntity {
  return {
    userId: { id: "u1" } as never,
    checkouts: [],
    referenceNumber: 42,
    amount: 84,
    currency: "CHF",
    storagePath: null,
    created: Timestamp.now(),
    paidAt: null,
    paidVia: null,
  } as unknown as BillEntity;
}

describe("buildPaymentData PayLink URL", () => {
  const saved = new Map<string, string | undefined>();

  before(() => {
    for (const [k, v] of Object.entries(TEST_ENV)) {
      saved.set(k, process.env[k]);
      process.env[k] = v;
    }
  });
  after(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("carries the SCOR reference as `reference.creditor`", () => {
    const data = buildPaymentData(testBill(), null, "b1", null);
    const url = new URL(data.paylinkUrl);
    expect(url.origin).to.equal("https://pay.raisenow.io");
    expect(url.pathname).to.equal("/tstslnid");
    // The exact parameter TWINT reads — RF29000000042 is the SCOR ref for
    // bill number 42 (9-digit padded payload).
    expect(url.searchParams.get("reference.creditor")).to.equal(data.reference);
    expect(data.reference).to.match(/^RF\d{2}000000042$/);
    // The old, silently-ignored spelling must be gone.
    expect(url.searchParams.has("reference.creditor.value")).to.be.false;
    expect(url.searchParams.get("amount.values")).to.equal("84.00");
  });

  it("QR payload and PayLink carry the same reference", () => {
    const data = buildPaymentData(
      testBill(),
      { name: "Mike Schneider", email: "michschn@gmail.com" },
      "b1",
      null,
    );
    const lines = data.qrBillPayload.split("\n");
    // SPC fields 28/29 in the builder's 1-based comments → indices 27/28.
    expect(lines[27]).to.equal("SCOR"); // reference type
    expect(lines[28]).to.equal(data.reference);
    const url = new URL(data.paylinkUrl);
    expect(url.searchParams.get("reference.creditor")).to.equal(data.reference);
    expect(url.searchParams.get("supporter.first_name.value")).to.equal("Mike");
    expect(url.searchParams.get("supporter.last_name.value")).to.equal("Schneider");
  });
})
