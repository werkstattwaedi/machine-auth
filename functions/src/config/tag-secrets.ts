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

// Soft revocation/audit knob for the kiosk's verifyTagCheckout call. NOT real
// kiosk attestation — extracting this from a public Windows machine is trivial.
// The actual security is the synthetic-UID custom token returned by
// verifyTagCheckout (see checkout/verify_tag.ts).
export const kioskBearerKey = defineSecret("KIOSK_BEARER_KEY");

/**
 * The bearer to compare against — always read it through this, never
 * `kioskBearerKey.value()` directly. Secret Manager stores stdin verbatim, so
 * `openssl rand -hex 32 | firebase functions:secrets:set … --data-file=-`
 * saves the value WITH its trailing newline, while every client (the kiosk
 * build, the smoke test) reads it trimmed. The untrimmed comparison locked
 * the freshly rotated staging bearer out completely (2026-09-18): "Forbidden"
 * on every tap and every kiosk code sign-in. A bearer never legitimately
 * starts or ends in whitespace.
 */
export function kioskBearer(): string {
  return kioskBearerKey.value().trim();
}
