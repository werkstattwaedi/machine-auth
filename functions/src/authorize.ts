/* eslint-disable valid-jsdoc */
/**
 * @fileoverview Authorization for OWW Tags
 */
import * as crypto from "crypto";
import assert from "assert";
import { toKeyBytes } from "./bytebuffer_util";

/** Generates all diversified keys for the tag. */
export function authorizeStep1(ntagChallenge: string, key: string): string {
  const keyBytes = toKeyBytes(key);
  const ntagChallengeBytes = Buffer.from(ntagChallenge, "hex");
  assert(ntagChallengeBytes.length == 16);

  const cipher = crypto.createDecipheriv(
    "aes-128-cbc",
    keyBytes,
    Buffer.alloc(16, 0)
  );

  const decodedNtagChallenge = Buffer.concat([
    cipher.update(ntagChallengeBytes),
    cipher.final(),
  ]);
  const rotatedNtagChallenge = Buffer.concat([
    decodedNtagChallenge.subarray(1, 15),
    Buffer.of(decodedNtagChallenge[0]),
  ]);

  const cloudChallenge = crypto.randomBytes(16);

  const encrypted = Buffer.concat([cloudChallenge, rotatedNtagChallenge]);
  return encrypted.toString("hex");
}
