/* eslint-disable valid-jsdoc */
/**
 * @fileoverview Authorization for OWW Tags
 */
import * as crypto from "crypto";
import assert from "assert";

/** Generates all diversified keys for the tag. */
export function authorizeStep1(
  ntagChallenge: Uint8Array,
  key: Uint8Array
): {
  cloudChallenge: Uint8Array;
  encrypted: Uint8Array;
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

  return { encrypted, cloudChallenge };
}
