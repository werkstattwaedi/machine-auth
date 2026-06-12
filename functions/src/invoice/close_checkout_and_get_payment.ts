// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callable: submit a checkout (close an open one or create-and-close a new
 * one for the anonymous flow) and return the payment QR data in a single
 * round-trip.
 *
 * Replaces the previous flow where the client wrote the checkout doc, an
 * async Firestore trigger created the bill, and the client then made a
 * second callable round-trip for QR data. That chain stalled on the
 * anonymous path because the security rule for `checkouts` requires
 * `isSignedIn()` for reads, so the client could never observe `billRef`.
 *
 * The Firestore triggers in `create_bill.ts` remain as idempotent safety
 * nets (their guards skip when `billRef` is already set).
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import {
  getFirestore,
  FieldValue,
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
  CheckoutPersonEntity,
  CheckoutSummaryEntity,
  ItemOrigin,
  ItemType,
  UsageType,
} from "../types/firestore_entities";
import { usageDiscount, isMachineItem, isSameBusinessDay } from "@oww/shared";
import type { BillEntity } from "./types";
import { buildPaymentData, type PaymentData } from "./get_payment_qr_data";
import { allocateBill } from "./create_bill";
import {
  loadMembershipCatalogId,
  detectMembershipKindForItems,
} from "../membership/shared";

/**
 * True iff any item is a membership-fee SKU. Resolved from the
 * `config/catalog-references.membership` catalog doc; returns false when no
 * membership SKU is configured. Used for the `intern` loophole guard
 * (issue #284).
 */
function hasMembershipItem(
  items: CheckoutItemEntity[],
  membershipCatalogId: string | null,
): boolean {
  if (!membershipCatalogId) return false;
  return detectMembershipKindForItems(items, membershipCatalogId) !== null;
}

/** True iff any item is machine usage (`type === "machine"`). */
function hasMachineUsage(items: { type?: string | null }[]): boolean {
  return items.some((i) => isMachineItem(i));
}

/**
 * The user the caller is authorized to act as.
 *
 * - Real login: `request.auth.uid` equals the user doc id.
 * - Kiosk tag-tap: `request.auth.uid` is a synthetic UID (`tag:…`); the
 *   `actsAs` claim names the real user. This indirection means the kiosk
 *   session is a different Firebase principal than the user — it cannot
 *   inherit any persistent custom claims (e.g. `admin`).
 *
 * Returns null for unauthenticated callers (the truly-anonymous flow).
 */
function effectiveUid(request: CallableRequest<unknown>): string | null {
  const claims = request.auth?.token as { actsAs?: unknown } | undefined;
  if (typeof claims?.actsAs === "string" && claims.actsAs.length > 0) {
    return claims.actsAs;
  }
  return request.auth?.uid ?? null;
}

/**
 * True iff the caller signed in via Firebase Anonymous Auth. Used to
 * scope the null-userId existing-checkout close path: the eager-anon
 * flow (issue #151) creates a `userId: null` checkout when the visitor
 * adds the first item, so the server must accept that anon session
 * later — but only that anon session — when it submits.
 */
function isAnonymousCaller(request: CallableRequest<unknown>): boolean {
  const provider = (request.auth?.token as
    | { firebase?: { sign_in_provider?: string } }
    | undefined)?.firebase?.sign_in_provider;
  return provider === "anonymous";
}

/**
 * Exported for unit tests. Returns the *standard* (regular) per-person
 * entry fee for a user type from `config/pricing.entryFees.{userType}.regular`.
 *
 * There is one standard fee per user type; the usage-type discount
 * (`USAGE_TYPE_DISCOUNTS`, hardcoded in `@oww/shared`) is the fractional
 * multiplier applied on top — so `ermaessigt` is `regular × 0.5`,
 * `intern`/`volunteering`/`materialbezug`/`hangenmoos` waive the entry fee
 * entirely (issue #284). The `usageType` argument is retained for log /
 * error context only; the lookup is always the `regular` row.
 *
 * Throws `failed-precondition` when the config doc is missing or doesn't
 * contain a `regular` fee for the user type (issue #149). The previous
 * silent-fallback path shipped hardcoded fees that diverged from the
 * seeded production prices, so a misconfigured Firestore document would
 * have silently misbilled every checkout. We bail loudly here so staff
 * sees the failure immediately rather than discovering it at month-end
 * reconciliation.
 */
export function entryFeeFor(
  userType: string,
  usageType: string,
  configFees: Record<string, Record<string, number>> | null,
): number {
  if (configFees) {
    const row = configFees[userType];
    if (row && "regular" in row) {
      const standard = row["regular"];
      if (typeof standard === "number") {
        return standard * usageDiscount(usageType as UsageType).entryFee;
      }
    }
  }
  logger.error("Pricing config missing standard (regular) entry fee row", {
    userType,
    usageType,
  });
  throw new HttpsError(
    "failed-precondition",
    `Pricing config missing standard entry fee for ${userType}`,
  );
}

/**
 * Loophole guards (issue #284). Enforced server-side because the bill
 * amount is authoritative here — a client could otherwise post a usage
 * type that waives charges it shouldn't.
 *
 *  - `materialbezug` ("only picking up material") cannot coexist with
 *    machine usage: if you ran a machine, it's not a pure material pickup.
 *  - `intern` (everything on the house) cannot coexist with buying a
 *    membership: a paid membership must not be zeroed out.
 *
 * Throws `failed-precondition` on violation. `hasMembershipItem` is
 * resolved by the caller (it needs catalog refs the summary doesn't carry).
 */
export function assertUsageTypeAllowed(
  usageType: UsageType,
  opts: { hasMachineUsage: boolean; hasMembershipItem: boolean },
): void {
  if (usageType === "materialbezug" && opts.hasMachineUsage) {
    throw new HttpsError(
      "failed-precondition",
      "Materialbezug ist nicht möglich, wenn Maschinen genutzt wurden.",
    );
  }
  if (usageType === "intern" && opts.hasMembershipItem) {
    throw new HttpsError(
      "failed-precondition",
      "Interne Nutzung ist nicht möglich, wenn eine Mitgliedschaft gekauft wird.",
    );
  }
}

/**
 * A membership generates an invoice, and the invoice PDF silently renders
 * name-only when no billing address is present. So when the cart contains a
 * membership SKU the buyer's user doc MUST carry a complete postal address —
 * captured inline in the checkout membership line item and persisted to the
 * user doc before submit. Server-side backstop (combined-signin refactor) so a
 * client bypassing the inline field can't mint an addressless membership
 * invoice. The invoice resolver reads this same field. Exported for unit tests.
 */
export function assertMembershipBillingAddress(
  address:
    | { street?: string; zip?: string; city?: string }
    | null
    | undefined,
): void {
  if (
    !address ||
    !address.street?.trim() ||
    !address.zip?.trim() ||
    !address.city?.trim()
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Für eine Mitgliedschaft wird eine Rechnungsadresse benötigt.",
    );
  }
}

/**
 * Authoritative summary computation. The bill always uses what this
 * function returns, never the client-supplied summary. This is the
 * structural defense against a client posting `summary.totalPrice: 0.01`
 * for a 25 CHF visit.
 */
/** Exported for unit tests. */
export function recomputeSummary(
  persons: CheckoutPersonEntity[],
  usageType: UsageType,
  items: { type?: string | null; totalPrice: number }[],
  configFees: Record<string, Record<string, number>> | null,
  clientTip: number,
): CheckoutSummaryEntity {
  const round = (n: number) => Math.round(n * 100) / 100;
  const discount = usageDiscount(usageType);

  // RAW (pre-discount) section amounts. `entryFeeFor` returns the standard
  // regular fee already scaled by the entry-fee discount multiplier, so to
  // recover the raw entry fee we divide it back out (the only section whose
  // discount lives in the per-person fee). For waived entry fees (multiplier
  // 0) the raw is the un-waived standard fee.
  //
  // Daily-fee dedup (issue #268): a person flagged `entryFeeWaivedToday`
  // already paid the daily usage fee earlier today (same Zurich business
  // day), so they contribute nothing to the entry-fee section — neither raw
  // nor net. The flag is set authoritatively at close-time
  // (markEntryFeeWaivedToday) from prior bills.
  const standardEntryFees = persons.reduce(
    (sum, p) =>
      sum +
      (p.entryFeeWaivedToday
        ? 0
        : standardEntryFeeFor(p.userType, configFees)),
    0,
  );
  const machineRaw = items
    .filter((i) => isMachineItem(i))
    .reduce((sum, i) => sum + (i.totalPrice ?? 0), 0);
  const materialRaw = items
    .filter((i) => !isMachineItem(i))
    .reduce((sum, i) => sum + (i.totalPrice ?? 0), 0);
  const tipRaw = Math.max(0, clientTip ?? 0);

  // NET (billed) section amounts = raw × per-section discount multiplier.
  const entryFeesNet = standardEntryFees * discount.entryFee;
  const machineNet = machineRaw * discount.machine;
  const materialNet = materialRaw * discount.material;
  const tipNet = tipRaw * discount.tip;

  const totalPrice = round(entryFeesNet + machineNet + materialNet + tipNet);
  const rawTotal = round(standardEntryFees + machineRaw + materialRaw + tipRaw);
  const discountAmount = round(rawTotal - totalPrice);

  // Store RAW section amounts (issue #284) so the invoice can re-render the
  // standard prices and spell out what was waived per section. `totalPrice`
  // is the authoritative net the bill is charged at.
  return {
    totalPrice,
    entryFees: round(standardEntryFees),
    machineCost: round(machineRaw),
    materialCost: round(materialRaw),
    tip: round(tipRaw),
    discountAmount,
  };
}

/**
 * Standard (regular) entry fee per person, before any usage-type discount.
 * Shares the fail-loud config contract with {@link entryFeeFor}.
 */
function standardEntryFeeFor(
  userType: string,
  configFees: Record<string, Record<string, number>> | null,
): number {
  // entryFeeFor with usageType "regular" returns the standard fee unscaled
  // (regular's entry-fee multiplier is 1).
  return entryFeeFor(userType, "regular", configFees);
}

/**
 * Exported for unit tests. Defensive sanity-check on each item before
 * summing it into a bill. Number.isFinite() rejects Infinity / -Infinity
 * / NaN — without it, `Infinity >= 0` would pass the inequality and the
 * Firestore SDK would later reject the write with an opaque error
 * instead of a clean 400 here.
 */
export function isValidItem(item: { quantity?: number; unitPrice?: number; totalPrice?: number }): boolean {
  return (
    typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0 &&
    typeof item.unitPrice === "number" && Number.isFinite(item.unitPrice) && item.unitPrice >= 0 &&
    typeof item.totalPrice === "number" && Number.isFinite(item.totalPrice) && item.totalPrice >= 0
  );
}

/** Log when client-supplied summary diverges from server recompute. */
function logSummaryDivergence(
  context: string,
  client: CheckoutSummaryEntity | undefined,
  server: CheckoutSummaryEntity,
): void {
  if (!client) return;
  if (Math.abs((client.totalPrice ?? 0) - server.totalPrice) > 0.01) {
    logger.warn("Client summary diverges from server recompute", {
      context,
      clientTotal: client.totalPrice,
      serverTotal: server.totalPrice,
    });
  }
}

const ALLOWED_USER_TYPES = ["erwachsen", "kind", "firma"] as const;
type CanonicalUserType = (typeof ALLOWED_USER_TYPES)[number];

/**
 * For a registered user (real login or tag-tap session), the
 * account-holder person's userType must match the user's stored profile
 * — otherwise an adult member could post `userType: "kind"` for their own
 * line and pay the child entry fee. We override silently rather than
 * reject so legitimate stale client-side state (e.g., a userType change
 * since the form was rendered) doesn't fail the checkout.
 *
 * The account holder is identified by *identity* — the person whose
 * `userRef.id` equals the caller's user id — not by array position. When
 * the holder removes themselves from the visit (e.g. a family payer
 * billing only their kids) no person matches and we override nothing, so
 * each remaining person keeps their own userType. Matching by position
 * (`persons[0]`) instead force-stamped whoever sat first — a child after
 * self-removal — with the adult userType and over-billed them (issue
 * #466).
 *
 * Persons that don't carry the caller's `userRef` (guests, family
 * members) have no canonical record to cross-check against; they remain
 * trusted as the account holder vouches for them.
 *
 * Returns a (possibly mutated) copy of the persons array. Logs a warning
 * if an override happened.
 */
async function enforceAccountHolderUserType(
  db: FirebaseFirestore.Firestore,
  persons: CheckoutPersonEntity[],
  userIdRef: DocumentReference | null,
  context: string,
): Promise<CheckoutPersonEntity[]> {
  // Truly anonymous: no user record to compare against; cannot validate.
  // The wider system trusts whoever is in front of the screen here.
  if (!userIdRef || persons.length === 0) return persons;

  const userSnap = await userIdRef.get();
  if (!userSnap.exists) return persons;
  const stored = userSnap.data()?.userType as CanonicalUserType | undefined;
  if (!stored || !ALLOWED_USER_TYPES.includes(stored)) return persons;

  // Identify the account holder by identity, not position. If they aren't
  // on the roster (self-removal), there is nothing to override.
  const holderIndex = persons.findIndex(
    (p) => p.userRef?.id === userIdRef.id,
  );
  if (holderIndex === -1) return persons;

  const holder = persons[holderIndex];
  if (holder.userType === stored) return persons;

  logger.warn("Overriding client-supplied account-holder userType", {
    context,
    userId: userIdRef.id,
    clientUserType: holder.userType,
    storedUserType: stored,
  });

  // Replace just the account-holder person; preserve the rest.
  const corrected = [...persons];
  corrected[holderIndex] = { ...holder, userType: stored };
  return corrected;
}

/**
 * Daily usage-fee dedup (issue #268).
 *
 * The entry ("Nutzungs-") fee is billed at most once per Zurich business
 * day (boundary 03:00) per *named* person. A named person is one carrying a
 * `userRef` — they map to a real account. Anonymous / guest persons (no
 * `userRef`) are always charged.
 *
 * For each named person we ask: did an *earlier* closed checkout on the same
 * business day already bill them the entry fee? "Earlier closed checkout"
 * means a `checkouts` doc with `status == "closed"`, owned by — or listing —
 * that person, whose close instant falls on the same business day and which
 * billed a non-zero entry fee for them.
 *
 * Query strategy: rather than a per-person Firestore query (persons can be
 * arbitrary family members), we read the closed checkouts the *current
 * checkout's owner* already closed today and collect the set of person
 * userRef ids that were charged an entry fee in any of them. Family members
 * are billed inside the account holder's checkout (persons[] carries their
 * userRef), so the owner's same-day history is the authoritative record of
 * "who already paid today" for this account. The owner falls out naturally:
 * they appear as persons[0] with their own userRef.
 *
 * Returns a copy of `persons` with `entryFeeWaivedToday: true` set on each
 * person already charged today. Pure read; performs no writes.
 */
export async function markEntryFeeWaivedToday(
  db: FirebaseFirestore.Firestore,
  persons: CheckoutPersonEntity[],
  ownerRef: DocumentReference | null,
  closeAt: Date,
  currentCheckoutId: string | null,
  configFees: Record<string, Record<string, number>> | null,
): Promise<CheckoutPersonEntity[]> {
  // Truly anonymous checkout (no owner) — nobody to dedup against.
  if (!ownerRef) return persons;
  // No named persons → nothing to waive.
  if (!persons.some((p) => p.userRef)) return persons;

  // All closed checkouts this account owns. Filtered to the same business
  // day in memory (Firestore can't express the 03:00 boundary in a range
  // query without a precomputed key, and the per-account volume is tiny).
  const priorSnap = await db
    .collection("checkouts")
    .where("userId", "==", ownerRef)
    .where("status", "==", "closed")
    .get();

  // Collect userRef ids that were billed a NON-ZERO entry fee on the same
  // business day in any *other* closed checkout.
  const chargedTodayUserIds = new Set<string>();
  for (const doc of priorSnap.docs) {
    if (currentCheckoutId && doc.id === currentCheckoutId) continue;
    const prior = doc.data() as CheckoutEntity;
    // Use the close instant; fall back to created for older docs.
    const priorInstant = (prior.closedAt ?? prior.created)?.toDate?.();
    if (!priorInstant) continue;
    if (!isSameBusinessDay(priorInstant, closeAt)) continue;

    const priorDiscount = usageDiscount(prior.usageType);
    for (const person of prior.persons ?? []) {
      if (!person.userRef) continue;
      // The person was actually charged iff their fee was neither
      // dedup-waived nor usage-type-waived (entryFee multiplier 0).
      if (person.entryFeeWaivedToday) continue;
      if (priorDiscount.entryFee === 0) continue;
      const standard = safeStandardEntryFee(person.userType, configFees);
      if (standard <= 0) continue;
      chargedTodayUserIds.add(person.userRef.id);
    }
  }

  if (chargedTodayUserIds.size === 0) return persons;

  return persons.map((p) =>
    p.userRef && chargedTodayUserIds.has(p.userRef.id)
      ? { ...p, entryFeeWaivedToday: true }
      : p,
  );
}

/**
 * Standard entry fee that never throws — returns 0 when the config row is
 * missing. Used only by the dedup scan, where a missing row means "no fee
 * was charged" and must not abort the close. The authoritative billing path
 * (`standardEntryFeeFor` / `entryFeeFor`) still fails loud (issue #149).
 */
function safeStandardEntryFee(
  userType: string,
  configFees: Record<string, Record<string, number>> | null,
): number {
  const row = configFees?.[userType];
  const standard = row && "regular" in row ? row["regular"] : undefined;
  return typeof standard === "number" ? standard : 0;
}

interface NewCheckoutItemInput {
  workshop: string;
  description: string;
  origin: ItemOrigin;
  type?: ItemType | null;
  catalogId: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  formInputs?: { quantity: number; unit: string }[];
  pricingModel?: string | null;
}

interface NewCheckoutInput {
  /**
   * Owning user doc id, or null for a truly anonymous checkout. The original
   * pre-callable flow used `addDoc` with `userId: identifiedUserRef ?? null`,
   * so an account/tag user with no pre-existing open checkout still gets
   * their ref set on the new doc.
   */
  userId: string | null;
  workshopsVisited: string[];
  items: NewCheckoutItemInput[];
}

interface CloseCheckoutRequest {
  /** Existing open checkout to close. Mutually exclusive with `newCheckout`. */
  checkoutId?: string;
  /** Data for the anonymous flow that creates a closed checkout in one shot. */
  newCheckout?: NewCheckoutInput;
  usageType: UsageType;
  persons: CheckoutPersonEntity[];
  summary: CheckoutSummaryEntity;
}

export const closeCheckoutAndGetPaymentHandler = async (
  request: CallableRequest<CloseCheckoutRequest>
) => {
  const data = request.data ?? ({} as CloseCheckoutRequest);
  const { checkoutId, newCheckout, usageType, persons, summary } = data;

  if (!Array.isArray(persons) || persons.length === 0) {
    throw new HttpsError("invalid-argument", "persons is required");
  }
  if (!usageType) {
    throw new HttpsError("invalid-argument", "usageType is required");
  }

  const callerUid = effectiveUid(request);
  const isAnonymous = isAnonymousCaller(request);
  // The raw Firebase Auth UID stamped onto `firebaseUid` on new
  // checkouts (issue #318). Distinct from `callerUid`, which may have
  // been rewritten to the `actsAs` target for tag-tap sessions: the
  // stamp tracks the Firebase principal, not the user it represents,
  // so the cleanup job can pair an expired anon auth user with their
  // leftover checkouts even when the session was authenticated.
  const firebaseAuthUid = request.auth?.uid ?? null;

  if (checkoutId) {
    return closeExistingCheckout(callerUid, isAnonymous, {
      checkoutId,
      usageType,
      persons,
      clientSummary: summary,
    });
  }
  if (newCheckout) {
    return createAnonymousCheckout(callerUid, firebaseAuthUid, {
      newCheckout,
      usageType,
      persons,
      clientSummary: summary,
    });
  }
  throw new HttpsError(
    "invalid-argument",
    "Either checkoutId or newCheckout is required",
  );
};

async function closeExistingCheckout(
  callerUid: string | null,
  isAnonymous: boolean,
  args: {
    checkoutId: string;
    usageType: UsageType;
    persons: CheckoutPersonEntity[];
    clientSummary?: CheckoutSummaryEntity;
  },
): Promise<PaymentData> {
  if (!callerUid) {
    throw new HttpsError(
      "unauthenticated",
      "Sign-in required to close an existing checkout",
    );
  }

  const db = getFirestore();
  const checkoutRef = db.collection("checkouts").doc(args.checkoutId);
  const billRef = db.collection("bills").doc();

  // Pricing config read outside the transaction — it's not strongly tied
  // to the checkout's atomicity and changes infrequently. Issue #149:
  // entryFeeFor throws failed-precondition for any unknown row, so a
  // missing config/pricing surfaces as a clean Cloud Functions error
  // (visible to the client + ops logs) rather than silently substituting
  // hardcoded prices.
  const pricingDoc = await db.doc("config/pricing").get();
  const configFees =
    (pricingDoc.data() as { entryFees?: Record<string, Record<string, number>> } | undefined)
      ?.entryFees ?? null;

  // Membership SKU id for the `intern` loophole guard (issue #284). Read
  // outside the transaction — config changes infrequently and it isn't
  // tied to the checkout's atomicity.
  const membershipCatalogId = await loadMembershipCatalogId(db);

  // Cross-check the primary person's userType against the user's stored
  // profile. We know the userIdRef from callerUid; fetched outside the
  // transaction to keep the txn small. A registered user can't claim
  // child pricing they're not entitled to. Anonymous callers have no
  // users/{uid} doc (the synthetic anon UID isn't a registered user),
  // so we skip the cross-check — there's no canonical record to compare
  // against and the wider system already trusts whoever is in front of
  // the screen for the truly-anonymous flow.
  const userRef = isAnonymous ? null : db.collection("users").doc(callerUid);
  const enforcedPersons = await enforceAccountHolderUserType(
    db,
    args.persons,
    userRef,
    `closeExistingCheckout ${args.checkoutId}`,
  );

  // The buyer's billing address (used to backstop membership invoices below).
  // Read outside the transaction — it's the same field the invoice resolver
  // reads, written by the client before submit.
  const memberBillingAddress = userRef
    ? ((await userRef.get()).data()?.billingAddress as
        | { street?: string; zip?: string; city?: string }
        | undefined) ?? null
    : null;

  // Daily usage-fee dedup (issue #268): waive the entry fee for any named
  // person who already paid it earlier on the same Zurich business day.
  // The owner is the checkout's userId; for the truly-anon path userRef is
  // null and the dedup is a no-op. Read outside the transaction — it's a
  // historical scan that doesn't participate in the close's atomicity.
  const dedupedPersons = await markEntryFeeWaivedToday(
    db,
    enforcedPersons,
    userRef,
    new Date(),
    args.checkoutId,
    configFees,
  );

  const result = await db.runTransaction(async (tx) => {
    const checkoutDoc = await tx.get(checkoutRef);
    if (!checkoutDoc.exists) {
      throw new HttpsError("not-found", `Checkout ${args.checkoutId} not found`);
    }
    const checkout = checkoutDoc.data() as CheckoutEntity;

    // The caller must be the checkout's principal. Two valid paths:
    //
    // 1. Registered user / kiosk tag-tap: `checkout.userId` is set and
    //    must match `callerUid` (real login uid, or actsAs target for a
    //    tag-tap session).
    // 2. Eager-anon flow (issue #151): `checkout.userId` is null. The
    //    Firestore rules permit any anon-auth session to read/update a
    //    null-userId open checkout, so we add a server-side scoping that
    //    mirrors the wizard's `modifiedBy == anonUid` query: only the
    //    anon session that opened the cart may close it. The
    //    sign-in-provider gate keeps real-user spoofing out — a real
    //    user cannot accidentally (or deliberately) submit a stranger's
    //    null-userId cart even if they know its id.
    if (checkout.userId) {
      if (checkout.userId.id !== callerUid) {
        throw new HttpsError("permission-denied", "Not the checkout owner");
      }
    } else {
      if (!isAnonymous) {
        throw new HttpsError("permission-denied", "Not the checkout owner");
      }
      if (checkout.modifiedBy !== callerUid) {
        throw new HttpsError("permission-denied", "Not the checkout owner");
      }
    }

    // Idempotency: if the safety-net trigger already produced a bill for
    // this checkout, return that bill's payment data instead of duplicating.
    if (checkout.billRef) {
      const existingBillDoc = await tx.get(checkout.billRef);
      if (existingBillDoc.exists) {
        const existingBill = existingBillDoc.data() as BillEntity;
        return {
          bill: existingBill,
          billId: checkout.billRef.id,
          payer: payerFromPersons(checkout.persons ?? enforcedPersons),
        };
      }
    }

    if (checkout.status !== "open") {
      throw new HttpsError(
        "failed-precondition",
        `Checkout ${args.checkoutId} is not open`,
      );
    }

    // Load the items subcollection inside the transaction for the
    // server-side recompute. Anything that doesn't pass isValidItem is
    // dropped — items already in Firestore have passed the rule-level
    // validation, so this is a defensive secondary check.
    const itemsSnap = await tx.get(checkoutRef.collection("items"));
    const items = itemsSnap.docs
      .map((d) => d.data() as CheckoutItemEntity)
      .filter(isValidItem);

    // Loophole guards (issue #284): reject materialbezug-with-machine and
    // intern-with-membership before billing.
    const membershipPresent = hasMembershipItem(items, membershipCatalogId);
    assertUsageTypeAllowed(args.usageType, {
      hasMachineUsage: hasMachineUsage(items),
      hasMembershipItem: membershipPresent,
    });
    // A membership invoice needs a postal address (combined-signin refactor).
    // The buyer's user doc carries it (written from the inline checkout field).
    if (membershipPresent) {
      assertMembershipBillingAddress(memberBillingAddress);
    }

    const summary = recomputeSummary(
      dedupedPersons,
      args.usageType,
      items,
      configFees,
      args.clientSummary?.tip ?? 0,
    );
    logSummaryDivergence(`closeExistingCheckout ${args.checkoutId}`, args.clientSummary, summary);

    const bill = await allocateBill(tx, db, {
      userId: checkout.userId,
      checkoutRefs: [checkoutRef],
      amount: summary.totalPrice,
      billRef,
    });

    tx.update(checkoutRef, {
      status: "closed",
      usageType: args.usageType,
      persons: dedupedPersons,
      closedAt: FieldValue.serverTimestamp(),
      notes: null,
      summary,
      modifiedBy: callerUid,
      modifiedAt: FieldValue.serverTimestamp(),
      billRef,
    });

    return { bill, billId: billRef.id, payer: payerFromPersons(dedupedPersons) };
  });

  return buildPaymentData(result.bill, result.payer, result.billId, args.checkoutId);
}

async function createAnonymousCheckout(
  callerUid: string | null,
  firebaseAuthUid: string | null,
  args: {
    newCheckout: NewCheckoutInput;
    usageType: UsageType;
    persons: CheckoutPersonEntity[];
    clientSummary?: CheckoutSummaryEntity;
  },
): Promise<PaymentData> {
  // Anti-spoofing: the caller may only stamp their own userId on a new
  // checkout. Unauthenticated callers always create a null-userId checkout
  // (the truly anonymous path); authenticated callers (real login OR tag
  // session via actsAs) may either omit userId or pass an id that matches
  // their effective UID. This preserves the original
  // "identifiedUserRef ?? null" semantic while blocking forgery.
  const requestedUserId = args.newCheckout.userId ?? null;
  if (requestedUserId && requestedUserId !== callerUid) {
    throw new HttpsError(
      "permission-denied",
      "userId must match the caller",
    );
  }
  const effectiveUserId = callerUid ? requestedUserId : null;

  // Items are validated and summed server-side. Negative quantities or
  // prices in the request are silently dropped (rule-level rejection
  // would have caught them on a direct write; here we just don't bill).
  const validItems = args.newCheckout.items.filter(isValidItem);
  if (validItems.length !== args.newCheckout.items.length) {
    logger.warn("createAnonymousCheckout dropped invalid items", {
      total: args.newCheckout.items.length,
      kept: validItems.length,
    });
  }

  // Loophole guard (issue #284): materialbezug cannot coexist with machine
  // usage. The membership guard is a no-op on this path — the anonymous
  // create input carries no variantId, and memberships are bought through
  // purchaseMembership (which closes via closeExistingCheckout).
  assertUsageTypeAllowed(args.usageType, {
    hasMachineUsage: hasMachineUsage(validItems),
    hasMembershipItem: false,
  });

  const db = getFirestore();
  const pricingDoc = await db.doc("config/pricing").get();
  const configFees =
    (pricingDoc.data() as { entryFees?: Record<string, Record<string, number>> } | undefined)
      ?.entryFees ?? null;

  const checkoutRef = db.collection("checkouts").doc();
  const billRef = db.collection("bills").doc();
  const userIdRef = effectiveUserId
    ? db.collection("users").doc(effectiveUserId)
    : null;

  // For registered users (tag-tap path falls through here when no open
  // checkout exists), cross-check the primary person's userType against
  // the stored profile so they can't claim child pricing they aren't
  // entitled to. The truly-anonymous path (userIdRef === null) has no
  // record to compare against.
  const enforcedPersons = await enforceAccountHolderUserType(
    db,
    args.persons,
    userIdRef,
    "createAnonymousCheckout",
  );

  // Daily usage-fee dedup (issue #268): a registered user / tag-tap session
  // landing here (no open checkout existed) may already have closed a
  // checkout earlier the same Zurich business day. Waive the entry fee for
  // any named person already charged today. Truly-anon (userIdRef === null)
  // is a no-op.
  const dedupedPersons = await markEntryFeeWaivedToday(
    db,
    enforcedPersons,
    userIdRef,
    new Date(),
    null,
    configFees,
  );

  const summary = recomputeSummary(
    dedupedPersons,
    args.usageType,
    validItems,
    configFees,
    args.clientSummary?.tip ?? 0,
  );
  logSummaryDivergence("createAnonymousCheckout", args.clientSummary, summary);

  // Pre-allocate item refs so they can be written inside the transaction.
  const itemRefs = validItems.map(() => checkoutRef.collection("items").doc());

  const result = await db.runTransaction(async (tx) => {
    const bill = await allocateBill(tx, db, {
      userId: userIdRef,
      checkoutRefs: [checkoutRef],
      amount: summary.totalPrice,
      billRef,
    });

    const now = Timestamp.now();
    // Issue #318: stamp the originating Firebase Auth UID on every
    // client-side create — anonymous OR signed-in / tag-tap. The
    // cleanup job uses this to pair an expired anon auth user with
    // their leftover checkouts; signed-in users' UIDs never appear in
    // the expired-anon list so their checkouts are safe. Null only for
    // unauthenticated callers, which can't reach this path today.
    tx.set(checkoutRef, {
      userId: userIdRef,
      status: "closed",
      usageType: args.usageType,
      created: now,
      workshopsVisited: args.newCheckout.workshopsVisited,
      persons: dedupedPersons,
      modifiedBy: callerUid,
      modifiedAt: FieldValue.serverTimestamp(),
      firebaseUid: firebaseAuthUid,
      closedAt: FieldValue.serverTimestamp(),
      notes: null,
      summary,
      billRef,
    });

    validItems.forEach((item, idx) => {
      const itemDoc: CheckoutItemEntity = {
        workshop: item.workshop,
        description: item.description,
        origin: item.origin,
        catalogId: item.catalogId
          ? db.collection("catalog").doc(item.catalogId)
          : null,
        created: now,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        ...(item.type ? { type: item.type } : {}),
        ...(item.formInputs ? { formInputs: item.formInputs } : {}),
        ...(item.pricingModel
          ? { pricingModel: item.pricingModel as CheckoutItemEntity["pricingModel"] }
          : {}),
      };
      tx.set(itemRefs[idx], itemDoc);
    });

    return { bill, billId: billRef.id, payer: payerFromPersons(dedupedPersons) };
  });

  return buildPaymentData(result.bill, result.payer, result.billId, checkoutRef.id);
}

function payerFromPersons(
  persons: CheckoutPersonEntity[],
): { name: string; email?: string } | null {
  const primary = persons[0];
  if (!primary) return null;
  return { name: primary.name, email: primary.email };
}
