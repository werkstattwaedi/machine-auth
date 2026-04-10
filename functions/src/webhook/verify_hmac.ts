// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as crypto from "crypto";

/**
 * Verify RaiseNow webhook HMAC-SHA256 signature.
 *
 * @param rawBody - The raw request body (Buffer or string)
 * @param signature - The hex-encoded signature from the request header
 * @param secret - The HMAC secret configured in RaiseNow Hub
 * @returns true if signature is valid
 */
export function verifyHmacSignature(
  rawBody: string | Buffer,
  signature: string,
  secret: string,
): boolean {
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, "hex"),
      Buffer.from(signature, "hex"),
    );
  } catch {
    // timingSafeEqual throws if buffers have different lengths
    return false;
  }
}
