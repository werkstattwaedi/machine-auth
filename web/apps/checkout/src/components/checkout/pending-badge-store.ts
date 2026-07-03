// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Pending self-service badge (kiosk). When an unregistered badge is tapped
 * BEFORE the visitor is signed in, the signed voucher is parked here so
 * they don't have to re-tap after signing in: the email-code sign-in is
 * SPA-internal (no reload), and the sessionStorage mirror additionally
 * survives an incidental reload within the volatile Electron partition
 * (wiped by "Neuer Checkout" / start-over, so nothing leaks across
 * visitors).
 */

export interface PendingBadge {
  tokenId: string
  badgeVoucher: string
  /** Voucher lifetime guard (ms epoch); server-side TTL is authoritative. */
  expiresAt: number
}

const STORAGE_KEY = "oww.pendingBadge"

/** Mirror of the server voucher TTL (15 min) — client-side guard only. */
const PENDING_BADGE_TTL_MS = 15 * 60 * 1000

let pendingBadge: PendingBadge | null = null

function readMirror(): PendingBadge | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingBadge
    if (
      typeof parsed?.tokenId !== "string" ||
      typeof parsed?.badgeVoucher !== "string" ||
      typeof parsed?.expiresAt !== "number"
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function setPendingBadge(badge: {
  tokenId: string
  badgeVoucher: string
}): void {
  pendingBadge = { ...badge, expiresAt: Date.now() + PENDING_BADGE_TTL_MS }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pendingBadge))
  } catch {
    // sessionStorage unavailable → in-memory only; the re-tap fallback covers it.
  }
}

/** Peek without consuming; expired entries are dropped. */
export function peekPendingBadge(): PendingBadge | null {
  const candidate = pendingBadge ?? readMirror()
  if (!candidate) return null
  if (Date.now() > candidate.expiresAt) {
    clearPendingBadge()
    return null
  }
  pendingBadge = candidate
  return candidate
}

/** Take the pending badge (e.g. when opening the purchase dialog). */
export function consumePendingBadge(): PendingBadge | null {
  const candidate = peekPendingBadge()
  clearPendingBadge()
  return candidate
}

export function clearPendingBadge(): void {
  pendingBadge = null
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
