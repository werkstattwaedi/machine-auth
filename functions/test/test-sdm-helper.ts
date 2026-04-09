/**
 * @fileoverview Test helper for generating valid NTAG424 SDM test data
 *
 * Uses the actual SDM crypto implementation to generate valid PICC and CMAC
 * pairs for integration testing.
 *
 * COPY NOTE: A self-contained copy lives in web/e2e/sdm-test-helper.ts for
 * Playwright E2E tests. If the crypto changes, update both.
 */

import * as crypto from "crypto";
import { diversifyKey } from "../src/ntag/key_diversification";

/**
 * Computes AES-128 CMAC per NIST SP 800-38B
 * (Duplicated from sdm_crypto.ts for test use)
 */
function computeCMAC(key: Buffer, data: Buffer): Buffer {
  const { k1, k2 } = generateCMACSubkeys(key);

  const blockSize = 16;
  const lastBlockSize = data.length % blockSize;
  const needsPadding = lastBlockSize !== 0 || data.length === 0;

  // Prepare the complete padded message
  let paddedMessage: Buffer;
  if (needsPadding) {
    const padding = Buffer.alloc(blockSize - lastBlockSize);
    padding[0] = 0x80;
    paddedMessage = Buffer.concat([data, padding]);
  } else {
    paddedMessage = data;
  }

  // Separate into all blocks except last, and last block
  const allButLast = paddedMessage.length > blockSize ? paddedMessage.subarray(0, -blockSize) : Buffer.alloc(0);
  // eslint-disable-next-line prefer-const -- mutated via index assignment
  let lastBlock = Buffer.from(paddedMessage.subarray(-blockSize));

  // XOR last block with K1 or K2
  const xorKey = needsPadding ? k2 : k1;
  for (let i = 0; i < blockSize; i++) {
    lastBlock[i] ^= xorKey[i];
  }

  // AES-CBC with zero IV - encrypt complete message
  const cipher = crypto.createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0));
  cipher.setAutoPadding(false);

  const fullMessage = Buffer.concat([allButLast, lastBlock]);
  const encrypted = Buffer.concat([cipher.update(fullMessage), cipher.final()]);

  // Return last block as CMAC
  return encrypted.subarray(-blockSize);
}

/**
 * Generates CMAC subkeys K1 and K2
 */
function generateCMACSubkeys(key: Buffer): { k1: Buffer; k2: Buffer } {
  const Rb = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x87,
  ]);

  const cipher = crypto.createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0));
  cipher.setAutoPadding(false);
  const k0 = cipher.update(Buffer.alloc(16, 0));

  const leftShift = (input: Buffer): Buffer => {
    const output = Buffer.alloc(16);
    for (let i = 0; i < 15; i++) {
      output[i] = (input[i] << 1) | (input[i + 1] >> 7);
    }
    output[15] = input[15] << 1;
    return output;
  };

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

  return { k1, k2 };
}

/**
 * Derives SV2 for session key generation
 */
function deriveSV2(key: Buffer, uid: Buffer, counter: Buffer): Buffer {
  if (key.length !== 16) throw new Error("Key must be 16 bytes");
  if (uid.length !== 7) throw new Error("UID must be 7 bytes");
  if (counter.length !== 3) throw new Error("Counter must be 3 bytes");

  const prefix = Buffer.from([0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80]);
  const input = Buffer.concat([prefix, uid, counter]);

  return computeCMAC(key, input);
}

/**
 * Generates valid PICC and CMAC for testing
 *
 * @param uid - 7-byte UID as hex string (e.g., "04c339aa1e1890")
 * @param counter - Read counter value (0-16777215)
 * @param terminalKey - Terminal key as hex string (32 chars)
 * @param masterKey - Master key for key diversification as hex string (32 chars)
 * @param systemName - System name for key diversification
 * @returns Object with picc and cmac as hex strings
 */
export function generateValidPICCAndCMAC(
  uid: string,
  counter: number,
  terminalKey: string,
  masterKey: string,
  systemName: string
): { picc: string; cmac: string } {
  // Parse inputs
  const uidBuffer = Buffer.from(uid, "hex");
  const counterBuffer = Buffer.alloc(3);
  counterBuffer.writeUIntLE(counter, 0, 3);  // NTAG424 counter is little-endian
  const terminalKeyBuffer = Buffer.from(terminalKey, "hex");

  // Validate inputs
  if (uidBuffer.length !== 7) {
    throw new Error("UID must be 7 bytes (14 hex characters)");
  }
  if (counter < 0 || counter > 16777215) {
    throw new Error("Counter must be 0-16777215 (24-bit)");
  }
  if (terminalKeyBuffer.length !== 16) {
    throw new Error("Terminal key must be 16 bytes (32 hex characters)");
  }

  // 1. Encrypt PICC data [0xC7 tag | UID(7) | Counter(3) | padding(5)] with terminal key
  const piccPlaintext = Buffer.concat([
    Buffer.from([0xC7]),  // NTAG424 PICC tag byte
    uidBuffer,
    counterBuffer,
    Buffer.alloc(5, 0), // Padding to 16 bytes
  ]);

  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    terminalKeyBuffer,
    Buffer.alloc(16, 0) // Zero IV
  );
  cipher.setAutoPadding(false);
  const encryptedPICC = Buffer.concat([
    cipher.update(piccPlaintext),
    cipher.final(),
  ]);

  // 2. Derive SDM MAC key (diversified Key 3) from UID
  const sdmMacKey = diversifyKey(masterKey, systemName, uidBuffer, "sdm_mac");
  const sdmMacKeyBuffer = Buffer.from(sdmMacKey, "hex");

  // 3. Derive session MAC key = CMAC(SDMFileReadKey, SV2_input) directly
  //    (matches production sdm_crypto.ts verifyCMAC)
  const sesSDMFileReadMACKey = deriveSV2(sdmMacKeyBuffer, uidBuffer, counterBuffer);

  // 4. MAC input = ASCII hex of encrypted PICC + "&cmac=" (per AN12196 §3)
  const piccHex = encryptedPICC.toString("hex");
  const dataToMAC = Buffer.from(piccHex.toUpperCase() + "&cmac=", "ascii");
  const cmacFull = computeCMAC(sesSDMFileReadMACKey, dataToMAC);

  // 5. Truncate CMAC: take bytes at odd indices (1, 3, 5, ..., 15) per AN12196
  const truncatedCMAC = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    truncatedCMAC[i] = cmacFull[i * 2 + 1];
  }

  // 6. Return encrypted PICC and truncated CMAC
  return {
    picc: piccHex,
    cmac: truncatedCMAC.toString("hex"),
  };
}
