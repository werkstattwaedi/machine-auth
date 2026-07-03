// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: add a self-service badge to the caller's open checkout.
 *
 * The client presents a signed badge voucher (proof of a physical tap of an
 * unregistered badge at the kiosk — see badge/voucher.ts); a bare tokenId
 * is never accepted. The server decides the price from the badge catalog
 * SKU: variant `gratis` for the first badge of an eligible user (active
 * member OR any permission, zero active tokens, no badge already in the
 * checkout), variant `standard` (5 CHF) otherwise. No badge-count limit.
 *
 * The line item carries `tokenId` + `badgeSdmCounter` (server-written only,
 * rules-enforced); association with the user's account happens at checkout
 * CLOSE (badge/associate_on_close.ts) — the user walks away with the badge
 * even when paying later by invoice.
 *
 * `dryRun: true` runs every check and returns the price quote without
 * writing — the purchase dialog's single source of eligibility (permissions
 * are not client-visible for kiosk sessions).
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import {
  getFirestore,
  Timestamp,
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
  UserEntity,
} from "../types/firestore_entities";
import { priceForTier } from "../types/firestore_entities";
import { diversificationMasterKey } from "../config/tag-secrets";
import { verifyBadgeVoucher } from "./voucher";
import {
  BADGE_VARIANT_FREE,
  BADGE_VARIANT_STANDARD,
  countActiveTokens,
  effectiveCallerRef,
  isBadgeEligibleFree,
  isBadgeItem,
  loadBadgeCatalog,
} from "./shared";
import { formatFullName } from "../util/username-utils";

export interface AddBadgeToCheckoutRequest {
  /** Signed proof-of-tap from verifyTagCheckout / probeTag. */
  badgeVoucher: string;
  /** Run all checks and return the quote without writing. */
  dryRun?: boolean;
}

export interface AddBadgeToCheckoutResponse {
  /** Null on dryRun when the caller has no open checkout yet. */
  checkoutId: string | null;
  tokenId: string;
  unitPrice: number;
  free: boolean;
}

export interface AddBadgeCallerContext {
  authUid: string | undefined;
  authToken: Record<string, unknown> | undefined;
}

const REJECT_ALREADY_REGISTERED = "Badge ist bereits registriert.";
const REJECT_IN_OTHER_CHECKOUT =
  "Dieser Badge ist bereits in einem anderen Checkout.";
const REJECT_ALREADY_IN_CHECKOUT = "Dieser Badge ist bereits im Checkout.";
const REJECT_VOUCHER = "Bitte Badge erneut auflegen.";

/**
 * Pure handler — exported so integration tests can drive it without the
 * onCall envelope (mirrors handlePurchaseMembership).
 */
export async function handleAddBadgeToCheckout(
  input: AddBadgeToCheckoutRequest,
  caller: AddBadgeCallerContext,
  masterKeyHex: string
): Promise<AddBadgeToCheckoutResponse> {
  const { badgeVoucher, dryRun } = input ?? ({} as AddBadgeToCheckoutRequest);
  if (typeof badgeVoucher !== "string" || badgeVoucher.length === 0) {
    throw new HttpsError("invalid-argument", "badgeVoucher is required");
  }
  const voucher = verifyBadgeVoucher(badgeVoucher, masterKeyHex);
  if (!voucher) {
    // Expired or tampered — same user-facing recovery either way.
    throw new HttpsError("failed-precondition", REJECT_VOUCHER);
  }
  const { tokenId, sdmCounter } = voucher;

  const database = getFirestore();
  const callerRef = effectiveCallerRef(
    database,
    caller.authUid,
    caller.authToken
  );
  const userSnap = await callerRef.get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "Caller user doc not found");
  }
  const user = userSnap.data() as UserEntity;

  const { ref: catalogRef, catalog } = await loadBadgeCatalog(database);
  const standardVariant = catalog.variants?.find(
    (v) => v.id === BADGE_VARIANT_STANDARD
  );
  const freeVariant = catalog.variants?.find((v) => v.id === BADGE_VARIANT_FREE);
  if (!standardVariant || !freeVariant) {
    throw new HttpsError(
      "failed-precondition",
      `Badge catalog ${catalogRef.id} must have "${BADGE_VARIANT_STANDARD}" and "${BADGE_VARIANT_FREE}" variants`
    );
  }

  const eligibleFree = isBadgeEligibleFree(user);
  const now = Timestamp.now();

  /**
   * ALL state reads live inside the transaction, so its read set covers
   * everything the decision depends on and any concurrent mutation forces
   * a retry with fresh reads:
   *  - the caller's open-checkout query — two concurrent purchases with no
   *    open checkout must not each create one (the retry sees the winner's
   *    checkout and appends to it);
   *  - the caller's tokens — a token registered between quote and commit
   *    must not still yield a gratis badge;
   *  - `tokens/{tokenId}` + the items collection group — two kiosk
   *    sessions racing over the same physical badge: the loser gets a
   *    clean rejection.
   */
  const runChecks = async (
    tx: Transaction
  ): Promise<{
    unitPrice: number;
    free: boolean;
    variantId: string;
    existingCheckoutRef: DocumentReference | null;
  }> => {
    const openCheckoutsSnap = await tx.get(
      database
        .collection("checkouts")
        .where("userId", "==", callerRef as DocumentReference)
        .where("status", "==", "open")
        .limit(1)
    );
    const existingCheckoutRef = openCheckoutsSnap.empty
      ? null
      : openCheckoutsSnap.docs[0].ref;

    const tokensSnap = await tx.get(
      database
        .collection("tokens")
        .where("userId", "==", callerRef as DocumentReference)
    );
    const activeTokenCount = countActiveTokens(tokensSnap.docs);

    // (1) Already associated with someone (or an admin registered it).
    const tokenDoc = await tx.get(database.collection("tokens").doc(tokenId));
    if (tokenDoc.exists) {
      throw new HttpsError("failed-precondition", REJECT_ALREADY_REGISTERED);
    }

    // (2) Pending in any OTHER open checkout (needs the COLLECTION_GROUP
    // index on items.tokenId). Closed checkouts resolve through (1): a
    // closed checkout's badge item has either created the token doc or
    // been abandoned.
    const pendingSnap = await tx.get(
      database.collectionGroup("items").where("tokenId", "==", tokenId)
    );
    let alreadyInThisCheckout = false;
    for (const doc of pendingSnap.docs) {
      const parentRef = doc.ref.parent.parent;
      if (!parentRef) continue;
      if (existingCheckoutRef && parentRef.id === existingCheckoutRef.id) {
        alreadyInThisCheckout = true;
        continue;
      }
      const parentSnap = await tx.get(parentRef);
      if (parentSnap.get("status") === "open") {
        throw new HttpsError("failed-precondition", REJECT_IN_OTHER_CHECKOUT);
      }
    }
    if (alreadyInThisCheckout) {
      throw new HttpsError("already-exists", REJECT_ALREADY_IN_CHECKOUT);
    }

    // (3) Price: gratis only for the FIRST badge of an eligible user —
    // counting both owned tokens and badges already pending in this
    // checkout (buying three at once: first gratis, rest standard).
    let pendingBadgeItems = 0;
    if (existingCheckoutRef) {
      const itemsSnap = await tx.get(existingCheckoutRef.collection("items"));
      pendingBadgeItems = itemsSnap.docs.filter((d) =>
        isBadgeItem(d.data() as CheckoutItemEntity)
      ).length;
    }
    const free =
      eligibleFree && activeTokenCount === 0 && pendingBadgeItems === 0;
    const variant = free ? freeVariant : standardVariant;
    const unitPrice = priceForTier(variant.unitPrice, "none");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new HttpsError(
        "failed-precondition",
        `Badge variant ${variant.id} has an invalid unitPrice`
      );
    }
    return { unitPrice, free, variantId: variant.id, existingCheckoutRef };
  };

  if (dryRun) {
    const quote = await database.runTransaction(runChecks);
    return {
      checkoutId: quote.existingCheckoutRef?.id ?? null,
      tokenId,
      unitPrice: quote.unitPrice,
      free: quote.free,
    };
  }

  const result = await database.runTransaction(async (tx) => {
    const quote = await runChecks(tx);
    const checkoutRef =
      quote.existingCheckoutRef ?? database.collection("checkouts").doc();

    const item: CheckoutItemEntity = {
      workshop: "diverses",
      // Variant labels are self-contained ("Badge" / "Badge (gratis)").
      description: (quote.free ? freeVariant.label : standardVariant.label) ||
        catalog.name,
      origin: "manual",
      catalogId: catalogRef,
      variantId: quote.variantId,
      pricingModel: "direct",
      created: now,
      quantity: 1,
      unitPrice: quote.unitPrice,
      totalPrice: quote.unitPrice,
      tokenId,
      badgeSdmCounter: sdmCounter,
    };

    if (!quote.existingCheckoutRef) {
      // No open checkout yet (badge tapped right after sign-in): create
      // one, mirroring purchaseMembership. `materialbezug` waives the
      // entry fee, so the bill is just the badge.
      const newCheckout: CheckoutEntity = {
        userId: callerRef as DocumentReference,
        status: "open",
        usageType: "materialbezug",
        created: now,
        workshopsVisited: [],
        persons: [
          {
            name: formatFullName(user, user.email ?? ""),
            email: user.email ?? "",
            userType: user.userType ?? "erwachsen",
            userRef: callerRef as DocumentReference,
          },
        ],
        modifiedBy: callerRef.id,
        modifiedAt: now,
      };
      tx.set(checkoutRef, newCheckout);
    } else {
      tx.update(checkoutRef, { modifiedBy: callerRef.id, modifiedAt: now });
    }
    tx.set(checkoutRef.collection("items").doc(), item);
    return { ...quote, checkoutRef };
  });

  logger.info("Added self-service badge to checkout", {
    userId: callerRef.id,
    tokenId,
    checkoutId: result.checkoutRef.id,
    unitPrice: result.unitPrice,
    free: result.free,
    reusedExistingCheckout: !!result.existingCheckoutRef,
  });

  return {
    checkoutId: result.checkoutRef.id,
    tokenId,
    unitPrice: result.unitPrice,
    free: result.free,
  };
}

export const addBadgeToCheckoutHandler = async (
  request: CallableRequest<AddBadgeToCheckoutRequest>
): Promise<AddBadgeToCheckoutResponse> =>
  handleAddBadgeToCheckout(
    request.data,
    {
      authUid: request.auth?.uid,
      authToken: request.auth?.token as Record<string, unknown> | undefined,
    },
    diversificationMasterKey.value()
  );
