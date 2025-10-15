/**
 * @fileoverview NTAG424 DNA SDM (Secure Dynamic Messaging) crypto utilities
 *
 * Implements SV2 session key derivation, PICC data decryption, and CMAC verification
 * for NTAG424 DNA SUN (Secure Unique NFC) messages.
 *
 * Based on NXP NTAG 424 DNA datasheet and AN12196 application note.
 */

import * as crypto from "crypto";

/**
 * Decrypted PICC data containing UID and read counter
 */
export interface PICCData {
  uid: Buffer;      // 7 bytes
  counter: Buffer;  // 3 bytes (24-bit counter)
}

/**
 * Session keys derived from SV2
 */
interface SessionKeys {
  encKey: Buffer;   // SesAuthEncKey - for encryption
  macKey: Buffer;   // SesAuthMACKey - for CMAC
}

/**
 * Derives SV2 value for session key generation
 * SV2 = CMAC(key, 0x3CC3 || 0x0001 || 0x0080 || UID || Counter)
 *
 * @param key - SDMFileReadKey (terminal key)
 * @param uid - 7-byte UID
 * @param counter - 3-byte read counter
 * @returns 16-byte SV2 value
 */
function deriveSV2(key: Buffer, uid: Buffer, counter: Buffer): Buffer {
  if (key.length !== 16) throw new Error("Key must be 16 bytes");
  if (uid.length !== 7) throw new Error("UID must be 7 bytes");
  if (counter.length !== 3) throw new Error("Counter must be 3 bytes");

  // SV2 prefix: 0x3CC3 || 0x0001 || 0x0080
  const prefix = Buffer.from([0x3C, 0xC3, 0x00, 0x01, 0x00, 0x80]);

  // Concatenate: prefix || UID || counter
  const input = Buffer.concat([prefix, uid, counter]);

  // Compute CMAC
  return computeCMAC(key, input);
}

/**
 * Derives session keys from SV2
 * SesAuthEncKey = CMAC(key, 0x01 || SV2[0..15])
 * SesAuthMACKey = CMAC(key, 0x02 || SV2[0..15])
 *
 * @param key - SDMFileReadKey (terminal key)
 * @param sv2 - 16-byte SV2 value
 * @returns Session encryption and MAC keys
 */
function deriveSessionKeys(key: Buffer, sv2: Buffer): SessionKeys {
  if (sv2.length !== 16) throw new Error("SV2 must be 16 bytes");

  // SesAuthEncKey = CMAC(key, 0x01 || SV2)
  const encInput = Buffer.concat([Buffer.from([0x01]), sv2]);
  const encKey = computeCMAC(key, encInput);

  // SesAuthMACKey = CMAC(key, 0x02 || SV2)
  const macInput = Buffer.concat([Buffer.from([0x02]), sv2]);
  const macKey = computeCMAC(key, macInput);

  return { encKey, macKey };
}

/**
 * Computes AES-128 CMAC per NIST SP 800-38B
 *
 * @param key - 16-byte AES key
 * @param data - Input data
 * @returns 16-byte CMAC
 */
function computeCMAC(key: Buffer, data: Buffer): Buffer {
  // Generate subkeys K1 and K2
  const { k1, k2 } = generateCMACSubkeys(key);

  // Determine if padding is needed
  const blockSize = 16;
  const numBlocks = Math.ceil(data.length / blockSize);
  const lastBlockSize = data.length % blockSize;
  const needsPadding = lastBlockSize !== 0 || data.length === 0;

  // Prepare the complete padded message
  let paddedMessage: Buffer;
  if (needsPadding) {
    // Pad: data || 0x80 || 0x00...
    const padding = Buffer.alloc(blockSize - lastBlockSize);
    padding[0] = 0x80;
    paddedMessage = Buffer.concat([data, padding]);
  } else {
    paddedMessage = data;
  }

  // Separate into all blocks except last, and last block
  const allButLast = paddedMessage.length > blockSize ? paddedMessage.subarray(0, -blockSize) : Buffer.alloc(0);
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
 * Generates CMAC subkeys K1 and K2 from AES key
 *
 * @param key - 16-byte AES key
 * @returns K1 and K2 subkeys
 */
function generateCMACSubkeys(key: Buffer): { k1: Buffer; k2: Buffer } {
  const Rb = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x87,
  ]);

  // Encrypt zero block
  const cipher = crypto.createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0));
  cipher.setAutoPadding(false);
  const k0 = cipher.update(Buffer.alloc(16, 0));

  // Left shift function
  const leftShift = (input: Buffer): Buffer => {
    const output = Buffer.alloc(16);
    for (let i = 0; i < 15; i++) {
      output[i] = (input[i] << 1) | (input[i + 1] >> 7);
    }
    output[15] = input[15] << 1;
    return output;
  };

  // Generate K1
  const k1 = leftShift(k0);
  if ((k0[0] & 0x80) !== 0) {
    for (let i = 0; i < 16; i++) {
      k1[i] ^= Rb[i];
    }
  }

  // Generate K2
  const k2 = leftShift(k1);
  if ((k1[0] & 0x80) !== 0) {
    for (let i = 0; i < 16; i++) {
      k2[i] ^= Rb[i];
    }
  }

  return { k1, k2 };
}

/**
 * Decrypts PICC data (encrypted UID + counter) from SDM message
 * Uses AES-128-CBC with zero IV
 *
 * @param encryptedPICC - Hex-encoded encrypted PICC data (16 bytes when hex-decoded)
 * @param terminalKey - Hex-encoded SDMFileReadKey (terminal key, 32 hex chars)
 * @returns Decrypted UID and counter
 */
export function decryptPICCData(
  encryptedPICC: string,
  terminalKey: string
): PICCData {
  const encryptedBytes = Buffer.from(encryptedPICC, "hex");
  const keyBytes = Buffer.from(terminalKey, "hex");

  if (keyBytes.length !== 16) {
    throw new Error("Terminal key must be 16 bytes (32 hex characters)");
  }

  // Encrypted PICC data should be 16 bytes (one AES block)
  if (encryptedBytes.length !== 16) {
    throw new Error(`Encrypted PICC data must be 16 bytes, got ${encryptedBytes.length}`);
  }

  // Decrypt using AES-128-CBC with zero IV
  const decipher = crypto.createDecipheriv(
    "aes-128-cbc",
    keyBytes,
    Buffer.alloc(16, 0)
  );
  decipher.setAutoPadding(false);

  const decrypted = Buffer.concat([
    decipher.update(encryptedBytes),
    decipher.final(),
  ]);

  // Extract UID (first 7 bytes) and counter (next 3 bytes)
  const uid = decrypted.subarray(0, 7);
  const counter = decrypted.subarray(7, 10);

  return { uid, counter };
}

/**
 * Verifies CMAC signature of SDM message
 *
 * Note: SDM CMAC verification uses session keys derived from the terminal key.
 * Key diversification is only used for 3-pass mutual authentication, not SDM checkout.
 *
 * @param cmac - Hex-encoded CMAC from URL (8 bytes = truncated CMAC)
 * @param piccData - Decrypted PICC data
 * @param terminalKey - Hex-encoded terminal key for session key derivation (32 hex chars)
 * @returns true if CMAC is valid
 */
export function verifyCMAC(
  cmac: string,
  piccData: PICCData,
  terminalKey: string
): boolean {
  const cmacBytes = Buffer.from(cmac, "hex");
  const terminalKeyBytes = Buffer.from(terminalKey, "hex");

  if (cmacBytes.length !== 8) {
    throw new Error("CMAC must be 8 bytes (16 hex characters)");
  }
  if (terminalKeyBytes.length !== 16) {
    throw new Error("Terminal key must be 16 bytes (32 hex characters)");
  }

  // Derive SV2 and session keys from terminal key
  const sv2 = deriveSV2(terminalKeyBytes, piccData.uid, piccData.counter);
  const sessionKeys = deriveSessionKeys(terminalKeyBytes, sv2);

  // Compute CMAC over UID || Counter using session MAC key
  const dataToMAC = Buffer.concat([piccData.uid, piccData.counter]);
  const computedCMAC = computeCMAC(sessionKeys.macKey, dataToMAC);

  // Compare first 8 bytes (truncated CMAC)
  const truncatedCMAC = computedCMAC.subarray(0, 8);
  return truncatedCMAC.equals(cmacBytes);
}
