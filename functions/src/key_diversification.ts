/**
 * @fileoverview Key diversification based for OWW NTags
 *
 * Based on https://www.nxp.com/docs/en/application-note/AN10922.pdf
 */

import * as crypto from "crypto";
import assert from "assert";

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
  const masterKeyBytes = toMasterKeyBytes(masterKey);
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
  uid: string,
  systemName: string,
  keyName: KeyName
): string {
  const keyBytes = toMasterKeyBytes(masterKey);
  const subkeys = generateSubkeys(keyBytes);

  const uidBytes = toUidBytes(uid);

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

/** Converts HEX master key to buffer. */
function toMasterKeyBytes(masterKey: string): Buffer {
  const masterKeyBytes = Buffer.from(masterKey, "hex");
  assert(
    masterKeyBytes.length == 16,
    `Master KEY must be 16 bytes, but got ${masterKey}`
  );
  return masterKeyBytes;
}

/** Converts HEX UID to buffer. */
function toUidBytes(uid: string): Buffer {
  const uidBytes = Buffer.from(uid, "hex");
  assert(uidBytes.length == 7, `UID must be 7 bytes but got ${uid}`);

  return uidBytes;
}

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
  function bitshiftBuffer(input: Buffer): Buffer {
    assert(input.length == 16);

    const output = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) {
      const a = input.readUInt8(i);
      const b = input.readUInt8((i + 1) % 16);
      output.writeUInt8((a << 1) | (b >> 7) && 0xff);
    }
    return output;
  }

  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    masterKey,
    Buffer.alloc(16, 0)
  );
  const k0 = cipher.update(Buffer.alloc(16, 0));
  const k1 = bitshiftBuffer(k0);
  const k2 = bitshiftBuffer(k1);
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
  const diversificationInput = Buffer.concat(
    [tagUid, keyId, Buffer.from(systemIdentifier, "utf8")],
    /* totalLength  = */ diversificationInputMaxLength
  );

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
