// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Coverage net for ADR-0038: every audited collection must carry an
 * explicit data-protection policy in the subject-data map. Adding an
 * audit trigger without a map entry fails CI here.
 */

import { expect } from "chai";
import { AUDITED_COLLECTIONS } from "../audit/audit-trigger";
import { SUBJECT_DATA_MAP, trimEntries } from "./subject_data_map";

describe("subject data map", () => {
  it("covers every audited collection", () => {
    const mapped = new Set(SUBJECT_DATA_MAP.map((e) => e.collection));
    for (const collection of AUDITED_COLLECTIONS) {
      expect(
        mapped.has(collection),
        `audited collection "${collection}" has no subject_data_map entry — ` +
          "add one (even erasure:\"none\") so its data-protection policy is explicit"
      ).to.equal(true);
    }
  });

  it("has no duplicate entries", () => {
    const names = SUBJECT_DATA_MAP.map((e) => e.collection);
    expect(new Set(names).size).to.equal(names.length);
  });

  it("states a policy on every entry", () => {
    for (const entry of SUBJECT_DATA_MAP) {
      expect(entry.piiFields, entry.collection).to.have.length.greaterThan(0);
      expect(entry.legalBasis, entry.collection).to.have.length.greaterThan(0);
      expect(entry.retention, entry.collection).to.have.length.greaterThan(0);
      expect(entry.erasure, entry.collection).to.have.length.greaterThan(0);
    }
  });

  it("trims exactly the 3-year retention collections", () => {
    expect(trimEntries().map((e) => e.collection)).to.deep.equal([
      "checkouts",
      "bills",
      "usage_machine",
      "authentications",
      "audit_log",
      "operations_log",
    ]);
    for (const entry of trimEntries()) {
      expect(entry.trim.retentionYears).to.equal(3);
      expect(entry.trim.ageField).to.have.length.greaterThan(0);
    }
  });
});
