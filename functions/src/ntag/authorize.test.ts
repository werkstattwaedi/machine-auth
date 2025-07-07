import { expect } from "chai";
import { authorizeStep1, authorizeStep2 } from "./authorize";
import * as crypto from "crypto";

describe("authorize", () => {
  describe("authorizeStep1", () => {
    it("should return encrypted data and cloud challenge", () => {
      const key = crypto.randomBytes(16);
      const ntagChallenge = crypto.randomBytes(16);
      const { encrypted, cloudChallenge } = authorizeStep1(ntagChallenge, key);
      expect(encrypted).to.be.instanceOf(Buffer);
      expect(encrypted.length).to.equal(32);
      expect(cloudChallenge).to.be.instanceOf(Buffer);
      expect(cloudChallenge.length).to.equal(16);
    });
  });

  describe("authorizeStep2", () => {
    it("should decrypt and verify the ntag response", () => {
      const key = crypto.randomBytes(16);
      const rndA = crypto.randomBytes(16);
      const ti = crypto.randomBytes(4);
      const pdCap2 = crypto.randomBytes(6);
      const pcdCap2 = crypto.randomBytes(6);

      const rotatedRndA = Buffer.concat([
        rndA.subarray(1, 16),
        Buffer.of(rndA[0]),
      ]);

      const plaintext = Buffer.concat([ti, rotatedRndA, pdCap2, pcdCap2]);

      const cipher = crypto
        .createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0))
        .setAutoPadding(false);

      const encryptedNtagResponse = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);

      const result = authorizeStep2(encryptedNtagResponse, key, rndA);

      expect(result.ti).to.deep.equal(ti);
      expect(result.pdCap2).to.deep.equal(pdCap2);
      expect(result.pcdCap2).to.deep.equal(pcdCap2);
    });

    it("should throw an error if the rotated challenge does not match", () => {
      const key = crypto.randomBytes(16);
      const rndA = crypto.randomBytes(16);
      const wrongRndA = crypto.randomBytes(16);
      const ti = crypto.randomBytes(4);
      const pdCap2 = crypto.randomBytes(6);
      const pcdCap2 = crypto.randomBytes(6);

      const rotatedRndA = Buffer.concat([
        wrongRndA.subarray(1, 16),
        Buffer.of(wrongRndA[0]),
      ]);

      const plaintext = Buffer.concat([ti, rotatedRndA, pdCap2, pcdCap2]);

      const cipher = crypto
        .createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0))
        .setAutoPadding(false);

      const encryptedNtagResponse = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
      ]);

      expect(() => authorizeStep2(encryptedNtagResponse, key, rndA)).to.throw(
        "RndA' verification failed"
      );
    });
  });
});
