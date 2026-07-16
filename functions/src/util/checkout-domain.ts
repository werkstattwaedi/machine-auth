// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import * as logger from "firebase-functions/logger";
import { HttpsError } from "firebase-functions/v2/https";
import { defineString } from "firebase-functions/params";

/**
 * Domain hosting the public checkout app (e.g. `checkout.werkstattwaedi.ch`).
 *
 * Used to build public deep links baked into QR codes — the price-list PDF
 * (issue #248) and the stale-checkout `/denied` landing page (issue #535).
 * Set via Firebase Functions params and materialised into
 * `functions/.env.<projectId>` by `scripts/generate-env.ts`. Has no default —
 * an unset param must fail loudly in production (see
 * `assertCheckoutDomainConfigured`) instead of silently shipping
 * `localhost:5173`, which is exactly how the QR bug regressed in #248.
 *
 * In emulator mode (`FUNCTIONS_EMULATOR === "true"`) we fall back to
 * `localhost:5173` so dev/test flows work without operations config.
 */
const checkoutDomainParam = defineString("CHECKOUT_DOMAIN", { default: "" });

function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

/**
 * Throws a distinct `failed-precondition` error when `CHECKOUT_DOMAIN` is
 * empty/whitespace in non-emulator mode. Surfaces the misconfiguration in
 * Cloud Functions logs so ops can detect it quickly — silently falling back to
 * `localhost:5173` is what produced the unusable QR codes issue #248 reports.
 *
 * Exported separately so unit tests can pass the value directly without
 * stubbing `defineString`.
 */
export function assertCheckoutDomainConfigured(value: string): void {
  if (isEmulator()) return;
  if (value.trim().length > 0) return;
  logger.error(
    "CHECKOUT_DOMAIN is empty in production — public QR-code deep links " +
      "would point at localhost. Set the param via firebase functions:config " +
      "or regenerate functions/.env.<projectId> via `npm run generate-env`."
  );
  throw new HttpsError(
    "failed-precondition",
    "CHECKOUT_DOMAIN is not configured"
  );
}

/**
 * Resolve the checkout domain at request time:
 * - In emulator mode, default to `localhost:5173` when unset so dev flows work
 *   without operations config.
 * - In production, require the param to be set (asserted before use).
 */
export function resolveCheckoutDomain(): string {
  const value = checkoutDomainParam.value();
  if (isEmulator() && value.trim().length === 0) {
    return "localhost:5173";
  }
  assertCheckoutDomainConfigured(value);
  return value;
}
