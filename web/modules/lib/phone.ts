// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Swiss phone number parsing.
 *
 * Validates and normalises Swiss phone numbers to E.164 (`+41...`).
 * Accepts the formats users commonly type:
 *   `+41 79 123 45 67`, `0791234567`, `079 123 45 67`, `+41791234567`,
 *   etc.
 *
 * The phone-validation library (`libphonenumber-js`) is loaded **lazily**
 * via dynamic import so its metadata (~80 kB minified, even in the `/min`
 * build) does not ship in the main bundle. The form fields that depend on
 * this helper run validation only on submit / blur, so paying the import
 * cost there is fine. See issue #298.
 */

export type ParsedPhone =
  | { ok: true; e164: string }
  | { ok: false; reason: "empty" | "invalid" }

export async function parseSwissPhone(
  input: string | null | undefined,
): Promise<ParsedPhone> {
  const trimmed = (input ?? "").trim()
  if (trimmed === "") {
    return { ok: false, reason: "empty" }
  }

  // Lazy-load the parser. `/min` ships the smallest metadata set that still
  // covers all countries; for E.164 normalisation this is enough.
  const { parsePhoneNumberFromString } = await import("libphonenumber-js/min")
  const parsed = parsePhoneNumberFromString(trimmed, "CH")
  if (!parsed || !parsed.isValid()) {
    return { ok: false, reason: "invalid" }
  }
  return { ok: true, e164: parsed.number }
}
