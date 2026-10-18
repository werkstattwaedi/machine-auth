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
  PaymentMethod,
  UsageType,
} from "../types/firestore_entities";
import {
  PAYMENT_METHOD_INFO,
  computeCheckoutSummary,
  deriveVisitUsageType,
  isMachineItem,
  isOwnerOnlyUsage,
  isPaymentMethod,
  machineUsageBlocked,
  sameDayCoveredPersons,
  samedayPersonKey,
  type SameDayCheckout,
  USAGE_TYPE_DISCOUNTS,
  USAGE_TYPE_LABELS,
  usageDiscount,
  type UsagePerson,
} from "@oww/shared";
import type { BillEntity } from "./types";
import { buildPaymentData, type PaymentData } from "./get_payment_qr_data";
import { allocateBill } from "./create_bill";
import {
  assertPaymentMethodAllowed,
  billCommitFields,
  isBillCommitted,
} from "./commit_payment_method";
import {
  loadMembershipCatalogId,
  detectMembershipKindForItems,
} from "../membership/shared";
import { isBadgeItem } from "../badge/shared";

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
export function effectiveUid(request: CallableRequest<unknown>): string | null {
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
export function isAnonymousCaller(request: CallableRequest<unknown>): boolean {
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
 *  - Machine usage cannot be billed when every person is `materialbezug`
 *    (Begleitung / nur Materialbezug, CHK-8): the visit's type would waive
 *    it. `persons` carry their own types (issue #605); without them the
 *    visit's `usageType` stands in for one person.
 *  - `intern` (everything on the house) cannot coexist with buying a
 *    membership: a paid membership must not be zeroed out.
 *  - `intern` cannot coexist with a PAID badge either (same zeroing
 *    loophole); a gratis badge passes — there is nothing to zero.
 *
 * Throws `failed-precondition` on violation. `hasMembershipItem` /
 * `hasPaidBadgeItem` are resolved by the caller (they need item fields the
 * summary doesn't carry).
 */
export function assertUsageTypeAllowed(
  usageType: UsageType,
  opts: {
    persons?: readonly UsagePerson[];
    hasMachineUsage: boolean;
    hasMembershipItem: boolean;
    hasPaidBadgeItem?: boolean;
  },
): void {
  if (machineUsageBlocked(opts.persons ?? [{}], opts.hasMachineUsage, usageType)) {
    throw new HttpsError("failed-precondition", MACHINE_USAGE_BLOCKED_MESSAGE);
  }
  if (usageType === "intern" && opts.hasMembershipItem) {
    throw new HttpsError(
      "failed-precondition",
      "Interne Nutzung ist nicht möglich, wenn eine Mitgliedschaft gekauft wird.",
    );
  }
  if (usageType === "intern" && opts.hasPaidBadgeItem) {
    throw new HttpsError(
      "failed-precondition",
      "Interne Nutzung ist nicht möglich, wenn ein Badge gekauft wird.",
    );
  }
}

/**
 * Badge items must belong to an identified checkout: association at close
 * writes `tokens/{tokenId} → checkout.userId`, so a null-userId (anonymous)
 * checkout would orphan the badge. Rules already deny client writes of
 * `tokenId` and addBadgeToCheckout requires a signed-in principal — this is
 * the close-time backstop. Exported for unit tests.
 */
export function assertBadgeItemsBelongToOwner(
  items: Pick<CheckoutItemEntity, "tokenId">[],
  userId: DocumentReference | null | undefined,
): void {
  if (!userId && items.some(isBadgeItem)) {
    throw new HttpsError(
      "failed-precondition",
      "Für einen Badge-Kauf ist eine Anmeldung nötig.",
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
 * The pricing tail every closed checkout goes through — item validation,
 * the usage-type loophole guards (issue #284) and the authoritative
 * summary — shared by `closeExistingCheckout` and the admin correction
 * callable (ADR-0042), so a corrected re-issue is priced by exactly the
 * same rules as the original close. Identity-bound guards (roster,
 * account-holder user type, badge owner, membership address) stay with
 * their callers. Pure: no I/O.
 *
 * Anything that doesn't pass `isValidItem` is dropped — items already in
 * Firestore have passed the rule-level validation, so this is a defensive
 * secondary check.
 */
export function priceCheckoutItems(args: {
  persons: CheckoutPersonEntity[];
  /** The visit's type (`resolvePersonUsageTypes`). */
  usageType: UsageType;
  items: CheckoutItemEntity[];
  configFees: Record<string, Record<string, number>> | null;
  membershipCatalogId: string | null;
  tip: number;
}): {
  items: CheckoutItemEntity[];
  summary: CheckoutSummaryEntity;
  membershipPresent: boolean;
} {
  const items = args.items.filter(isValidItem);
  const membershipPresent = hasMembershipItem(items, args.membershipCatalogId);
  assertUsageTypeAllowed(args.usageType, {
    persons: args.persons,
    hasMachineUsage: hasMachineUsage(items),
    hasMembershipItem: membershipPresent,
    hasPaidBadgeItem: items.some((i) => isBadgeItem(i) && i.totalPrice > 0),
  });
  const summary = recomputeSummary(
    args.persons,
    args.usageType,
    items,
    args.configFees,
    args.tip,
  );
  return { items, summary, membershipPresent };
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
  // The arithmetic lives in @oww/shared (ADR-0042) so the wizard's live
  // receipt and the admin correction estimate agree with this authoritative
  // result; only the fail-loud config lookup stays here.
  return computeCheckoutSummary({
    persons,
    usageType,
    items,
    standardEntryFee: (userType) => standardEntryFeeFor(userType, configFees),
    tip: clientTip,
  });
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

/** The close's refusal when machine time meets an all-Begleitung visit (CHK-8). */
export const MACHINE_USAGE_BLOCKED_MESSAGE =
  "Maschinen wurden genutzt, aber alle Personen sind als „Begleitung / nur Materialbezug“ erfasst.";

/** True iff `t` names a usage type. */
export function isUsageType(t: unknown): t is UsageType {
  return typeof t === "string" && Object.prototype.hasOwnProperty.call(USAGE_TYPE_DISCOUNTS, t);
}

/**
 * Check every person's usage type and derive the visit's (issue #605,
 * ADR-0050). Shared by the close and the admin correction.
 *
 * - Every person must carry a valid `usageType` (`invalid-argument`
 *   otherwise) — there is no visit-wide fallback for writes; only readers
 *   of historical docs fall back to `checkout.usageType`.
 * - An owner-only type (Freiwilligengruppe / Interne Nutzung) is refused on
 *   any line but the owner's (`userRef.id === ownerId`) and while anyone
 *   else is on the visit (CHK-32).
 *
 * The visit's type is `deriveVisitUsageType` over the persons. Pure.
 */
export function resolvePersonUsageTypes(
  persons: CheckoutPersonEntity[],
  ownerId: string | null,
): { persons: CheckoutPersonEntity[]; usageType: UsageType } {
  if (!persons.every((p) => isUsageType(p.usageType))) {
    throw new HttpsError(
      "invalid-argument",
      "Bitte Seite neu laden: Nutzungsart pro Person fehlt.",
    );
  }
  const isOwner = (p: CheckoutPersonEntity) =>
    ownerId !== null && p.userRef?.id === ownerId;

  for (const p of persons) {
    const t = p.usageType as UsageType;
    if (!isOwnerOnlyUsage(t)) continue;
    if (!isOwner(p)) {
      throw new HttpsError(
        "invalid-argument",
        `${USAGE_TYPE_LABELS[t]} ist nur für die angemeldete Person möglich.`,
      );
    }
    if (persons.length > 1) {
      throw new HttpsError(
        "invalid-argument",
        `${USAGE_TYPE_LABELS[t]} ist nicht möglich, solange weitere Personen erfasst sind.`,
      );
    }
  }

  const usageType = deriveVisitUsageType(
    persons.map((p) => ({ usageType: p.usageType, isOwner: isOwner(p) })),
  );
  return { persons, usageType };
}

/**
 * Keep a line's `savedPersonId` only when it names one of the owner's saved
 * persons (issue #605), so a line never links a doc that isn't theirs (the
 * same-day waiver matches by name, ADR-0050 — the id is a plain link). Dropped with a warning — never failing the
 * payment — when there is no owner, the doc doesn't exist, the line is the
 * owner's own (it has a `userRef`), or the id repeats an earlier line. One
 * `getAll` for all ids.
 */
export async function verifySavedPersonIds(
  db: FirebaseFirestore.Firestore,
  persons: CheckoutPersonEntity[],
  ownerId: string | null,
  context: string,
): Promise<CheckoutPersonEntity[]> {
  if (!persons.some((p) => p.savedPersonId)) return persons;

  const drop = (p: CheckoutPersonEntity, why: string): CheckoutPersonEntity => {
    logger.warn(`${context}: dropped savedPersonId (${why})`, {
      savedPersonId: p.savedPersonId,
    });
    const { savedPersonId: _dropped, ...rest } = p;
    return rest;
  };

  if (!ownerId) return persons.map((p) => (p.savedPersonId ? drop(p, "no owner") : p));

  const ids = [...new Set(persons.map((p) => p.savedPersonId).filter((id): id is string => !!id))];
  const collection = db.collection("users").doc(ownerId).collection("savedPersons");
  const snaps = await db.getAll(...ids.map((id) => collection.doc(id)));
  const existing = new Set(snaps.filter((s) => s.exists).map((s) => s.id));

  const seen = new Set<string>();
  return persons.map((p) => {
    const id = p.savedPersonId;
    if (!id) return p;
    if (p.userRef) return drop(p, "owner line");
    if (!existing.has(id)) return drop(p, "not found");
    if (seen.has(id)) return drop(p, "repeated");
    seen.add(id);
    return p;
  });
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
 * Same-day usage-fee waiver (issue #268, ADR-0050).
 *
 * A person pays the usage fee at most once per Zurich business day
 * (boundary 03:00) of an account: the owner by account id, everyone else
 * by normalized name + person type. They are covered when they appear on
 * another closed, non-cancelled visit of the same owner *opened* on the
 * same business day as this one, on a usage type whose fee is at least
 * theirs now — they pay the difference (CHK-37).
 * Guests (no owner) are always charged. The rule itself lives in
 * `@oww/shared` (`sameDayCoveredPersons`) so the checkout wizard previews
 * the same answer; this is the authoritative Firestore read.
 *
 * `openedAt` is the business day of the visit being billed (its `created`).
 * `excludeCheckoutId` skips that visit itself; a correction also passes
 * `closedBefore` (see `sameDayCoveredPersons`).
 *
 * Returns a copy of `persons` with `entryFeeWaivedToday: true` set on each
 * covered person (an existing `true` is kept). Pure read; performs no writes.
 */
export async function markEntryFeeWaivedToday(
  db: FirebaseFirestore.Firestore,
  persons: CheckoutPersonEntity[],
  ownerRef: DocumentReference | null,
  openedAt: Date,
  opts: { excludeCheckoutId?: string | null; closedBefore?: Date | null } = {},
): Promise<CheckoutPersonEntity[]> {
  // Truly anonymous checkout (no owner) — nobody to dedup against.
  if (!ownerRef) return persons;
  if (!persons.some((p) => samedayPersonKey(p, ownerRef.id) !== null)) {
    return persons;
  }

  // All closed checkouts this account owns, filtered to the opening
  // business day in memory (Firestore can't express the 03:00 boundary
  // without a precomputed key, and the per-account volume is tiny).
  // `status == "closed"` excludes cancelled visits (ADR-0042).
  const priorSnap = await db
    .collection("checkouts")
    .where("userId", "==", ownerRef)
    .where("status", "==", "closed")
    .get();

  const earlierCheckouts: SameDayCheckout[] = priorSnap.docs.map((doc) => {
    const c = doc.data() as CheckoutEntity;
    return {
      id: doc.id,
      status: c.status,
      cancelledAt: c.cancelledAt ?? null,
      usageType: c.usageType,
      created: c.created?.toDate?.() ?? null,
      closedAt: c.closedAt?.toDate?.() ?? null,
      persons: c.persons ?? [],
    };
  });

  const covered = sameDayCoveredPersons({
    persons,
    ownerId: ownerRef.id,
    openedAt,
    earlierCheckouts,
    currentCheckoutId: opts.excludeCheckoutId ?? null,
    closedBefore: opts.closedBefore ?? null,
  });
  if (!covered.some(Boolean)) return persons;
  return persons.map((p, i) =>
    covered[i] ? { ...p, entryFeeWaivedToday: true } : p,
  );
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

/**
 * Wire shape of one roster entry. Identity travels as a plain `userId`
 * string — a DocumentReference does not survive callable serialization.
 */
export interface ClosePersonInput {
  name: string;
  email?: string;
  userType: string;
  billingAddress?: {
    company?: string;
    street?: string;
    zip?: string;
    city?: string;
  } | null;
  /** users/{id} the person was pre-filled from (owner, family roster). */
  userId?: string | null;
  /** The person's own usage type (issue #605); required on every line. */
  usageType?: string | null;
  /** users/{owner}/savedPersons/{id} the line was added from (issue #605). */
  savedPersonId?: string | null;
}

function isClosePersonInput(p: unknown): p is ClosePersonInput {
  if (!p || typeof p !== "object") return false;
  const x = p as Record<string, unknown>;
  return (
    typeof x.name === "string" &&
    (x.email == null || typeof x.email === "string") &&
    typeof x.userType === "string" &&
    (x.billingAddress == null ||
      (typeof x.billingAddress === "object" && !Array.isArray(x.billingAddress))) &&
    (x.userId == null || (typeof x.userId === "string" && x.userId.length > 0)) &&
    (x.usageType == null || isUsageType(x.usageType)) &&
    (x.savedPersonId == null ||
      (typeof x.savedPersonId === "string" && x.savedPersonId.length > 0))
  );
}

/**
 * Turn the wire roster into the persons that get persisted on the closed
 * checkout (issue #741).
 *
 * The close overwrites the stored `persons[]`, so whatever this returns is
 * the permanent record — and the input for the userType enforcement and
 * the same-day dedup, both of which key on `userRef`.
 *
 * - Only allowlisted fields are kept: server-derived fields such as
 *   `entryFeeWaivedToday` are never taken from the client. `usageType` and
 *   `savedPersonId` are copied as sent; `resolvePersonUsageTypes` and
 *   `verifySavedPersonIds` check them.
 * - A `userId` becomes a `userRef` only for the checkout owner: a roster
 *   holds the owner plus guests by name (ADR-0048) — anyone with an account
 *   of their own checks in on it. Anything else is dropped with a warning
 *   rather than failing the payment — the person is then billed as a guest.
 * - The owner's identity is kept on its first line only. A repeated id would
 *   let extra guest lines ride on the owner's same-day waiver, and the
 *   userType enforcement only corrects the first match.
 *
 * Exported for unit tests.
 */
export function resolveClosePersons(
  db: FirebaseFirestore.Firestore,
  wire: ClosePersonInput[],
  ownerId: string | null,
  context: string,
): CheckoutPersonEntity[] {
  let ownerClaimed = false;
  return wire.map((p) => {
    const person: CheckoutPersonEntity = {
      name: p.name,
      email: p.email ?? "",
      userType: p.userType as CheckoutPersonEntity["userType"],
    };
    if (p.billingAddress) {
      const a = p.billingAddress;
      person.billingAddress = {
        company: String(a.company ?? ""),
        street: String(a.street ?? ""),
        zip: String(a.zip ?? ""),
        city: String(a.city ?? ""),
      };
    }
    if (p.usageType) person.usageType = p.usageType as UsageType;
    if (p.savedPersonId) person.savedPersonId = p.savedPersonId;
    if (p.userId) {
      if (p.userId !== ownerId) {
        logger.warn(`${context}: dropped non-owner person userId`, {
          userId: p.userId,
        });
      } else if (ownerClaimed) {
        logger.warn(`${context}: dropped repeated owner userId`, {
          userId: p.userId,
        });
      } else {
        ownerClaimed = true;
        person.userRef = db.collection("users").doc(p.userId);
      }
    }
    return person;
  });
}

interface CloseCheckoutRequest {
  /** Existing open checkout to close. Mutually exclusive with `newCheckout`. */
  checkoutId?: string;
  /** Data for the anonymous flow that creates a closed checkout in one shot. */
  newCheckout?: NewCheckoutInput;
  persons: ClosePersonInput[];
  summary: CheckoutSummaryEntity;
  /**
   * Commit this method together with the close (issue #750): the person
   * confirmed it on the same screen, so the bill is minted committed. The
   * commit is the person's promise to pay, never proof of payment — for
   * the TWINT paylink too: the client closes when the person clicks to pay
   * by TWINT (not when the tab is selected), the response carries the
   * `paylinkUrl`, and nothing can confirm that payment afterwards. A payment terminal is different:
   * its checkout must close only on an approved transaction, so it must
   * not come through here.
   * Omitted: the bill stays unconfirmed, as before.
   */
  paymentMethod?: PaymentMethod;
}

/**
 * How a close mints its bill when it commits `method` at once. A CHF 0
 * bill ignores the method: it is closed as `paidVia: "free"` either way
 * and needs no payment (BIL-8).
 */
interface MintCommit {
  /** The method to write on the checkout; null leaves the bill unconfirmed. */
  method: PaymentMethod | null;
  kind?: "beleg";
  preAck?: { source: "user" };
}

function mintCommitted(method: PaymentMethod | null, amount: number): MintCommit {
  if (!method || amount === 0) return { method: null };
  return PAYMENT_METHOD_INFO[method].isAggregated
    ? { method, kind: "beleg" }
    : { method, preAck: { source: "user" } };
}

export const closeCheckoutAndGetPaymentHandler = async (
  request: CallableRequest<CloseCheckoutRequest>
) => {
  const data = request.data ?? ({} as CloseCheckoutRequest);
  const { checkoutId, newCheckout, persons, summary } = data;
  const paymentMethod = data.paymentMethod ?? null;

  if (!Array.isArray(persons) || persons.length === 0) {
    throw new HttpsError("invalid-argument", "persons is required");
  }
  if (!persons.every(isClosePersonInput)) {
    throw new HttpsError("invalid-argument", "persons[] must be valid");
  }
  if (paymentMethod !== null) {
    if (!isPaymentMethod(paymentMethod)) {
      throw new HttpsError("invalid-argument", "invalid paymentMethod");
    }
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
      persons,
      clientSummary: summary,
      paymentMethod,
    });
  }
  if (newCheckout) {
    return createAnonymousCheckout(callerUid, firebaseAuthUid, {
      newCheckout,
      persons,
      clientSummary: summary,
      paymentMethod,
    });
  }
  throw new HttpsError(
    "invalid-argument",
    "Either checkoutId or newCheckout is required",
  );
};

/**
 * Everything a close of an existing open checkout settles before its
 * transaction: who owns it, the roster as it will be stored (identities
 * checked, account-holder user type enforced, same-day waiver applied),
 * the visit's usage type and the pricing config. Shared by the close and
 * by `prepareTerminalPayment` (ADR-0051), which prices a terminal attempt
 * exactly like the close it later becomes.
 */
export interface ResolvedExistingClose {
  checkoutRef: DocumentReference;
  context: string;
  ownerId: string | null;
  visitUsageType: UsageType;
  persons: CheckoutPersonEntity[];
  configFees: Record<string, Record<string, number>> | null;
  membershipCatalogId: string | null;
  memberBillingAddress: { street?: string; zip?: string; city?: string } | null;
}

export async function resolveExistingClose(
  callerUid: string,
  isAnonymous: boolean,
  args: { checkoutId: string; persons: ClosePersonInput[]; context: string },
): Promise<ResolvedExistingClose> {
  const db = getFirestore();
  const checkoutRef = db.collection("checkouts").doc(args.checkoutId);

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

  // The stored doc names the owner — the one identity a roster line may
  // carry. Read outside the transaction like the other guards.
  const preSnap = await checkoutRef.get();
  const stored = preSnap.exists ? (preSnap.data() as CheckoutEntity) : null;
  // For the eager-anon shape (`userId: null`, issue #151) there is no owner
  // doc, so `ownerId` must be null — NOT the anon Firebase UID. Falling back
  // to `callerUid` there would wrongly exempt a roster entry crafted to match
  // the anon UID onto a roster line. The authenticated fallback (`callerUid` when the doc isn't
  // stored yet) only matters for a not-yet-existing checkout, which the
  // transaction below rejects as not-found anyway.
  const ownerId = stored
    ? (stored.userId?.id ?? null)
    : (isAnonymous ? null : callerUid);
  const context = args.context;
  const typed = resolvePersonUsageTypes(
    resolveClosePersons(db, args.persons, ownerId, context),
    ownerId,
  );
  const persons = await verifySavedPersonIds(db, typed.persons, ownerId, context);

  const enforcedPersons = await enforceAccountHolderUserType(
    db,
    persons,
    userRef,
    context,
  );

  // The buyer's billing address (used to backstop membership invoices below).
  // Read outside the transaction — it's the same field the invoice resolver
  // reads, written by the client before submit.
  const memberBillingAddress = userRef
    ? ((await userRef.get()).data()?.billingAddress as
        | { street?: string; zip?: string; city?: string }
        | undefined) ?? null
    : null;

  // Same-day usage-fee waiver (issue #268, ADR-0050): waive the fee for
  // anyone already on another visit of this account opened the same day.
  // The owner is the checkout's userId; for the truly-anon path userRef is
  // null and the dedup is a no-op. Read outside the transaction — it's a
  // historical scan that doesn't participate in the close's atomicity.
  const dedupedPersons = await markEntryFeeWaivedToday(
    db,
    enforcedPersons,
    userRef,
    // The visit's opening business day decides (ADR-0050), not the close.
    stored?.created?.toDate?.() ?? new Date(),
    { excludeCheckoutId: args.checkoutId },
  );

  return {
    checkoutRef,
    context,
    ownerId,
    visitUsageType: typed.usageType,
    persons: dedupedPersons,
    configFees,
    membershipCatalogId,
    memberBillingAddress,
  };
}

/**
 * The caller must be the checkout's principal. Two valid paths:
 *
 * 1. Registered user / kiosk tag-tap: `checkout.userId` is set and
 *    must match `callerUid` (real login uid, or actsAs target for a
 *    tag-tap session).
 * 2. Eager-anon flow (issue #151): `checkout.userId` is null. The
 *    Firestore rules permit any anon-auth session to read/update a
 *    null-userId open checkout, so we add a server-side scoping that
 *    mirrors the wizard's `modifiedBy == anonUid` query: only the
 *    anon session that opened the cart may close it. The
 *    sign-in-provider gate keeps real-user spoofing out — a real
 *    user cannot accidentally (or deliberately) submit a stranger's
 *    null-userId cart even if they know its id.
 */
export function assertCheckoutPrincipal(
  checkout: CheckoutEntity,
  callerUid: string,
  isAnonymous: boolean,
): void {
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
}

/**
 * Prices an open checkout inside the close's transaction: reads its items,
 * runs the shared pricing tail and the identity-bound guards that need the
 * items. Throws `failed-precondition` on a guard violation.
 */
export async function priceOpenCheckout(
  tx: FirebaseFirestore.Transaction,
  resolved: ResolvedExistingClose,
  checkout: CheckoutEntity,
  clientSummary: CheckoutSummaryEntity | undefined,
): Promise<{
  summary: CheckoutSummaryEntity;
  /** The item docs it priced, for a terminal attempt's snapshot. */
  itemDocs: FirebaseFirestore.QueryDocumentSnapshot[];
}> {
  // Load the items subcollection inside the transaction for the
  // server-side recompute.
  const itemsSnap = await tx.get(resolved.checkoutRef.collection("items"));
  const rawItems = itemsSnap.docs.map((d) => d.data() as CheckoutItemEntity);

  const { items, summary, membershipPresent } = priceCheckoutItems({
    persons: resolved.persons,
    usageType: resolved.visitUsageType,
    items: rawItems,
    configFees: resolved.configFees,
    membershipCatalogId: resolved.membershipCatalogId,
    tip: clientSummary?.tip ?? 0,
  });
  // Badge association needs an identified owner (see the guard's doc).
  assertBadgeItemsBelongToOwner(items, checkout.userId);
  // A membership invoice needs a postal address (combined-signin refactor).
  // The buyer's user doc carries it (written from the inline checkout field).
  if (membershipPresent) {
    assertMembershipBillingAddress(resolved.memberBillingAddress);
  }
  logSummaryDivergence(resolved.context, clientSummary, summary);
  return { summary, itemDocs: itemsSnap.docs };
}

async function closeExistingCheckout(
  callerUid: string | null,
  isAnonymous: boolean,
  args: {
    checkoutId: string;
    persons: ClosePersonInput[];
    clientSummary?: CheckoutSummaryEntity;
    paymentMethod: PaymentMethod | null;
  },
): Promise<PaymentData> {
  if (!callerUid) {
    throw new HttpsError(
      "unauthenticated",
      "Sign-in required to close an existing checkout",
    );
  }
  // A terminal payment closes only on Wallee's confirmation
  // (settleTerminalPayment), never on the client's word.
  if (args.paymentMethod && PAYMENT_METHOD_INFO[args.paymentMethod].confirmsPayment) {
    throw new HttpsError(
      "invalid-argument",
      `paymentMethod ${args.paymentMethod} is confirmed by its provider, not by the close`,
    );
  }

  const db = getFirestore();
  const billRef = db.collection("bills").doc();
  const resolved = await resolveExistingClose(callerUid, isAnonymous, {
    checkoutId: args.checkoutId,
    persons: args.persons,
    context: `closeExistingCheckout ${args.checkoutId}`,
  });
  const { checkoutRef } = resolved;

  if (args.paymentMethod) {
    await assertPaymentMethodAllowed(
      args.paymentMethod,
      resolved.ownerId ? db.collection("users").doc(resolved.ownerId) : null,
    );
  }

  const result = await db.runTransaction(async (tx) => {
    const checkoutDoc = await tx.get(checkoutRef);
    if (!checkoutDoc.exists) {
      throw new HttpsError("not-found", `Checkout ${args.checkoutId} not found`);
    }
    const checkout = checkoutDoc.data() as CheckoutEntity;
    assertCheckoutPrincipal(checkout, callerUid, isAnonymous);

    // Idempotency: if the safety-net trigger already produced a bill for
    // this checkout, return that bill's payment data instead of duplicating.
    if (checkout.billRef) {
      const existingBillDoc = await tx.get(checkout.billRef);
      if (existingBillDoc.exists) {
        const existingBill = existingBillDoc.data() as BillEntity;
        // A repeated close (double tap, retry after a lost response) that
        // carries a method still commits it, unless something already did.
        // Either way the answer names the method the bill is committed
        // with, which may differ from the one asked for: the first wins.
        let committedMethod = isBillCommitted(existingBill)
          ? (checkout.paymentMethod ?? null)
          : null;
        if (
          args.paymentMethod &&
          !isBillCommitted(existingBill) &&
          !existingBill.cancelledAt
        ) {
          committedMethod = args.paymentMethod;
          tx.update(
            checkout.billRef,
            billCommitFields(args.paymentMethod, Timestamp.now()),
          );
          tx.update(checkoutRef, {
            paymentMethod: args.paymentMethod,
            modifiedBy: callerUid,
            modifiedAt: FieldValue.serverTimestamp(),
          });
        }
        return {
          bill: existingBill,
          billId: checkout.billRef.id,
          payer: payerFromPersons(checkout.persons ?? resolved.persons),
          committedMethod,
        };
      }
    }

    if (checkout.status !== "open") {
      throw new HttpsError(
        "failed-precondition",
        `Checkout ${args.checkoutId} is not open`,
      );
    }

    const { summary } = await priceOpenCheckout(tx, resolved, checkout, args.clientSummary);

    const commit = mintCommitted(args.paymentMethod, summary.totalPrice);
    const bill = await allocateBill(tx, db, {
      userId: checkout.userId,
      checkoutRefs: [checkoutRef],
      amount: summary.totalPrice,
      billRef,
      kind: commit.kind,
      preAck: commit.preAck,
    });

    tx.update(checkoutRef, {
      ...(commit.method ? { paymentMethod: commit.method } : {}),
      status: "closed",
      usageType: resolved.visitUsageType,
      persons: resolved.persons,
      closedAt: FieldValue.serverTimestamp(),
      notes: null,
      summary,
      modifiedBy: callerUid,
      modifiedAt: FieldValue.serverTimestamp(),
      billRef,
      // Terminal attempts die with the close: money that still arrives for
      // one is a double charge (settleTerminalPayment alerts on it).
      terminalAttempts: FieldValue.delete(),
    });

    return {
      bill,
      billId: billRef.id,
      payer: payerFromPersons(resolved.persons),
      committedMethod: commit.method,
    };
  });

  return {
    ...buildPaymentData(result.bill, result.payer, result.billId, args.checkoutId),
    paymentMethod: result.committedMethod,
  };
}

async function createAnonymousCheckout(
  callerUid: string | null,
  firebaseAuthUid: string | null,
  args: {
    newCheckout: NewCheckoutInput;
    persons: ClosePersonInput[];
    clientSummary?: CheckoutSummaryEntity;
    paymentMethod: PaymentMethod | null;
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
  if (args.paymentMethod && PAYMENT_METHOD_INFO[args.paymentMethod].confirmsPayment) {
    throw new HttpsError(
      "invalid-argument",
      `paymentMethod ${args.paymentMethod} is confirmed by its provider, not by the close`,
    );
  }

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

  const db = getFirestore();

  // Only the owner's own line keeps its identity (issue #741, ADR-0048).
  const typed = resolvePersonUsageTypes(
    resolveClosePersons(db, args.persons, effectiveUserId ?? null, "createAnonymousCheckout"),
    effectiveUserId ?? null,
  );
  const visitUsageType = typed.usageType;

  // Loophole guard (issue #284): machine usage needs someone who isn't only
  // accompanying. The membership guard is a no-op on this path — the
  // anonymous create input carries no variantId, and memberships are bought
  // through purchaseMembership (which closes via closeExistingCheckout).
  assertUsageTypeAllowed(visitUsageType, {
    persons: typed.persons,
    hasMachineUsage: hasMachineUsage(validItems),
    hasMembershipItem: false,
  });

  const pricingDoc = await db.doc("config/pricing").get();
  const configFees =
    (pricingDoc.data() as { entryFees?: Record<string, Record<string, number>> } | undefined)
      ?.entryFees ?? null;

  const checkoutRef = db.collection("checkouts").doc();
  const billRef = db.collection("bills").doc();
  const userIdRef = effectiveUserId
    ? db.collection("users").doc(effectiveUserId)
    : null;

  if (args.paymentMethod) {
    await assertPaymentMethodAllowed(args.paymentMethod, userIdRef);
  }

  const persons = await verifySavedPersonIds(
    db,
    typed.persons,
    effectiveUserId ?? null,
    "createAnonymousCheckout",
  );

  // For registered users (tag-tap path falls through here when no open
  // checkout exists), cross-check the primary person's userType against
  // the stored profile so they can't claim child pricing they aren't
  // entitled to. The truly-anonymous path (userIdRef === null) has no
  // record to compare against.
  const enforcedPersons = await enforceAccountHolderUserType(
    db,
    persons,
    userIdRef,
    "createAnonymousCheckout",
  );

  // Daily usage-fee dedup (issue #268): a registered user / tag-tap session
  // landing here (no open checkout existed) may already have closed a
  // checkout earlier the same Zurich business day. Waive the fee for anyone
  // already on such a visit (ADR-0050). Truly-anon (userIdRef === null) is
  // a no-op.
  const dedupedPersons = await markEntryFeeWaivedToday(
    db,
    enforcedPersons,
    userIdRef,
    // Created and closed at once: opened now.
    new Date(),
  );

  const summary = recomputeSummary(
    dedupedPersons,
    visitUsageType,
    validItems,
    configFees,
    args.clientSummary?.tip ?? 0,
  );
  logSummaryDivergence("createAnonymousCheckout", args.clientSummary, summary);

  // Pre-allocate item refs so they can be written inside the transaction.
  const itemRefs = validItems.map(() => checkoutRef.collection("items").doc());

  const commit = mintCommitted(args.paymentMethod, summary.totalPrice);
  const result = await db.runTransaction(async (tx) => {
    const bill = await allocateBill(tx, db, {
      userId: userIdRef,
      checkoutRefs: [checkoutRef],
      amount: summary.totalPrice,
      billRef,
      kind: commit.kind,
      preAck: commit.preAck,
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
      usageType: visitUsageType,
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
      ...(commit.method ? { paymentMethod: commit.method } : {}),
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

  return {
    ...buildPaymentData(result.bill, result.payer, result.billId, checkoutRef.id),
    paymentMethod: commit.method,
  };
}

export function payerFromPersons(
  persons: CheckoutPersonEntity[],
): { name: string; email?: string } | null {
  const primary = persons[0];
  if (!primary) return null;
  return { name: primary.name, email: primary.email };
}
