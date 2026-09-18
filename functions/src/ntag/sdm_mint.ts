// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * The inverse of `sdm_crypto.ts`: produce the `picc` / `cmac` pair an
 * NTAG 424 DNA tag would put into its SDM URL for a given UID and read
 * counter. Used by the test suites (`test/test-sdm-helper.ts`) and by the
 * staging-only `mintTestTap` function (`testing/mint_test_tap.ts`), which
 * lets the post-deploy smoke test tap a VIRTUAL badge without the tag keys
 * ever leaving the server.
 *
 * Holding this function plus the keys is equivalent to holding every
 * personalized tag — callers must restrict which UIDs they mint for.
 */

import * as crypto from "crypto";
import { diversifyKey } from "./key_diversification";
import { computeCMAC, deriveSV2 } from "./sdm_crypto";

/**
 * @param uid - 7-byte UID as hex string (e.g. "04c339aa1e1890")
 * @param counter - SDM read counter (0‥16777215)
 * @param terminalKey - SDMFileReadKey, 32 hex chars
 * @param masterKey - diversification master key, 32 hex chars
 * @param systemName - diversification system name
 */
export function mintSdmTap(
  uid: string,
  counter: number,
  terminalKey: string,
  masterKey: string,
  systemName: string
): { picc: string; cmac: string } {
  const uidBuffer = Buffer.from(uid, "hex");
  const terminalKeyBuffer = Buffer.from(terminalKey, "hex");

  if (uidBuffer.length !== 7) {
    throw new Error("UID must be 7 bytes (14 hex characters)");
  }
  if (!Number.isInteger(counter) || counter < 0 || counter > 16777215) {
    throw new Error("Counter must be 0-16777215 (24-bit)");
  }
  if (terminalKeyBuffer.length !== 16) {
    throw new Error("Terminal key must be 16 bytes (32 hex characters)");
  }

  const counterBuffer = Buffer.alloc(3);
  counterBuffer.writeUIntLE(counter, 0, 3); // NTAG424 counter is little-endian

  // 1. PICC data [0xC7 tag | UID(7) | counter(3) | padding(5)], AES-128-CBC
  //    with the terminal key and a zero IV.
  const piccPlaintext = Buffer.concat([
    Buffer.from([0xc7]),
    uidBuffer,
    counterBuffer,
    Buffer.alloc(5, 0),
  ]);
  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    terminalKeyBuffer,
    Buffer.alloc(16, 0)
  );
  cipher.setAutoPadding(false);
  const piccHex = Buffer.concat([
    cipher.update(piccPlaintext),
    cipher.final(),
  ]).toString("hex");

  // 2. Session MAC key = CMAC(diversified Key 3, SV2) — as verifyCMAC does.
  const sdmMacKey = Buffer.from(
    diversifyKey(masterKey, systemName, uidBuffer, "sdm_mac"),
    "hex"
  );
  const sessionMacKey = deriveSV2(sdmMacKey, uidBuffer, counterBuffer);

  // 3. MAC input = ASCII hex of the encrypted PICC + "&cmac=" (AN12196 §3),
  //    truncated to the bytes at odd indices.
  const cmacFull = computeCMAC(
    sessionMacKey,
    Buffer.from(piccHex.toUpperCase() + "&cmac=", "ascii")
  );
  const truncated = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) truncated[i] = cmacFull[i * 2 + 1];

  return { picc: piccHex, cmac: truncated.toString("hex") };
}
