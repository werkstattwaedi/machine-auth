// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `correctCheckouts` — admin cancellation / corrected re-issue of closed
 * visits (ADR-0041). One reason, a list of visits; each entry is a pure
 * cancellation or a cancellation plus an edited replacement.
 *
 * Everything happens in ONE transaction — including, when a Beleg inside a
 * sent Sammelrechnung is touched, cancelling that Sammelrechnung and
 * minting its revision from the surviving Belege plus the replacements
 * (`aggregateBelegeIntoInvoice`, shared with the monthly cron). Batching
 * several Beleg fixes into one revision is the admin's choice in the UI:
 * the Sammelrechnung page commits N entries at once.
 *
 * Cancelled docs stay in place as the as-sent record; replacements are new
 * docs linked both ways (`supersedes…` / `supersededBy…`). Mail goes out
 * inline afterwards like monthlyBillRun does — one mail per top-level bill
 * (see `bill_triggers.ts`): the corrected Rechnung / Quittung /
 * un-aggregated Beleg mails itself, a Sammelrechnung revision mails once
 * with its replacement Belege attached, a pure cancellation sends a notice.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import {
  getFirestore,
  Timestamp,
  type DocumentReference,
  type Firestore,
} from "firebase-admin/firestore";
import {
  CANCEL_REASON_MIN_LENGTH,
  MAX_CANCELLATION_REASON_LENGTH,
  MAX_CORRECTIONS_PER_CALL,
  USAGE_TYPE_DISCOUNTS,
  roundTo5,
  type CorrectCheckoutEntry,
  type CorrectCheckoutItemInput,
  type CorrectCheckoutPersonInput,
  type CorrectCheckoutReplacement,
  type CorrectCheckoutsRequest,
  type CorrectCheckoutsResult,
} from "@oww/shared";
import type {
  CheckoutEntity,
  CheckoutItemEntity,
  CheckoutPersonEntity,
  CheckoutSummaryEntity,
  UsageType,
} from "../types/firestore_entities";
import { formatBillReference, type BillEntity } from "./types";
import { allocateBillRevision, type BillAck } from "./create_bill";
import { aggregateBelegeIntoInvoice } from "./monthly_bill_run";
import {
  isValidItem,
  markEntryFeeWaivedToday,
  priceCheckoutItems,
} from "./close_checkout_and_get_payment";
import {
  tryGeneratePdf,
  trySendCancellationNotice,
  trySendEmail,
} from "./bill_triggers";
import {
  detectMembershipKindForItems,
  loadMembershipCatalogId,
} from "../membership/shared";
import { isBadgeItem } from "../badge/shared";

export type {
  CorrectCheckoutEntry,
  CorrectCheckoutsRequest,
  CorrectCheckoutsResult,
};

const USER_TYPES = new Set(["erwachsen", "kind", "firma"]);
const ITEM_TYPES = new Set(["machine", "material"]);
const ITEM_ORIGINS = new Set(["nfc", "manual", "qr"]);
const MAX_MONEY = 1_000_000;
const MAX_TEXT = 200;

// --- Payload validation ---------------------------------------------------

/**
 * Admin-supplied line item. The Admin SDK bypasses the rules' item checks
 * (`hasValidItemPricing`), so the same bounds are enforced here, plus the
 * shape the correction editor is allowed to produce. Exported for tests.
 */
export function isValidAdminItem(item: unknown): item is CorrectCheckoutItemInput {
  if (!item || typeof item !== "object") return false;
  const i = item as Record<string, unknown>;
  const money = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v < MAX_MONEY;
  return (
    typeof i.workshop === "string" && i.workshop.length > 0 && i.workshop.length <= 40 &&
    typeof i.description === "string" && i.description.trim().length > 0 &&
    i.description.length <= MAX_TEXT &&
    typeof i.type === "string" && ITEM_TYPES.has(i.type) &&
    (i.catalogId === null || (typeof i.catalogId === "string" && i.catalogId.length > 0)) &&
    (i.variantId == null || typeof i.variantId === "string") &&
    (i.origin === undefined || (typeof i.origin === "string" && ITEM_ORIGINS.has(i.origin))) &&
    money(i.quantity) && money(i.unitPrice) && money(i.totalPrice) &&
    isValidItem({ quantity: i.quantity as number, unitPrice: i.unitPrice as number, totalPrice: i.totalPrice as number })
  );
}

function isValidPerson(p: unknown): p is CorrectCheckoutPersonInput {
  if (!p || typeof p !== "object") return false;
  const x = p as Record<string, unknown>;
  const addr = x.billingAddress as Record<string, unknown> | null | undefined;
  return (
    typeof x.name === "string" && x.name.trim().length > 0 && x.name.length <= MAX_TEXT &&
    typeof x.email === "string" && x.email.length <= MAX_TEXT &&
    typeof x.userType === "string" && USER_TYPES.has(x.userType) &&
    (x.userId === null || (typeof x.userId === "string" && x.userId.length > 0)) &&
    typeof x.entryFeeWaivedToday === "boolean" &&
    (addr == null ||
      (typeof addr === "object" &&
        ["company", "street", "zip", "city"].every((k) => typeof addr[k] === "string")))
  );
}

function parseReplacement(r: unknown, checkoutId: string): CorrectCheckoutReplacement {
  if (!r || typeof r !== "object") {
    throw new HttpsError("invalid-argument", `${checkoutId}: replacement must be an object`);
  }
  const x = r as Record<string, unknown>;
  if (typeof x.usageType !== "string" || !(x.usageType in USAGE_TYPE_DISCOUNTS)) {
    throw new HttpsError("invalid-argument", `${checkoutId}: invalid usageType`);
  }
  if (!Array.isArray(x.persons) || x.persons.length === 0 || !x.persons.every(isValidPerson)) {
    throw new HttpsError("invalid-argument", `${checkoutId}: persons[] is required and must be valid`);
  }
  if (!Array.isArray(x.items) || !x.items.every(isValidAdminItem)) {
    throw new HttpsError("invalid-argument", `${checkoutId}: items[] must be valid`);
  }
  const tip = x.tip ?? 0;
  if (typeof tip !== "number" || !Number.isFinite(tip) || tip < 0 || tip >= MAX_MONEY) {
    throw new HttpsError("invalid-argument", `${checkoutId}: invalid tip`);
  }
  return {
    usageType: x.usageType as UsageType,
    persons: x.persons as CorrectCheckoutPersonInput[],
    items: x.items as CorrectCheckoutItemInput[],
    tip,
  };
}

/** Validate the wire payload; throws HttpsError on malformed input. Exported for tests. */
export function parseCorrectCheckoutsRequest(
  data: unknown,
): { reason: string; corrections: CorrectCheckoutEntry[] } {
  const req = (data ?? {}) as Partial<CorrectCheckoutsRequest>;
  const reason = typeof req.reason === "string" ? req.reason.trim() : "";
  if (reason.length < CANCEL_REASON_MIN_LENGTH || reason.length > MAX_CANCELLATION_REASON_LENGTH) {
    throw new HttpsError(
      "invalid-argument",
      `reason must be ${CANCEL_REASON_MIN_LENGTH}–${MAX_CANCELLATION_REASON_LENGTH} characters`,
    );
  }
  if (!Array.isArray(req.corrections) || req.corrections.length === 0) {
    throw new HttpsError("invalid-argument", "corrections[] is required");
  }
  if (req.corrections.length > MAX_CORRECTIONS_PER_CALL) {
    throw new HttpsError(
      "invalid-argument",
      `Too many corrections (max ${MAX_CORRECTIONS_PER_CALL} per call)`,
    );
  }
  const seen = new Set<string>();
  const corrections = req.corrections.map((c) => {
    const checkoutId = (c as CorrectCheckoutEntry | undefined)?.checkoutId;
    if (typeof checkoutId !== "string" || !checkoutId) {
      throw new HttpsError("invalid-argument", "checkoutId is required");
    }
    if (seen.has(checkoutId)) {
      throw new HttpsError("invalid-argument", `checkoutId ${checkoutId} listed twice`);
    }
    seen.add(checkoutId);
    const raw = (c as CorrectCheckoutEntry).replacement;
    return {
      checkoutId,
      replacement: raw == null ? null : parseReplacement(raw, checkoutId),
    };
  });
  return { reason, corrections };
}

// --- Entity assembly ------------------------------------------------------

function toPersonEntity(db: Firestore, p: CorrectCheckoutPersonInput): CheckoutPersonEntity {
  const person: CheckoutPersonEntity = {
    name: p.name.trim(),
    email: p.email.trim(),
    userType: p.userType,
  };
  if (p.userId) person.userRef = db.collection("users").doc(p.userId);
  if (p.billingAddress) person.billingAddress = { ...p.billingAddress };
  if (p.entryFeeWaivedToday) person.entryFeeWaivedToday = true;
  return person;
}

function toItemEntity(
  db: Firestore,
  item: CorrectCheckoutItemInput,
  now: Timestamp,
): CheckoutItemEntity {
  return {
    workshop: item.workshop,
    description: item.description.trim(),
    origin: item.origin ?? "manual",
    type: item.type,
    catalogId: item.catalogId ? db.collection("catalog").doc(item.catalogId) : null,
    variantId: item.variantId ?? null,
    created: now,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    // Never trust a client-side product: the editor shows the same
    // 5-Rappen rounding, and a typo'd total must not become the bill.
    totalPrice: roundTo5(item.quantity * item.unitPrice),
  };
}

function hasMembershipOrBadge(
  items: CheckoutItemEntity[],
  membershipCatalogId: string | null,
): boolean {
  if (items.some(isBadgeItem)) return true;
  return membershipCatalogId !== null &&
    detectMembershipKindForItems(items, membershipCatalogId) !== null;
}

interface PreparedReplacement {
  persons: CheckoutPersonEntity[];
  items: CheckoutItemEntity[];
  summary: CheckoutSummaryEntity;
  workshopsVisited: string[];
  usageType: UsageType;
}

interface LoadedEntry {
  checkoutId: string;
  checkoutRef: DocumentReference;
  checkout: CheckoutEntity;
  items: CheckoutItemEntity[];
  billRef: DocumentReference;
  bill: BillEntity;
  replacement: PreparedReplacement | null;
}

function refLabel(bill: BillEntity): string {
  return formatBillReference(bill.referenceNumber, bill.kind);
}

// --- Handler --------------------------------------------------------------

export const correctCheckoutsHandler = async (
  request: CallableRequest<unknown>,
): Promise<CorrectCheckoutsResult> => {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  const adminUid = request.auth.uid;
  const { reason, corrections } = parseCorrectCheckoutsRequest(request.data);

  const db = getFirestore();
  const now = Timestamp.now();

  // Config reads outside the transaction (infrequently changing, not part
  // of the commit's atomicity) — same as closeExistingCheckout.
  const pricingDoc = await db.doc("config/pricing").get();
  const configFees =
    (pricingDoc.data() as { entryFees?: Record<string, Record<string, number>> } | undefined)
      ?.entryFees ?? null;
  const membershipCatalogId = await loadMembershipCatalogId(db);

  // Price each replacement outside the transaction: the daily entry-fee
  // dedup is a historical scan on the ORIGINAL visit date (cancelled
  // checkouts drop out of its `status == "closed"` query automatically;
  // an admin-set waiver survives because the scan only adds). The
  // originals are re-read and re-guarded inside the transaction.
  const prepared = new Map<string, PreparedReplacement>();
  for (const entry of corrections) {
    if (!entry.replacement) continue;
    const snap = await db.collection("checkouts").doc(entry.checkoutId).get();
    const original = snap.data() as CheckoutEntity | undefined;
    if (!original) {
      throw new HttpsError("not-found", `Besuch ${entry.checkoutId} nicht gefunden.`);
    }
    const r = entry.replacement;
    const visitDate = (original.closedAt ?? original.created).toDate();
    const persons = await markEntryFeeWaivedToday(
      db,
      r.persons.map((p) => toPersonEntity(db, p)),
      original.userId ?? null,
      visitDate,
      entry.checkoutId,
      configFees,
    );
    const { items, summary, membershipPresent } = priceCheckoutItems({
      persons,
      usageType: r.usageType,
      items: r.items.map((i) => toItemEntity(db, i, now)),
      configFees,
      membershipCatalogId,
      tip: r.tip,
    });
    if (membershipPresent) {
      throw new HttpsError(
        "failed-precondition",
        "Besuche mit Mitgliedschaft oder Badge können nicht korrigiert werden.",
      );
    }
    const workshops = [...new Set(items.map((i) => i.workshop))];
    prepared.set(entry.checkoutId, {
      persons,
      items,
      summary,
      usageType: r.usageType,
      workshopsVisited: workshops.length > 0 ? workshops : original.workshopsVisited ?? [],
    });
  }

  const outcome = await db.runTransaction(async (tx) => {
    // ---- reads (all before any write) ----
    const loaded: LoadedEntry[] = [];
    for (const entry of corrections) {
      const checkoutRef = db.collection("checkouts").doc(entry.checkoutId);
      const checkoutSnap = await tx.get(checkoutRef);
      if (!checkoutSnap.exists) {
        throw new HttpsError("not-found", `Besuch ${entry.checkoutId} nicht gefunden.`);
      }
      const checkout = checkoutSnap.data() as CheckoutEntity;
      const itemsSnap = await tx.get(checkoutRef.collection("items"));
      const items = itemsSnap.docs.map((d) => d.data() as CheckoutItemEntity);
      if (!checkout.billRef) {
        throw new HttpsError(
          "failed-precondition",
          `Besuch ${entry.checkoutId} hat keine Rechnung und kann nicht korrigiert werden.`,
        );
      }
      const billSnap = await tx.get(checkout.billRef);
      if (!billSnap.exists) {
        throw new HttpsError("failed-precondition", `Rechnung zu Besuch ${entry.checkoutId} nicht gefunden.`);
      }
      loaded.push({
        checkoutId: entry.checkoutId,
        checkoutRef,
        checkout,
        items,
        billRef: checkout.billRef,
        bill: billSnap.data() as BillEntity,
        replacement: prepared.get(entry.checkoutId) ?? null,
      });
    }

    // The Sammelrechnung family, if any Beleg in the list is aggregated.
    const aggregateRefs = new Map<string, DocumentReference>();
    for (const l of loaded) {
      if ((l.bill.kind ?? "invoice") === "beleg" && l.bill.aggregatedIntoBillRef) {
        aggregateRefs.set(l.bill.aggregatedIntoBillRef.path, l.bill.aggregatedIntoBillRef);
      }
    }
    if (aggregateRefs.size > 1) {
      throw new HttpsError(
        "failed-precondition",
        "Belege verschiedener Sammelrechnungen können nicht in einem Schritt korrigiert werden.",
      );
    }
    const aggregateRef = [...aggregateRefs.values()][0] ?? null;
    let aggregate: BillEntity | null = null;
    let siblings: Array<{ ref: DocumentReference; bill: BillEntity }> = [];
    if (aggregateRef) {
      const aggSnap = await tx.get(aggregateRef);
      if (!aggSnap.exists) {
        throw new HttpsError("failed-precondition", "Die Sammelrechnung zu diesem Beleg wurde nicht gefunden.");
      }
      aggregate = aggSnap.data() as BillEntity;
      const siblingSnap = await tx.get(
        db.collection("bills").where("aggregatedIntoBillRef", "==", aggregateRef),
      );
      siblings = siblingSnap.docs.map((d) => ({ ref: d.ref, bill: d.data() as BillEntity }));
    }

    // ---- guards ----
    for (const l of loaded) {
      const label = refLabel(l.bill);
      if (l.checkout.status === "cancelled" || l.bill.cancelledAt) {
        throw new HttpsError("failed-precondition", `${label} wurde bereits storniert.`);
      }
      if (l.checkout.status !== "closed") {
        throw new HttpsError("failed-precondition", `Besuch ${l.checkoutId} ist nicht abgeschlossen.`);
      }
      if (l.bill.paidAt) {
        throw new HttpsError(
          "failed-precondition",
          `${label} ist bereits bezahlt — bezahlte Rechnungen können in dieser Version nicht korrigiert werden.`,
        );
      }
      if ((l.bill.source ?? "checkout") === "membership-renewal") {
        throw new HttpsError(
          "failed-precondition",
          `${label} ist eine Mitgliederbeitrags-Rechnung und kann nicht korrigiert werden.`,
        );
      }
      if (hasMembershipOrBadge(l.items, membershipCatalogId)) {
        throw new HttpsError(
          "failed-precondition",
          "Besuche mit Mitgliedschaft oder Badge können nicht korrigiert werden.",
        );
      }
    }
    if (aggregate && aggregateRef) {
      const label = refLabel(aggregate);
      if (aggregate.cancelledAt) {
        throw new HttpsError("failed-precondition", `Sammelrechnung ${label} wurde bereits storniert.`);
      }
      if (aggregate.paidAt) {
        throw new HttpsError(
          "failed-precondition",
          `Sammelrechnung ${label} ist bereits bezahlt — bezahlte Rechnungen können in dieser Version nicht korrigiert werden.`,
        );
      }
    }

    // ---- writes ----
    const revisionRef = aggregateRef ? db.collection("bills").doc() : null;
    const cancelledPaths = new Set(loaded.map((l) => l.billRef.path));
    const replacementBelege: Array<{ ref: DocumentReference; bill: BillEntity }> = [];
    const cancelledBillIds: string[] = [];
    const replacementCheckoutIds: string[] = [];
    const replacementBillIds: string[] = [];
    const references: string[] = [];
    /** New bills that mail themselves (everything but Belege inside a revision). */
    const topLevelBillIds: string[] = [];
    const replacementBelegIds: string[] = [];
    /** Cancelled top-level bills without a replacement → cancellation notice. */
    const noticeBillIds: string[] = [];

    for (const l of loaded) {
      const isBeleg = (l.bill.kind ?? "invoice") === "beleg";
      // Per bill, not per batch: a standalone Beleg listed next to an
      // aggregated one must stay standalone (own mail, no re-pointing).
      const insideRevision =
        isBeleg &&
        revisionRef !== null &&
        aggregateRef !== null &&
        !!l.bill.aggregatedIntoBillRef &&
        l.bill.aggregatedIntoBillRef.isEqual(aggregateRef);
      let newCheckoutRef: DocumentReference | null = null;
      let newBillRef: DocumentReference | null = null;

      if (l.replacement) {
        newCheckoutRef = db.collection("checkouts").doc();
        newBillRef = db.collection("bills").doc();
        const r = l.replacement;
        const replacementCheckout: CheckoutEntity = {
          userId: (l.checkout.userId ?? null) as DocumentReference,
          status: "closed",
          usageType: r.usageType,
          created: l.checkout.created,
          closedAt: l.checkout.closedAt ?? l.checkout.created,
          workshopsVisited: r.workshopsVisited,
          persons: r.persons,
          modifiedBy: adminUid,
          modifiedAt: now,
          firebaseUid: l.checkout.firebaseUid ?? null,
          billRef: newBillRef,
          notes: null,
          summary: r.summary,
          paymentMethod: l.checkout.paymentMethod ?? null,
          supersedesCheckoutRef: l.checkoutRef,
          supersededByCheckoutRef: null,
          cancelledAt: null,
          cancelledBy: null,
          cancellationReason: null,
          statsFlushedAt: null,
        };
        tx.set(newCheckoutRef, replacementCheckout);
        for (const item of r.items) {
          tx.set(newCheckoutRef.collection("items").doc(), item);
        }
        // Invoice-kind replacements are pre-acked (copy the original's ack,
        // else auto) so neither the ack cron nor onBillUpdate touches them;
        // Belege never carry an ack.
        const ack: BillAck | null = isBeleg
          ? null
          : l.bill.paymentMethodConfirmationTime
            ? {
                time: l.bill.paymentMethodConfirmationTime,
                source: l.bill.paymentMethodConfirmationSource ?? "auto",
              }
            : { time: now, source: "auto" };
        const newBill = await allocateBillRevision(tx, {
          previous: { ref: l.billRef, bill: l.bill },
          userId: l.checkout.userId ?? null,
          checkoutRefs: [newCheckoutRef],
          amount: r.summary.totalPrice,
          billRef: newBillRef,
          kind: l.bill.kind ?? "invoice",
          aggregatedIntoBillRef: insideRevision ? revisionRef : null,
          ack,
          correctionReason: reason,
          modifiedBy: adminUid,
        });
        replacementCheckoutIds.push(newCheckoutRef.id);
        replacementBillIds.push(newBillRef.id);
        references.push(refLabel(newBill));
        if (insideRevision) {
          replacementBelege.push({ ref: newBillRef, bill: newBill });
          replacementBelegIds.push(newBillRef.id);
        } else {
          topLevelBillIds.push(newBillRef.id);
        }
      } else if (!insideRevision) {
        noticeBillIds.push(l.billRef.id);
      }

      tx.update(l.checkoutRef, {
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: adminUid,
        cancellationReason: reason,
        supersededByCheckoutRef: newCheckoutRef,
        statsFlushedAt: null,
        modifiedBy: adminUid,
        modifiedAt: now,
      });
      tx.update(l.billRef, {
        cancelledAt: now,
        cancelledBy: adminUid,
        cancellationReason: reason,
        supersededByBillRef: newBillRef,
        modifiedBy: adminUid,
        modifiedAt: now,
      });
      cancelledBillIds.push(l.billRef.id);
    }

    let revisionBillId: string | null = null;
    let aggregateCancelledWithoutRevision = false;
    if (aggregateRef && aggregate && revisionRef) {
      const surviving = siblings.filter(
        (s) =>
          (s.bill.kind ?? "invoice") === "beleg" &&
          !s.bill.cancelledAt &&
          !cancelledPaths.has(s.ref.path),
      );
      const active = [...surviving, ...replacementBelege];
      if (active.length > 0) {
        const revision = await aggregateBelegeIntoInvoice(tx, db, {
          userId: aggregate.userId,
          belege: active,
          billRef: revisionRef,
          supersedes: {
            previous: { ref: aggregateRef, bill: aggregate },
            reason,
            correctedBillRefs: replacementBelege.map((b) => b.ref),
            modifiedBy: adminUid,
          },
        });
        revisionBillId = revisionRef.id;
        references.push(refLabel(revision));
      } else {
        aggregateCancelledWithoutRevision = true;
      }
      tx.update(aggregateRef, {
        cancelledAt: now,
        cancelledBy: adminUid,
        cancellationReason: reason,
        supersededByBillRef: revisionBillId ? revisionRef : null,
        modifiedBy: adminUid,
        modifiedAt: now,
      });
    }

    return {
      cancelledBillIds,
      replacementCheckoutIds,
      replacementBillIds,
      references,
      revisionBillId,
      topLevelBillIds,
      replacementBelegIds,
      noticeBillIds: aggregateCancelledWithoutRevision && aggregateRef
        ? [...noticeBillIds, aggregateRef.id]
        : noticeBillIds,
    };
  });

  logger.info("correctCheckouts: committed", {
    adminUid,
    corrections: corrections.length,
    cancelledBillIds: outcome.cancelledBillIds,
    replacementBillIds: outcome.replacementBillIds,
    revisionBillId: outcome.revisionBillId,
  });

  // Documents + mail, inline like monthlyBillRun: the replacement Belege
  // first (the revision mail attaches their PDFs), then every top-level
  // bill, then the cancellation notices. The pdfGeneratedAt / emailSentAt
  // locks make the race with onBillCreate idempotent; the hourly retry
  // covers anything that fails here.
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`correctCheckouts: ${label} threw`, { error: message });
    }
  };
  for (const id of outcome.replacementBelegIds) {
    await step(`PDF ${id}`, () => tryGeneratePdf(id));
  }
  for (const id of [
    ...outcome.topLevelBillIds,
    ...(outcome.revisionBillId ? [outcome.revisionBillId] : []),
  ]) {
    await step(`PDF ${id}`, () => tryGeneratePdf(id));
    await step(`mail ${id}`, () => trySendEmail(id));
  }
  for (const id of outcome.noticeBillIds) {
    await step(`notice ${id}`, () => trySendCancellationNotice(id));
  }

  return {
    cancelledBillIds: outcome.cancelledBillIds,
    replacementCheckoutIds: outcome.replacementCheckoutIds,
    replacementBillIds: outcome.replacementBillIds,
    revisionBillId: outcome.revisionBillId,
    references: outcome.references,
  };
};
