// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Self-contained NTAG424 SDM test data generator for E2E tests.
 *
 * Generates valid PICC + CMAC pairs that the verifyTagCheckout Cloud Function
 * will accept. Includes all crypto (AES-CMAC, key diversification, SV2) inline
 * so there are no cross-package imports.
 *
 * COPY NOTE: The canonical implementation lives in functions/test/test-sdm-helper.ts
 * and functions/src/ntag/key_diversification.ts. If the crypto changes, update both.
 */

import * as crypto from "crypto"

// ── AES-128 CMAC (NIST SP 800-38B) ──────────────────────────────────────

function computeCMAC(key: Buffer, data: Buffer): Buffer {
  const { k1, k2 } = generateCMACSubkeys(key)
  const blockSize = 16
  const lastBlockSize = data.length % blockSize
  const needsPadding = lastBlockSize !== 0 || data.length === 0

  let paddedMessage: Buffer
  if (needsPadding) {
    const padding = Buffer.alloc(blockSize - lastBlockSize)
    padding[0] = 0x80
    paddedMessage = Buffer.concat([data, padding])
  } else {
    paddedMessage = data
  }

  const allButLast =
    paddedMessage.length > blockSize
      ? paddedMessage.subarray(0, -blockSize)
      : Buffer.alloc(0)
  const lastBlock = Buffer.from(paddedMessage.subarray(-blockSize))

  const xorKey = needsPadding ? k2 : k1
  for (let i = 0; i < blockSize; i++) {
    lastBlock[i] ^= xorKey[i]
  }

  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    key,
    Buffer.alloc(16, 0),
  )
  cipher.setAutoPadding(false)
  const fullMessage = Buffer.concat([allButLast, lastBlock])
  const encrypted = Buffer.concat([cipher.update(fullMessage), cipher.final()])
  return encrypted.subarray(-blockSize)
}

function generateCMACSubkeys(key: Buffer): { k1: Buffer; k2: Buffer } {
  const Rb = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x87,
  ])
  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    key,
    Buffer.alloc(16, 0),
  )
  cipher.setAutoPadding(false)
  const k0 = cipher.update(Buffer.alloc(16, 0))

  const leftShift = (input: Buffer): Buffer => {
    const output = Buffer.alloc(16)
    for (let i = 0; i < 15; i++) {
      output[i] = (input[i] << 1) | (input[i + 1] >> 7)
    }
    output[15] = input[15] << 1
    return output
  }

  const k1 = leftShift(k0)
  if ((k0[0] & 0x80) !== 0) {
    for (let i = 0; i < 16; i++) k1[i] ^= Rb[i]
  }
  const k2 = leftShift(k1)
  if ((k1[0] & 0x80) !== 0) {
    for (let i = 0; i < 16; i++) k2[i] ^= Rb[i]
  }
  return { k1, k2 }
}

// ── SV2 derivation ───────────────────────────────────────────────────────

function deriveSV2(key: Buffer, uid: Buffer, counter: Buffer): Buffer {
  const prefix = Buffer.from([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80])
  return computeCMAC(key, Buffer.concat([prefix, uid, counter]))
}

// ── Key diversification (AN10922) ────────────────────────────────────────

type KeyName = "application" | "terminal" | "authorization" | "sdm_mac" | "reserved2"

const keyIdBytes: Record<KeyName, Buffer> = {
  application: Buffer.from([0x00, 0x00, 0x01]),
  terminal: Buffer.from([0x00, 0x00, 0x02]),
  authorization: Buffer.from([0x00, 0x00, 0x03]),
  sdm_mac: Buffer.from([0x00, 0x00, 0x04]),
  reserved2: Buffer.from([0x00, 0x00, 0x05]),
}

function diversifyKey(
  masterKey: string,
  systemName: string,
  uidBytes: Buffer,
  keyName: KeyName,
): string {
  const keyBytes = Buffer.from(masterKey, "hex")
  const subkeys = generateCMACSubkeys(keyBytes)

  const diversificationInputMaxLength = 31
  const diversificationInput = Buffer.concat([
    uidBytes,
    keyIdBytes[keyName],
    Buffer.from(systemName, "utf8"),
  ])
  const divConstant = Buffer.of(0x01)
  const padding = Buffer.alloc(
    diversificationInputMaxLength - diversificationInput.length,
    0x00,
  )
  const hasPadding = padding.length > 0
  if (hasPadding) padding.writeUint8(0x80)

  const cmacInput = Buffer.concat([divConstant, diversificationInput, padding])
  const k = hasPadding ? subkeys.k2 : subkeys.k1
  for (let i = 0; i < 16; i++) {
    cmacInput.writeUInt8(
      (cmacInput.readUint8(i + 16) ^ k.readUInt8(i)) & 0xff,
      i + 16,
    )
  }

  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    keyBytes,
    Buffer.alloc(16, 0),
  )
  cipher.setAutoPadding(false)
  const encrypted = Buffer.concat([
    cipher.update(cmacInput),
    cipher.final(),
  ])
  return encrypted.subarray(16, 32).toString("hex")
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Generate valid PICC + CMAC pair for testing verifyTagCheckout.
 *
 * @param uid - 7-byte tag UID as hex (e.g. "04c339aa1e1890")
 * @param counter - SDM read counter (0–16777215)
 * @param terminalKey - 16-byte terminal key as hex
 * @param masterKey - 16-byte diversification master key as hex
 * @param systemName - System name for key diversification
 */
export function generateValidPICCAndCMAC(
  uid: string,
  counter: number,
  terminalKey: string,
  masterKey: string,
  systemName: string,
): { picc: string; cmac: string } {
  const uidBuffer = Buffer.from(uid, "hex")
  const counterBuffer = Buffer.alloc(3)
  counterBuffer.writeUIntLE(counter, 0, 3)
  const terminalKeyBuffer = Buffer.from(terminalKey, "hex")

  // 1. Encrypt PICC data [0xC7 tag | UID(7) | Counter(3) | padding(5)]
  const piccPlaintext = Buffer.concat([
    Buffer.from([0xc7]),
    uidBuffer,
    counterBuffer,
    Buffer.alloc(5, 0),
  ])
  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    terminalKeyBuffer,
    Buffer.alloc(16, 0),
  )
  cipher.setAutoPadding(false)
  const encryptedPICC = Buffer.concat([
    cipher.update(piccPlaintext),
    cipher.final(),
  ])

  // 2. Derive SDM MAC key (diversified Key 3)
  const sdmMacKey = diversifyKey(masterKey, systemName, uidBuffer, "sdm_mac")
  const sdmMacKeyBuffer = Buffer.from(sdmMacKey, "hex")

  // 3. Session MAC key = CMAC(SDMFileReadKey, SV2_input)
  const sesSDMFileReadMACKey = deriveSV2(
    sdmMacKeyBuffer,
    uidBuffer,
    counterBuffer,
  )

  // 4. MAC input = ASCII hex of encrypted PICC + "&cmac=" (per AN12196 §3)
  const piccHex = encryptedPICC.toString("hex")
  const dataToMAC = Buffer.from(piccHex.toUpperCase() + "&cmac=", "ascii")
  const cmacFull = computeCMAC(sesSDMFileReadMACKey, dataToMAC)

  // 5. Truncate: odd-indexed bytes (1, 3, 5, ..., 15) per AN12196
  const truncatedCMAC = Buffer.alloc(8)
  for (let i = 0; i < 8; i++) {
    truncatedCMAC[i] = cmacFull[i * 2 + 1]
  }

  return { picc: piccHex, cmac: truncatedCMAC.toString("hex") }
}
