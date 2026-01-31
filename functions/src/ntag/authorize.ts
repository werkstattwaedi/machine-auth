/* eslint-disable valid-jsdoc */
/**
 * @fileoverview Authorization for OWW Tags
 */
import * as crypto from "crypto";
import assert from "assert";

export function authorizeStep1(
  ntagChallenge: Uint8Array,
  key: Uint8Array
): {
  cloudChallenge: Uint8Array;
  encrypted: Uint8Array;
  rndB: Uint8Array;
} {
  // const keyBytes = toKeyBytes(key);
  // const ntagChallengeBytes = Buffer.from(ntagChallenge);
  assert(key.length == 16);
  assert(ntagChallenge.length == 16);

  const decipher = crypto
    .createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0))
    .setAutoPadding(false);

  const decodedNtagChallenge = Buffer.concat([
    decipher.update(ntagChallenge),
    decipher.final(),
  ]);
  const rotatedNtagChallenge = Buffer.concat([
    decodedNtagChallenge.subarray(1, 16),
    Buffer.of(decodedNtagChallenge[0]),
  ]);

  const cloudChallenge = crypto.randomBytes(16);

  const cipher = crypto
    .createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0))
    .setAutoPadding(false);

  const encrypted = Buffer.concat([
    cipher.update(cloudChallenge),
    cipher.update(rotatedNtagChallenge),
    cipher.final(),
  ]);

  return { encrypted, cloudChallenge, rndB: decodedNtagChallenge };
}

/**
 *
 * @param encryptedNtagResponse 32 bytes, encrypted with key
 * @param key 16 bytes
 * @param rndA 16 bytes, the cloud challenge from step 1
 * @returns
 */
export function authorizeStep2(
  encryptedNtagResponse: Uint8Array,
  key: Uint8Array,
  rndA: Uint8Array
): {
  ti: Uint8Array;
  pdCap2: Uint8Array;
  pcdCap2: Uint8Array;
} {
  assert(
    encryptedNtagResponse.length === 32,
    "encryptedNtagResponse must be 32 bytes"
  );
  assert(key.length === 16, "key must be 16 bytes");
  assert(rndA.length === 16, "rndA must be 16 bytes");

  const decipher = crypto
    .createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0))
    .setAutoPadding(false);

  const decrypted = Buffer.concat([
    decipher.update(encryptedNtagResponse),
    decipher.final(),
  ]);

  const ti = decrypted.subarray(0, 4);
  const rndARotated = decrypted.subarray(4, 20);
  const pdCap2 = decrypted.subarray(20, 26);
  const pcdCap2 = decrypted.subarray(26, 32);

  const expectedRndARotated = Buffer.concat([
    rndA.subarray(1, 16),
    Buffer.of(rndA[0]),
  ]);

  assert.deepStrictEqual(
    rndARotated,
    expectedRndARotated,
    "RndA' verification failed"
  );

  return { ti, pdCap2, pcdCap2 };
}