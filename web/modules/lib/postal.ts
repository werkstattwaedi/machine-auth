// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Swiss postal code (PLZ) validation.
 *
 * Swiss Post assigns PLZ in the band 1000–9699. We accept any four-digit
 * code in that range. This rejects obvious nonsense like `0001` or `9700+`
 * while staying permissive enough that we don't accidentally block a
 * legitimate PLZ.
 *
 * Note: Liechtenstein (FL) uses the band 9485–9498, which falls inside
 * 1000–9699, so FL addresses round-trip cleanly via Swiss Post.
 */
export function isValidSwissPlz(zip: string): boolean {
  if (typeof zip !== "string") return false
  const trimmed = zip.trim()
  if (!/^\d{4}$/.test(trimmed)) return false
  const n = Number.parseInt(trimmed, 10)
  return n >= 1000 && n <= 9699
}
