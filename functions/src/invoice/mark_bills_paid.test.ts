// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { parseMarkBillsPaidRequest } from "./mark_bills_paid";

describe("parseMarkBillsPaidRequest", () => {
  it("accepts a well-formed batch and preserves paidAtMs", () => {
    const parsed = parseMarkBillsPaidRequest({
      bills: [
        { billId: "b1", paidVia: "ebanking", paidAtMs: 1750000000000 },
        { billId: "b2", paidVia: "cash" },
      ],
    });
    expect(parsed).to.have.length(2);
    expect(parsed[0]).to.deep.equal({
      billId: "b1",
      paidVia: "ebanking",
      paidAtMs: 1750000000000,
    });
    expect(parsed[1].paidAtMs).to.be.undefined;
  });

  it("rejects an empty or missing batch", () => {
    expect(() => parseMarkBillsPaidRequest({})).to.throw(/bills\[\]/);
    expect(() => parseMarkBillsPaidRequest({ bills: [] })).to.throw(/bills\[\]/);
  });

  it("rejects unknown payment channels", () => {
    expect(() =>
      parseMarkBillsPaidRequest({ bills: [{ billId: "b1", paidVia: "free" }] })
    ).to.throw(/paidVia/);
  });

  it("rejects missing bill ids and non-numeric paidAtMs", () => {
    expect(() =>
      parseMarkBillsPaidRequest({ bills: [{ paidVia: "cash" }] })
    ).to.throw(/billId/);
    expect(() =>
      parseMarkBillsPaidRequest({
        bills: [{ billId: "b1", paidVia: "cash", paidAtMs: "gestern" }],
      })
    ).to.throw(/paidAtMs/);
  });

  it("caps the batch size", () => {
    const bills = Array.from({ length: 201 }, (_, i) => ({
      billId: `b${i}`,
      paidVia: "ebanking" as const,
    }));
    expect(() => parseMarkBillsPaidRequest({ bills })).to.throw(/Too many/);
  });
});
