// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview NTAG424 session key derivation
 *
 * Derives session encryption and MAC keys from the authentication key
 * and random numbers exchanged during 3-pass mutual authentication.
 *
 * Algorithm follows NTAG424 DNA specification:
 * - SV1/SV2 vectors are constructed from RndA and RndB
 * - SesAuthEncKey = CMAC(AuthKey, SV1)
 * - SesAuthMACKey = CMAC(AuthKey, SV2)
 */

import * as crypto from "crypto";
import assert from "assert";

// SV prefix constants
const SV1_PREFIX = [0xa5, 0x5a];
const SV2_PREFIX = [0x5a, 0xa5];

// Fixed constants in SV vector
const SV_FIXED = [0x00, 0x01, 0x00, 0x80];

/**
 * Calculate SV vector for session key derivation.
 *
 * SV = prefix || 0x00 0x01 0x00 0x80 || RndA[0:1] ||
 *      (RndA[2:7] XOR RndB[0:5]) || RndB[6:15] || RndA[8:15]
 *
 * @param prefix Two-byte prefix ([0xA5, 0x5A] for SV1, [0x5A, 0xA5] for SV2)
 * @param rndA 16-byte cloud random (RndA)
 * @param rndB 16-byte tag random (RndB, after decryption)
 * @returns 32-byte SV vector
 */
function calculateSV(
  prefix: [number, number],
  rndA: Buffer,
  rndB: Buffer
): Buffer {
  assert(rndA.length === 16, "rndA must be 16 bytes");
  assert(rndB.length === 16, "rndB must be 16 bytes");

  const sv = Buffer.alloc(32);

  // Bytes 0-1: Prefix
  sv[0] = prefix[0];
  sv[1] = prefix[1];

  // Bytes 2-5: Fixed constants 0x00 0x01 0x00 0x80
  sv[2] = SV_FIXED[0];
  sv[3] = SV_FIXED[1];
  sv[4] = SV_FIXED[2];
  sv[5] = SV_FIXED[3];

  // Bytes 6-7: RndA[0:1] (first 2 bytes of RndA)
  sv[6] = rndA[0];
  sv[7] = rndA[1];

  // Bytes 8-13: RndA[2:7] XOR RndB[0:5]
  for (let i = 0; i < 6; i++) {
    sv[8 + i] = rndA[2 + i] ^ rndB[i];
  }

  // Bytes 14-23: RndB[6:15] (last 10 bytes of RndB)
  for (let i = 0; i < 10; i++) {
    sv[14 + i] = rndB[6 + i];
  }

  // Bytes 24-31: RndA[8:15] (last 8 bytes of RndA)
  for (let i = 0; i < 8; i++) {
    sv[24 + i] = rndA[8 + i];
  }

  return sv;
}

/**
 * AES-CMAC implementation per RFC 4493.
 *
 * @param key 16-byte AES key
 * @param data Data to authenticate
 * @returns 16-byte CMAC
 */
export function aesCmac(key: Buffer, data: Buffer): Buffer {
  assert(key.length === 16, "key must be 16 bytes");

  // Generate subkeys K1 and K2
  const { k1, k2 } = generateSubkeys(key);

  const blockSize = 16;
  const numBlocks = Math.max(1, Math.ceil(data.length / blockSize));
  const lastBlockComplete =
    data.length > 0 && data.length % blockSize === 0;

  // Process all blocks except the last
  let x: Buffer = Buffer.alloc(blockSize); // Running state (starts as zero)

  for (let i = 0; i < numBlocks - 1; i++) {
    const block = Buffer.from(data.subarray(i * blockSize, (i + 1) * blockSize));
    const y = xorBuffers(x, block);
    x = aesEncryptBlock(key, y);
  }

  // Process last block with appropriate subkey
  let lastBlock: Buffer;
  const lastBlockStart = (numBlocks - 1) * blockSize;

  if (lastBlockComplete) {
    // Complete block: XOR with K1
    lastBlock = xorBuffers(data.subarray(lastBlockStart), k1);
  } else {
    // Incomplete block: pad and XOR with K2
    const incomplete = data.subarray(lastBlockStart);
    const padded = Buffer.alloc(blockSize);
    incomplete.copy(padded);
    padded[incomplete.length] = 0x80; // Padding: 10*
    lastBlock = xorBuffers(padded, k2);
  }

  const y = xorBuffers(x, lastBlock);
  return aesEncryptBlock(key, y);
}

/**
 * Generate CMAC subkeys K1 and K2 from key.
 */
function generateSubkeys(key: Buffer): { k1: Buffer; k2: Buffer } {
  // L = AES-128(K, 0^128)
  const L = aesEncryptBlock(key, Buffer.alloc(16));

  // K1 = L << 1, with conditional XOR
  const k1 = shiftLeftAndConditionalXor(L);

  // K2 = K1 << 1, with conditional XOR
  const k2 = shiftLeftAndConditionalXor(k1);

  return { k1, k2 };
}

/**
 * Shift buffer left by 1 bit, XOR with Rb if MSB was 1.
 * Rb = 0x87 for AES-128 (block size 128 bits)
 */
function shiftLeftAndConditionalXor(input: Buffer): Buffer {
  const output = Buffer.alloc(16);
  const msb = input[0] >> 7;

  // Shift left by 1 bit
  for (let i = 0; i < 15; i++) {
    output[i] = ((input[i] << 1) | (input[i + 1] >> 7)) & 0xff;
  }
  output[15] = (input[15] << 1) & 0xff;

  // XOR with Rb (0x87) if MSB was 1
  if (msb === 1) {
    output[15] ^= 0x87;
  }

  return output;
}

/**
 * AES-128-ECB encrypt a single block.
 */
function aesEncryptBlock(key: Buffer, block: Buffer): Buffer {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

/**
 * XOR two equal-length buffers.
 */
function xorBuffers(a: Buffer, b: Buffer): Buffer {
  assert(a.length === b.length, "Buffers must be same length");
  const result = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

/**
 * Derive NTAG424 session keys from authentication key and randoms.
 *
 * @param authKey 16-byte authentication key
 * @param rndA 16-byte cloud random (RndA)
 * @param rndB 16-byte tag random (RndB, decrypted)
 * @returns Session encryption and MAC keys
 */
export function deriveSessionKeys(
  authKey: Buffer,
  rndA: Buffer,
  rndB: Buffer
): {
  sesAuthEncKey: Buffer;
  sesAuthMacKey: Buffer;
} {
  assert(authKey.length === 16, "authKey must be 16 bytes");
  assert(rndA.length === 16, "rndA must be 16 bytes");
  assert(rndB.length === 16, "rndB must be 16 bytes");

  // Calculate SV1 and derive SesAuthEncKey = CMAC(AuthKey, SV1)
  const sv1 = calculateSV(SV1_PREFIX as [number, number], rndA, rndB);
  const sesAuthEncKey = aesCmac(authKey, sv1);

  // Calculate SV2 and derive SesAuthMACKey = CMAC(AuthKey, SV2)
  const sv2 = calculateSV(SV2_PREFIX as [number, number], rndA, rndB);
  const sesAuthMacKey = aesCmac(authKey, sv2);

  return { sesAuthEncKey, sesAuthMacKey };
}
