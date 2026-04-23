// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Per-tab client session ID. Used as a correlation identifier in client-side
 * logs and surfaced to the user in error UI so that a bug report can be
 * matched against Cloud Logging entries.
 *
 * The ID is:
 * - 8 characters, lowercase base36 (0-9 a-z),
 * - persisted in sessionStorage under `oww.sessionId` (clears with the tab),
 * - falls back to a module-level variable if sessionStorage is unavailable
 *   (SSR, privacy modes, Safari ITP).
 */

const STORAGE_KEY = "oww.sessionId"

let inMemoryId: string | null = null

function generateId(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  // Interpret 6 bytes as an unsigned integer and base36-encode it, padding /
  // truncating to 8 characters. 6 bytes (~48 bits) comfortably covers
  // 8 base36 digits (~41 bits needed); the high byte is masked so we always
  // get an 8-char result without leading-zero issues.
  let value = 0n
  for (const b of bytes) {
    value = (value << 8n) | BigInt(b)
  }
  const encoded = value.toString(36)
  if (encoded.length >= 8) {
    return encoded.slice(-8)
  }
  return encoded.padStart(8, "0")
}

function getStorage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null
    // Touch the storage to detect disabled / privacy-mode access errors.
    const probe = "__oww_probe__"
    sessionStorage.setItem(probe, probe)
    sessionStorage.removeItem(probe)
    return sessionStorage
  } catch {
    return null
  }
}

export function getClientSessionId(): string {
  const storage = getStorage()
  if (storage) {
    const existing = storage.getItem(STORAGE_KEY)
    if (existing) return existing
    const fresh = generateId()
    try {
      storage.setItem(STORAGE_KEY, fresh)
    } catch {
      // Ignore quota / disabled errors — we still return the fresh ID below.
    }
    return fresh
  }

  if (inMemoryId) return inMemoryId
  inMemoryId = generateId()
  return inMemoryId
}
