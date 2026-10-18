// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import {
  billBaseNumber,
  billFileName,
  billRevision,
  formatBelegNumber,
  formatBillReference,
  formatInvoiceNumber,
} from "./types";

// Stored numbers are base × 10 + revision digit (ADR-0042): 42000010 is
// bill 4200001 (original), 42000011 its first corrected re-issue. Mirrors
// web/modules/lib/format.test.ts so both formatters stay in lockstep.
describe("bill reference formatting (ADR-0042)", () => {
  it("renders an original without a suffix, base padded to 6", () => {
    expect(formatInvoiceNumber(42000010)).to.equal("RE-4200001");
    expect(formatInvoiceNumber(50)).to.equal("RE-000005");
    expect(formatBelegNumber(50)).to.equal("BL-000005");
  });

  it("renders corrected re-issues with the stored digit as suffix", () => {
    expect(formatInvoiceNumber(42000011)).to.equal("RE-4200001-1");
    expect(formatInvoiceNumber(42000019)).to.equal("RE-4200001-9");
    expect(formatBelegNumber(51)).to.equal("BL-000005-1");
  });

  it("formatBillReference prints the stored document's prefix", () => {
    expect(formatBillReference({ referenceNumber: 70, document: "beleg" })).to.equal("BL-000007");
    expect(formatBillReference({ referenceNumber: 71, kind: "invoice", document: "beleg" }))
      .to.equal("BL-000007-1");
    expect(formatBillReference({ referenceNumber: 70, document: "sammelrechnung" }))
      .to.equal("RE-000007");
    expect(formatBillReference({ referenceNumber: 70, document: "quittung" })).to.equal("RE-000007");
  });

  it("formatBillReference derives a legacy bill's prefix from its kind", () => {
    expect(formatBillReference({ referenceNumber: 70, kind: "beleg" })).to.equal("BL-000007");
    expect(formatBillReference({ referenceNumber: 70, kind: "invoice" })).to.equal("RE-000007");
    expect(formatBillReference({ referenceNumber: 70 })).to.equal("RE-000007");
  });

  it("billFileName names the document", () => {
    expect(billFileName("beleg", "BL-000007")).to.equal("Beleg_BL-000007.pdf");
    expect(billFileName("sammelrechnung", "RE-000007")).to.equal("Sammelrechnung_RE-000007.pdf");
    expect(billFileName("quittung", "RE-000007", "-")).to.equal("Quittung-RE-000007.pdf");
  });

  it("billBaseNumber / billRevision split the stored number", () => {
    expect(billBaseNumber(42000011)).to.equal(4200001);
    expect(billRevision(42000010)).to.equal(1);
    expect(billRevision(42000011)).to.equal(2);
    expect(billRevision(42000019)).to.equal(10);
  });
});
