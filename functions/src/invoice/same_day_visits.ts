// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable `getSameDayVisits` (billingCall): the caller's earlier visits of
 * the business day an open checkout was opened on, so the check-in and
 * Check Out can preview the same-day waiver (CHK-39) without reading the
 * checkout history.
 *
 * A kiosk badge session may read only the checkouts closed in the last two
 * days (#854, `isKioskVisitCheckout` in firestore.rules). A checkout left
 * open from an earlier day — the forgotten second visit of last Monday,
 * closed at the kiosk a week later — needs that Monday's visits, which the
 * rules no longer serve. This returns exactly those and nothing else: the
 * visits of one business day, reduced to what `sameDayCoveredPersons`
 * compares. The client still computes the waiver live (the roster changes
 * while the person edits it); the close decides again on the server.
 */

import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import {
  isSameBusinessDay,
  type SameDayCheckout,
  type UsageType,
} from "@oww/shared";
import type { CheckoutEntity } from "../types/firestore_entities";
import {
  effectiveUid,
  loadSameDayCandidates,
} from "./close_checkout_and_get_payment";

export interface GetSameDayVisitsRequest {
  /** The caller's open checkout; omitted for a visit not created yet (today). */
  checkoutId?: string | null;
}

/** A `SameDayCheckout` with its dates as epoch ms, for the wire. */
export interface SameDayVisit {
  id: string;
  status: string | null;
  usageType: UsageType | null;
  created: number | null;
  closedAt: number | null;
  persons: {
    name: string | null;
    userType: string;
    userRef: { id: string } | null;
    usageType: UsageType | null;
  }[];
}

export interface GetSameDayVisitsResponse {
  visits: SameDayVisit[];
}

function toWire(c: SameDayCheckout): SameDayVisit {
  return {
    id: c.id,
    status: c.status ?? null,
    usageType: c.usageType ?? null,
    created: c.created?.getTime() ?? null,
    closedAt: c.closedAt?.getTime() ?? null,
    persons: (c.persons ?? []).map((p) => ({
      name: p.name ?? null,
      userType: p.userType,
      userRef: p.userRef?.id ? { id: p.userRef.id } : null,
      usageType: p.usageType ?? null,
    })),
  };
}

export async function handleGetSameDayVisits(
  request: CallableRequest<GetSameDayVisitsRequest>
): Promise<GetSameDayVisitsResponse> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign-in required");
  }
  const provider = (request.auth.token as {
    firebase?: { sign_in_provider?: string };
  }).firebase?.sign_in_provider;
  const ownerId = effectiveUid(request);
  // A guest has no account, so no earlier visits to count (CHK-37).
  if (provider === "anonymous" || !ownerId) return { visits: [] };

  const db = getFirestore();
  const ownerRef = db.collection("users").doc(ownerId);

  let openedAt = new Date();
  const checkoutId = request.data?.checkoutId ?? null;
  if (checkoutId !== null) {
    if (typeof checkoutId !== "string" || checkoutId.length === 0) {
      throw new HttpsError("invalid-argument", "checkoutId must be a string");
    }
    const snap = await db.collection("checkouts").doc(checkoutId).get();
    const checkout = snap.data() as CheckoutEntity | undefined;
    // Same answer for a missing and a foreign checkout: no existence oracle.
    if (!checkout || checkout.userId?.id !== ownerId) {
      throw new HttpsError("permission-denied", "Access denied");
    }
    openedAt = checkout.created?.toDate?.() ?? openedAt;
  }

  const candidates = await loadSameDayCandidates(db, ownerRef);
  const visits = candidates
    .filter(
      (c) =>
        c.id !== checkoutId &&
        !c.cancelledAt &&
        c.created != null &&
        isSameBusinessDay(c.created, openedAt)
    )
    .map(toWire);
  return { visits };
}

export const getSameDayVisitsHandler = handleGetSameDayVisits;
