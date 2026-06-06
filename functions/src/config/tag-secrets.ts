// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * NTAG424 SDM secrets/params shared by the public kiosk endpoint
 * (`verifyTagCheckout`) and the admin-only `resolveTag` callable.
 *
 * Defined once here so both `index.ts` (Express endpoint) and the auth
 * dispatcher's `onCall` can list the same secret/param references — a single
 * source keeps the value wiring unambiguous.
 */

import { defineSecret, defineString } from "firebase-functions/params";

// SDMFileReadKey (static Key 1) — decrypts the PICC ciphertext → UID + counter.
export const terminalKey = defineSecret("TERMINAL_KEY");

// Master key + system name for per-tag Key-3 diversification (CMAC verify).
export const diversificationMasterKey = defineSecret("DIVERSIFICATION_MASTER_KEY");
export const diversificationSystemName = defineString(
  "DIVERSIFICATION_SYSTEM_NAME"
);
