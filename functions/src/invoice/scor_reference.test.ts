// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { generateScorReference, validateScorReference } from "./scor_reference";

describe("SCOR Reference (ISO 11649)", () => {
  describe("generateScorReference", () => {
    it("should generate valid check digits for a numeric payload", () => {
      const ref = generateScorReference("000100042");
      expect(ref).to.match(/^RF\d{2}000100042$/);
      expect(validateScorReference(ref)).to.be.true;
    });

    it("should generate RF18539007547034 for known test vector", () => {
      // Known ISO 11649 example
      const ref = generateScorReference("539007547034");
      expect(ref).to.equal("RF18539007547034");
    });

    it("should handle single-digit payload", () => {
      const ref = generateScorReference("1");
      expect(ref).to.match(/^RF\d{2}1$/);
      expect(validateScorReference(ref)).to.be.true;
    });

    it("should handle maximum length payload (21 chars)", () => {
      const ref = generateScorReference("123456789012345678901");
      expect(validateScorReference(ref)).to.be.true;
    });

    it("should throw on empty payload", () => {
      expect(() => generateScorReference("")).to.throw("Payload must not be empty");
    });

    it("should throw on payload exceeding 21 characters", () => {
      expect(() => generateScorReference("1234567890123456789012")).to.throw(
        "Payload must not exceed 21 characters"
      );
    });

    it("should throw on lowercase letters", () => {
      expect(() => generateScorReference("abc")).to.throw("Payload must be alphanumeric");
    });

    it("should pad check digits with leading zero", () => {
      // Generate several references and verify check digits are always 2 digits
      for (let i = 1; i <= 100; i++) {
        const ref = generateScorReference(String(i));
        const checkDigits = ref.slice(2, 4);
        expect(checkDigits).to.match(/^\d{2}$/);
      }
    });
  });

  describe("validateScorReference", () => {
    it("should validate a correctly generated reference", () => {
      expect(validateScorReference("RF18539007547034")).to.be.true;
    });

    it("should reject a reference with wrong check digits", () => {
      expect(validateScorReference("RF99539007547034")).to.be.false;
    });

    it("should reject too-short references", () => {
      expect(validateScorReference("RF12")).to.be.false;
    });

    it("should reject references without RF prefix", () => {
      expect(validateScorReference("XX18539007547034")).to.be.false;
    });

    it("should reject references with lowercase payload", () => {
      expect(validateScorReference("RF18abc")).to.be.false;
    });

    it("should round-trip generate → validate for many values", () => {
      for (let i = 1; i <= 200; i++) {
        const payload = String(i).padStart(9, "0");
        const ref = generateScorReference(payload);
        expect(validateScorReference(ref)).to.be.true;
      }
    });
  });
});
