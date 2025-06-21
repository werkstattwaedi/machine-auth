/* eslint-disable valid-jsdoc */
/**
 * @fileoverview Key diversification based for OWW NTags
 *
 * Based on https://www.nxp.com/docs/en/application-note/AN10922.pdf
 */

import * as crypto from "crypto";
import assert from "assert";
import { toKeyBytes, toUidBytes } from "./bytebuffer_util";

export type KeyName =
  | "application"
  | "authorization"
  | "reserved1"
  | "reserved2";
const keyNames: Array<KeyName> = [
  "application",
  "authorization",
  "reserved1",
  "reserved2",
];

export type NtagKeys = {
  [k in KeyName]: string;
};

/** Generates all diversified keys for the tag. */
export function diversifyKeys(
  masterKey: string,
  systemName: string,
  uid: string
): NtagKeys {
  const masterKeyBytes = toKeyBytes(masterKey);
  const subkeys = generateSubkeys(masterKeyBytes);
  const uidBytes = toUidBytes(uid);
  const result: Partial<NtagKeys> = {};

  for (const keyName of keyNames) {
    result[keyName] = computeDiversifiedKey(
      masterKeyBytes,
      uidBytes,
      keyName,
      systemName,
      subkeys
    );
  }
  return result as NtagKeys;
}

/** Generates the specified diversified key for the tag. */
export function diversifyKey(
  masterKey: string,
  systemName: string,
  uidBytes: Buffer,
  keyName: KeyName
): string {
  const keyBytes = toKeyBytes(masterKey);
  const subkeys = generateSubkeys(keyBytes);

  return computeDiversifiedKey(
    keyBytes,
    uidBytes,
    keyName,
    systemName,
    subkeys
  );
}

// Diversification input. not secret, but affects key diversification.
const keyIdBytes = {
  application: Buffer.from([0x00, 0x00, 0x01]),
  authorization: Buffer.from([0x00, 0x00, 0x02]),
  reserved1: Buffer.from([0x00, 0x00, 0x03]),
  reserved2: Buffer.from([0x00, 0x00, 0x04]),
};

/** For testing only. */
export const testOnly = { keyIdBytes };

/** Computes the diversified key. */
function computeDiversifiedKey(
  masterKey: Buffer,
  tagUid: Buffer,
  keyName: KeyName,
  systemName: string,
  subkeys: CmacSubkeys
): string {
  assert(masterKey.length == 16);
  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    masterKey,
    Buffer.alloc(16, 0)
  );
  cipher.setAutoPadding(false);

  const cmacInput = generateDiversifiedCmacInput(
    tagUid,
    keyIdBytes[keyName],
    systemName,
    subkeys
  );
  assert.ok(cmacInput.length == 32);

  const encrypted = Buffer.concat([cipher.update(cmacInput), cipher.final()]);
  return encrypted.subarray(16, 32).toString("hex");
}

type CmacSubkeys = {
  k1: Buffer;
  k2: Buffer;
};

/** Computes CMAC subkeys from master key. */
function generateSubkeys(masterKey: Buffer): CmacSubkeys {
  const Rb = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x87,
  ]);

  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    masterKey,
    Buffer.alloc(16, 0)
  );
  cipher.setAutoPadding(false);
  const k0 = cipher.update(Buffer.alloc(16, 0));

  function leftShift(input: Buffer): Buffer {
    const output = Buffer.alloc(16);
    for (let i = 0; i < 15; i++) {
      output[i] = (input[i] << 1) | (input[i + 1] >> 7);
    }
    output[15] = input[15] << 1;
    return output;
  }

  const k1 = leftShift(k0);
  if ((k0[0] & 0x80) !== 0) {
    for (let i = 0; i < 16; i++) {
      k1[i] ^= Rb[i];
    }
  }

  const k2 = leftShift(k1);
  if ((k1[0] & 0x80) !== 0) {
    for (let i = 0; i < 16; i++) {
      k2[i] ^= Rb[i];
    }
  }

  return {
    k1,
    k2,
  };
}

/** Computes diversified CMAC Input. */
function generateDiversifiedCmacInput(
  tagUid: Buffer,
  keyId: Buffer,
  systemIdentifier: string,
  subkeys: CmacSubkeys
): Buffer {
  assert(tagUid.length == 7);
  assert(keyId.length == 3);

  const diversificationInputMaxLength = 31;

  // Diversification input
  const diversificationInput = Buffer.concat([
    tagUid,
    keyId,
    Buffer.from(systemIdentifier, "utf8"),
  ]);

  const divConstant = Buffer.of(0x01);

  const padding = Buffer.alloc(
    diversificationInputMaxLength - diversificationInput.length,
    /* fill = */ 0x00
  );
  const hasPadding = padding.length > 0;
  if (hasPadding) {
    padding.writeUint8(0x80);
  }

  const cmacInput = Buffer.concat([divConstant, diversificationInput, padding]);
  assert.ok(cmacInput.length == 32);

  const k = hasPadding ? subkeys.k2 : subkeys.k1;
  for (let byteIndex = 0; byteIndex < 16; byteIndex++) {
    cmacInput.writeUInt8(
      (cmacInput.readUint8(byteIndex + 16) ^ k.readUInt8(byteIndex)) & 0xff,
      byteIndex + 16
    );
  }

  return cmacInput;
}
