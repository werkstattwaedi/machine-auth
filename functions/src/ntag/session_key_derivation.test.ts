// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { aesCmac, deriveSessionKeys } from "./session_key_derivation";

describe("Session Key Derivation", () => {
  describe("aesCmac", () => {
    // RFC 4493 Test Vectors
    // https://www.rfc-editor.org/rfc/rfc4493#section-4
    const rfcKey = Buffer.from("2b7e151628aed2a6abf7158809cf4f3c", "hex");

    it("should compute CMAC for empty message (RFC 4493 Example 1)", () => {
      const message = Buffer.alloc(0);
      const expected = Buffer.from("bb1d6929e95937287fa37d129b756746", "hex");

      const result = aesCmac(rfcKey, message);
      expect(result.toString("hex")).to.equal(expected.toString("hex"));
    });

    it("should compute CMAC for 16-byte message (RFC 4493 Example 2)", () => {
      const message = Buffer.from("6bc1bee22e409f96e93d7e117393172a", "hex");
      const expected = Buffer.from("070a16b46b4d4144f79bdd9dd04a287c", "hex");

      const result = aesCmac(rfcKey, message);
      expect(result.toString("hex")).to.equal(expected.toString("hex"));
    });

    it("should compute CMAC for 40-byte message (RFC 4493 Example 3)", () => {
      const message = Buffer.from(
        "6bc1bee22e409f96e93d7e117393172a" +
          "ae2d8a571e03ac9c9eb76fac45af8e51" +
          "30c81c46a35ce411",
        "hex"
      );
      const expected = Buffer.from("dfa66747de9ae63030ca32611497c827", "hex");

      const result = aesCmac(rfcKey, message);
      expect(result.toString("hex")).to.equal(expected.toString("hex"));
    });

    it("should compute CMAC for 64-byte message (RFC 4493 Example 4)", () => {
      const message = Buffer.from(
        "6bc1bee22e409f96e93d7e117393172a" +
          "ae2d8a571e03ac9c9eb76fac45af8e51" +
          "30c81c46a35ce411e5fbc1191a0a52ef" +
          "f69f2445df4f9b17ad2b417be66c3710",
        "hex"
      );
      const expected = Buffer.from("51f0bebf7e3b9d92fc49741779363cfe", "hex");

      const result = aesCmac(rfcKey, message);
      expect(result.toString("hex")).to.equal(expected.toString("hex"));
    });
  });

  describe("deriveSessionKeys", () => {
    it("should derive session keys from auth key and randoms", () => {
      // Test with known values
      const authKey = Buffer.from("00112233445566778899aabbccddeeff", "hex");
      const rndA = Buffer.from("01020304050607080910111213141516", "hex");
      const rndB = Buffer.from("a1a2a3a4a5a6a7a8a9a0b1b2b3b4b5b6", "hex");

      const { sesAuthEncKey, sesAuthMacKey } = deriveSessionKeys(
        authKey,
        rndA,
        rndB
      );

      // Verify keys are 16 bytes
      expect(sesAuthEncKey.length).to.equal(16);
      expect(sesAuthMacKey.length).to.equal(16);

      // Verify keys are different from each other
      expect(sesAuthEncKey.toString("hex")).to.not.equal(
        sesAuthMacKey.toString("hex")
      );

      // Verify keys are different from input key
      expect(sesAuthEncKey.toString("hex")).to.not.equal(
        authKey.toString("hex")
      );
      expect(sesAuthMacKey.toString("hex")).to.not.equal(
        authKey.toString("hex")
      );
    });

    it("should produce deterministic results", () => {
      const authKey = Buffer.from("00112233445566778899aabbccddeeff", "hex");
      const rndA = Buffer.from("01020304050607080910111213141516", "hex");
      const rndB = Buffer.from("a1a2a3a4a5a6a7a8a9a0b1b2b3b4b5b6", "hex");

      const result1 = deriveSessionKeys(authKey, rndA, rndB);
      const result2 = deriveSessionKeys(authKey, rndA, rndB);

      expect(result1.sesAuthEncKey.toString("hex")).to.equal(
        result2.sesAuthEncKey.toString("hex")
      );
      expect(result1.sesAuthMacKey.toString("hex")).to.equal(
        result2.sesAuthMacKey.toString("hex")
      );
    });

    it("should produce different keys for different inputs", () => {
      const authKey = Buffer.from("00112233445566778899aabbccddeeff", "hex");
      const rndA1 = Buffer.from("01020304050607080910111213141516", "hex");
      const rndA2 = Buffer.from("01020304050607080910111213141517", "hex"); // Different last byte
      const rndB = Buffer.from("a1a2a3a4a5a6a7a8a9a0b1b2b3b4b5b6", "hex");

      const result1 = deriveSessionKeys(authKey, rndA1, rndB);
      const result2 = deriveSessionKeys(authKey, rndA2, rndB);

      expect(result1.sesAuthEncKey.toString("hex")).to.not.equal(
        result2.sesAuthEncKey.toString("hex")
      );
    });

    it("should throw for invalid key length", () => {
      const badKey = Buffer.from("0011223344556677", "hex"); // Only 8 bytes
      const rndA = Buffer.from("01020304050607080910111213141516", "hex");
      const rndB = Buffer.from("a1a2a3a4a5a6a7a8a9a0b1b2b3b4b5b6", "hex");

      expect(() => deriveSessionKeys(badKey, rndA, rndB)).to.throw();
    });

    it("should throw for invalid rndA length", () => {
      const authKey = Buffer.from("00112233445566778899aabbccddeeff", "hex");
      const badRndA = Buffer.from("0102030405060708", "hex"); // Only 8 bytes
      const rndB = Buffer.from("a1a2a3a4a5a6a7a8a9a0b1b2b3b4b5b6", "hex");

      expect(() => deriveSessionKeys(authKey, badRndA, rndB)).to.throw();
    });

    it("should throw for invalid rndB length", () => {
      const authKey = Buffer.from("00112233445566778899aabbccddeeff", "hex");
      const rndA = Buffer.from("01020304050607080910111213141516", "hex");
      const badRndB = Buffer.from("a1a2a3a4a5a6a7a8", "hex"); // Only 8 bytes

      expect(() => deriveSessionKeys(authKey, rndA, badRndB)).to.throw();
    });
  });
});
