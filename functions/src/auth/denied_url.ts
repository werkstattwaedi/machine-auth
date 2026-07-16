// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import type { RejectionCause } from "@oww/shared";

/**
 * Parameters encoded into a `/denied` deep link. `uid` lets the landing page
 * warn on a signed-in-user mismatch; `checkout`/`since` scope the stale-checkout
 * case (the offending open checkout id + its creation date for the copy).
 */
export interface DeniedUrlParams {
  cause: RejectionCause;
  uid: string;
  checkoutId?: string;
  /** Creation date of the stale checkout as `YYYY-MM-DD` (Europe/Zurich). */
  since?: string;
}

/**
 * Build the public deep link to the generic `/denied` landing page. The MaCo
 * renders this as a QR code; the web page reads the params back to render
 * per-cause copy and the mismatch warning (issue #535).
 *
 * Pure string builder — exported so unit tests can verify the canonical shape
 * without spinning up the Functions runtime.
 */
export function buildDeniedUrl(domain: string, params: DeniedUrlParams): string {
  const search = new URLSearchParams();
  search.set("cause", params.cause);
  search.set("uid", params.uid);
  if (params.checkoutId) search.set("checkout", params.checkoutId);
  if (params.since) search.set("since", params.since);
  return `https://${domain}/denied?${search.toString()}`;
}

/**
 * Format a checkout's creation date as `YYYY-MM-DD` in Europe/Zurich, matching
 * the business-day boundary the stale-checkout gate uses. Kept param-free of
 * locale so the value is a stable machine token; the web page localises it for
 * display.
 */
export function zurichDateKey(date: Date): string {
  // en-CA yields ISO `YYYY-MM-DD`; the timeZone pins it to Zurich local day.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
