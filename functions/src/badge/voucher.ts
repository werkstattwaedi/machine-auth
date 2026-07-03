// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview Signed badge vouchers — proof of a physical badge tap.
 *
 * Self-service badge purchase: the kiosk taps an UNREGISTERED badge, the
 * server verifies the SDM crypto and hands the client a short-lived signed
 * voucher for the recovered tokenId. `addBadgeToCheckout` only accepts a
 * valid voucher, never a bare tokenId — otherwise anyone could remotely
 * claim ("squat") a badge from the pre-personalized stack at the kiosk by
 * guessing/enumerating UIDs.
 *
 * The voucher carries the tap's SDM read counter. At association time the
 * counter is stamped into the new `tokens/{id}.lastSdmCounter`, so a
 * captured pre-registration tap URL cannot be replayed as a sign-in after
 * the badge is registered (the sentinel -1 would otherwise accept any
 * counter on the first post-registration verify).
 */

import * as crypto from "crypto";

/** Voucher lifetime — long enough to sign in after tapping, short enough
 *  that a leaked voucher is useless by the time anyone could abuse it. */
const VOUCHER_TTL_MS = 15 * 60 * 1000;

export interface BadgeVoucherPayload {
  tokenId: string;
  sdmCounter: number;
}

/**
 * Domain-separated HMAC key derived from the SDM diversification master key
 * (no extra secret to provision/rotate).
 */
function voucherKey(masterKeyHex: string): Buffer {
  return crypto
    .createHash("sha256")
    .update("oww-badge-voucher")
    .update(Buffer.from(masterKeyHex, "hex"))
    .digest();
}

function sign(payload: string, masterKeyHex: string): string {
  return crypto
    .createHmac("sha256", voucherKey(masterKeyHex))
    .update(payload)
    .digest("base64url");
}

/** Mints `<tokenId>.<sdmCounter>.<expiresAtMs>.<mac>` (all base64url-safe). */
export function mintBadgeVoucher(
  { tokenId, sdmCounter }: BadgeVoucherPayload,
  masterKeyHex: string,
  nowMs: number = Date.now()
): string {
  const payload = `${tokenId}.${sdmCounter}.${nowMs + VOUCHER_TTL_MS}`;
  return `${payload}.${sign(payload, masterKeyHex)}`;
}

/**
 * Verifies signature + expiry. Returns the payload, or null when the voucher
 * is malformed, tampered with, or expired (callers map null to the
 * user-facing "Bitte Badge erneut auflegen." error).
 */
export function verifyBadgeVoucher(
  voucher: string,
  masterKeyHex: string,
  nowMs: number = Date.now()
): BadgeVoucherPayload | null {
  if (typeof voucher !== "string") return null;
  const parts = voucher.split(".");
  if (parts.length !== 4) return null;
  const [tokenId, counterStr, expiresStr, mac] = parts;

  const payload = `${tokenId}.${counterStr}.${expiresStr}`;
  const expected = sign(payload, masterKeyHex);
  const macBuf = Buffer.from(mac);
  const expectedBuf = Buffer.from(expected);
  if (
    macBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(macBuf, expectedBuf)
  ) {
    return null;
  }

  const expiresAtMs = Number(expiresStr);
  const sdmCounter = Number(counterStr);
  if (!Number.isFinite(expiresAtMs) || !Number.isInteger(sdmCounter)) {
    return null;
  }
  if (nowMs > expiresAtMs) return null;
  if (!/^[0-9a-f]{14}$/.test(tokenId)) return null;

  return { tokenId, sdmCounter };
}
