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
 * Derives SV2 value for session key generation
 * SV2 = CMAC(key, 0x3CC3 || 0x0001 || 0x0080 || UID || Counter)
 *
 * @param key - SDMFileReadKey (Key 3, diversified per-tag)
 * @param uid - 7-byte UID
 * @param counter - 3-byte read counter (little-endian)
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

  // PICC data format: [0xC7 tag byte] [7-byte UID] [3-byte counter] [5 padding]
  if (decrypted[0] !== 0xC7) {
    throw new Error(`Unexpected PICC tag byte: 0x${decrypted[0].toString(16)}`);
  }
  const uid = decrypted.subarray(1, 8);
  const counter = decrypted.subarray(8, 11);

  return { uid, counter };
}

/**
 * Verifies CMAC signature of SDM message
 *
 * The MAC input is the ASCII hex of the encrypted PICC data (the portion of
 * the URL between SDMMACInputOffset and SDMMACOffset), per AN12196 §3.
 *
 * @param cmac - Hex-encoded CMAC from URL (8 bytes = truncated CMAC)
 * @param piccData - Decrypted PICC data (for SV2 derivation)
 * @param encryptedPICC - Hex-encoded encrypted PICC data from URL (MAC input)
 * @param sdmFileReadKey - Hex-encoded SDMFileReadKey (diversified Key 3, 32 hex chars)
 * @returns true if CMAC is valid
 */
export function verifyCMAC(
  cmac: string,
  piccData: PICCData,
  encryptedPICC: string,
  sdmFileReadKey: string
): boolean {
  const cmacBytes = Buffer.from(cmac, "hex");
  const sdmKeyBytes = Buffer.from(sdmFileReadKey, "hex");

  if (cmacBytes.length !== 8) {
    throw new Error("CMAC must be 8 bytes (16 hex characters)");
  }
  if (sdmKeyBytes.length !== 16) {
    throw new Error("SDMFileReadKey must be 16 bytes (32 hex characters)");
  }

  // SDM session MAC key = CMAC(SDMFileReadKey, SV2_input) directly
  // (no extra deriveSessionKeys step — that's for regular auth only)
  const sesSDMFileReadMACKey = deriveSV2(sdmKeyBytes, piccData.uid, piccData.counter);

  // MAC input = NDEF data from SDMMACInputOffset (0x22) to SDMMACOffset (0x48).
  // Assumes URL template: ...picc=<32 hex>&cmac=<16 hex>  (see sdm_constants.h)
  const dataToMAC = Buffer.from(encryptedPICC.toUpperCase() + "&cmac=", "ascii");
  const computedCMAC = computeCMAC(sesSDMFileReadMACKey, dataToMAC);

  // Truncate CMAC: take bytes at odd indices (1, 3, 5, ..., 15) per AN12196
  const truncatedCMAC = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    truncatedCMAC[i] = computedCMAC[i * 2 + 1];
  }

  return truncatedCMAC.equals(cmacBytes);
}
