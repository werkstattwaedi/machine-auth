// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * @fileoverview Associates purchased badges when a checkout closes.
 *
 * Association happens at checkout CLOSE (bill allocated), not at payment
 * acknowledgment: the buyer physically walks away with the badge, so it
 * must work on the machines immediately even when they pay later by
 * invoice. (Contrast: membership activation waits for the bill ack.)
 *
 * A Firestore trigger (open→closed edge, mirroring create_bill.ts) rather
 * than inline code in closeCheckoutAndGetPayment: it covers every close
 * path uniformly, keeps the close transaction small, and retries safely —
 * `tx.create` on `tokens/{tokenId}` makes each association idempotent.
 */

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import {
  getFirestore,
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
  TokenEntity,
} from "../types/firestore_entities";
import { isBadgeItem } from "./shared";

/** Zurich-local YYYY-MM-DD for the self-service token label. */
function zurichDateString(ts: Timestamp): string {
  return ts.toDate().toLocaleDateString("sv-SE", {
    timeZone: "Europe/Zurich",
  });
}

/**
 * Exported for integration tests. Idempotent; per-item isolation so one bad
 * badge never blocks the others (or fails/retries the close).
 */
export async function associateBadgesForCheckout(
  checkoutRef: DocumentReference,
  checkout: CheckoutEntity
): Promise<void> {
  if (checkout.status !== "closed") return;

  const itemsSnap = await checkoutRef.collection("items").get();
  const badgeItems = itemsSnap.docs
    .map((d) => d.data() as CheckoutItemEntity)
    .filter(isBadgeItem);
  if (badgeItems.length === 0) return;

  const userRef = checkout.userId;
  if (!userRef) {
    // Rules + the close-time guard make this unreachable; if it ever
    // happens the badge would be orphaned — shout, don't throw (a retry
    // can't fix a null userId).
    logger.error("Closed checkout has badge items but no userId", {
      checkoutId: checkoutRef.id,
      tokenIds: badgeItems.map((i) => i.tokenId),
    });
    return;
  }

  const db = getFirestore();
  const now = Timestamp.now();

  for (const item of badgeItems) {
    const tokenRef = db.collection("tokens").doc(item.tokenId);
    try {
      await db.runTransaction(async (tx) => {
        const existing = await tx.get(tokenRef);
        if (existing.exists) {
          const owner = (existing.data() as TokenEntity).userId;
          if (owner?.id === userRef.id) {
            // Trigger retry / duplicate event — already associated.
            return;
          }
          // Someone else owns it (admin registered it between add and
          // close, or a race we lost). NEVER clobber an existing
          // association; staff resolves the refund manually from this log.
          logger.warn("Badge already registered to another user — skipping", {
            checkoutId: checkoutRef.id,
            tokenId: item.tokenId,
            existingOwner: owner?.id ?? null,
            buyer: userRef.id,
          });
          return;
        }
        const token: TokenEntity = {
          userId: userRef,
          registered: now,
          label: `Badge (Selbstkauf ${zurichDateString(now)})`,
          // Seed the replay defense with the purchase tap's counter so a
          // captured pre-registration URL can't sign in afterwards.
          lastSdmCounter: item.badgeSdmCounter ?? 0,
        };
        tx.create(tokenRef, token);
      });
      logger.info("Associated self-service badge", {
        checkoutId: checkoutRef.id,
        tokenId: item.tokenId,
        userId: userRef.id,
      });
    } catch (err) {
      logger.error("Failed to associate badge", {
        checkoutId: checkoutRef.id,
        tokenId: item.tokenId,
        userId: userRef.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Checkout closed (open → closed edge): associate any purchased badges. */
export const onCheckoutClosedAssociateBadges = onDocumentUpdated(
  "checkouts/{checkoutId}",
  async (event) => {
    const before = event.data?.before.data() as CheckoutEntity | undefined;
    const after = event.data?.after.data() as CheckoutEntity | undefined;
    if (!before || !after) return;
    if (before.status === "closed" || after.status !== "closed") return;

    await associateBadgesForCheckout(event.data!.after.ref, after);
  }
);
