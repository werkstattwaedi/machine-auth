/* eslint-disable valid-jsdoc */
/**
 * @fileoverview Key diversification based for OWW NTags
 *
 * Based on https://www.nxp.com/docs/en/application-note/AN10922.pdf
 */
import assert from "assert";

/** Converts HEX master key to buffer. */
export function toKeyBytes(keyString: string): Buffer {
  const masterKeyBytes = Buffer.from(keyString, "hex");
  assert(
    masterKeyBytes.length == 16,
    `KEY must be 16 bytes, but got ${keyString}`
  );
  return masterKeyBytes;
}

/** Converts HEX UID to buffer. */
export function toUidBytes(uid: string): Buffer {
  const uidBytes = Buffer.from(uid, "hex");
  assert(uidBytes.length == 7, `UID must be 7 bytes but got ${uid}`);

  return uidBytes;
}
