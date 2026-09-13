// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import {
  billBaseNumber,
  billRevision,
  formatBelegNumber,
  formatBillReference,
  formatInvoiceNumber,
} from "./types";

// Stored numbers are base × 10 + revision digit (ADR-0041): 42000010 is
// bill 4200001 (original), 42000011 its first corrected re-issue. Mirrors
// web/modules/lib/format.test.ts so both formatters stay in lockstep.
describe("bill reference formatting (ADR-0041)", () => {
  it("renders an original without a suffix, base padded to 6", () => {
    expect(formatInvoiceNumber(42000010)).to.equal("RE-4200001");
    expect(formatInvoiceNumber(50)).to.equal("RE-000005");
    expect(formatBelegNumber(50)).to.equal("BL-000005");
  });

  it("renders corrected re-issues with the revision suffix", () => {
    expect(formatInvoiceNumber(42000011)).to.equal("RE-4200001-2");
    expect(formatInvoiceNumber(42000019)).to.equal("RE-4200001-10");
    expect(formatBelegNumber(51)).to.equal("BL-000005-2");
  });

  it("formatBillReference picks the prefix by kind, invoice by default", () => {
    expect(formatBillReference(70, "beleg")).to.equal("BL-000007");
    expect(formatBillReference(70, "invoice")).to.equal("RE-000007");
    expect(formatBillReference(70, undefined)).to.equal("RE-000007");
  });

  it("billBaseNumber / billRevision split the stored number", () => {
    expect(billBaseNumber(42000011)).to.equal(4200001);
    expect(billRevision(42000010)).to.equal(1);
    expect(billRevision(42000011)).to.equal(2);
    expect(billRevision(42000019)).to.equal(10);
  });
});
