// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * ISO 11649 Structured Creditor Reference (SCOR) generation and validation.
 *
 * Format: "RF" + 2 check digits + reference payload (alphanumeric)
 * Check digits computed via mod-97 (ISO 7064).
 */

/**
 * Compute mod-97 on a numeric string (handles arbitrarily long numbers).
 */
function mod97(numericString: string): number {
  let remainder = 0;
  for (const ch of numericString) {
    remainder = (remainder * 10 + parseInt(ch, 10)) % 97;
  }
  return remainder;
}

/**
 * Convert alphanumeric string to numeric: A=10, B=11, ..., Z=35, digits unchanged.
 */
function alphaToNumeric(s: string): string {
  return s
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 48 && code <= 57) return ch; // digit
      if (code >= 65 && code <= 90) return String(code - 55); // A-Z
      throw new Error(`Invalid character in reference: ${ch}`);
    })
    .join("");
}

/**
 * Generate a SCOR reference from a numeric payload (e.g., zero-padded bill number).
 *
 * @param payload - Alphanumeric reference body (typically zero-padded number)
 * @returns SCOR reference string, e.g., "RF32000100042"
 */
export function generateScorReference(payload: string): string {
  if (!payload || payload.length === 0) {
    throw new Error("Payload must not be empty");
  }
  if (payload.length > 21) {
    throw new Error("Payload must not exceed 21 characters");
  }
  if (!/^[A-Z0-9]+$/.test(payload)) {
    throw new Error("Payload must be alphanumeric (uppercase)");
  }

  // Append "RF00" to payload, convert to numeric, compute check digits
  const rearranged = payload + "RF00";
  const numeric = alphaToNumeric(rearranged);
  const checkDigits = 98 - mod97(numeric);

  return `RF${String(checkDigits).padStart(2, "0")}${payload}`;
}

/**
 * Validate a SCOR reference string.
 *
 * @returns true if the reference has valid check digits
 */
export function validateScorReference(reference: string): boolean {
  if (!reference.startsWith("RF") || reference.length < 5 || reference.length > 25) {
    return false;
  }

  const checkDigits = reference.slice(2, 4);
  if (!/^\d{2}$/.test(checkDigits)) return false;

  const payload = reference.slice(4);
  if (!/^[A-Z0-9]+$/.test(payload)) return false;

  // Rearrange: payload + "RF" + check digits, convert to numeric, mod-97 must be 1
  const rearranged = payload + "RF" + checkDigits;
  const numeric = alphaToNumeric(rearranged);
  return mod97(numeric) === 1;
}
