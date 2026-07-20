// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Erasure blockers (ADR-0038): unfinished business that must be settled
 * through the existing admin UIs before a subject can be erased. The
 * erasure engine refuses with the full list (`failed-precondition`) and
 * performs zero writes.
 *
 * Queries are deliberately single-equality + in-code filters — per-subject
 * doc counts are small, and this avoids composite-index dependencies that
 * the emulator would not catch (CLAUDE.md gotcha).
 */

import type { Firestore } from "firebase-admin/firestore";
import type { Subject } from "./subject";
import type {
  CheckoutEntity,
  MembershipEntity,
} from "../types/firestore_entities";
import type { BillEntity } from "../invoice/types";

export interface Blocker {
  type:
    | "open-checkout"
    | "unpaid-bill"
    | "active-owned-membership"
    | "person-in-open-checkout";
  path: string;
  detail: string;
}

export async function findBlockers(
  db: Firestore,
  subject: Subject
): Promise<Blocker[]> {
  const blockers: Blocker[] = [];

  if (subject.userRef) {
    const [byUser, byPrincipal, bills, owned] = await Promise.all([
      db.collection("checkouts").where("userId", "==", subject.userRef).get(),
      subject.uid
        ? db.collection("checkouts").where("firebaseUid", "==", subject.uid).get()
        : Promise.resolve(null),
      db.collection("bills").where("userId", "==", subject.userRef).get(),
      db
        .collection("memberships")
        .where("ownerUserId", "==", subject.userRef)
        .get(),
    ]);

    const seen = new Set<string>();
    for (const doc of [...byUser.docs, ...(byPrincipal?.docs ?? [])]) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      if ((doc.data() as CheckoutEntity).status === "open") {
        blockers.push({
          type: "open-checkout",
          path: doc.ref.path,
          detail: "Offener Checkout — zuerst abschliessen oder löschen",
        });
      }
    }
    for (const doc of bills.docs) {
      if ((doc.data() as BillEntity).paidAt == null) {
        blockers.push({
          type: "unpaid-bill",
          path: doc.ref.path,
          detail: "Unbezahlte Rechnung — zuerst begleichen oder stornieren",
        });
      }
    }
    for (const doc of owned.docs) {
      if ((doc.data() as MembershipEntity).status === "active") {
        blockers.push({
          type: "active-owned-membership",
          path: doc.ref.path,
          detail: "Aktive Mitgliedschaft — zuerst kündigen",
        });
      }
    }
  }

  // Both kinds: a persons[] entry inside a currently-open checkout would
  // break the active visit if redacted mid-flight.
  if (subject.email || subject.uid) {
    const open = await db
      .collection("checkouts")
      .where("status", "==", "open")
      .get();
    for (const doc of open.docs) {
      const checkout = doc.data() as CheckoutEntity;
      if (checkout.userId?.id === subject.uid) continue; // already reported
      const match = (checkout.persons ?? []).some(
        (p) =>
          (subject.uid && p.userRef?.id === subject.uid) ||
          (subject.email && p.email?.toLowerCase() === subject.email)
      );
      if (match) {
        blockers.push({
          type: "person-in-open-checkout",
          path: doc.ref.path,
          detail: "Person in offenem Checkout — zuerst abschliessen",
        });
      }
    }
  }

  return blockers;
}
