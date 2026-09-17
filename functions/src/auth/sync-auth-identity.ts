// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Firestore trigger: keep the Firebase Auth identity (e-mail, linked phone)
 * of `users/{userId}` in line with the doc (ADR-0043, issue #633).
 *
 * A sibling of `syncCustomClaims` rather than part of it, so neither
 * deployed trigger has to be renamed. All logic lives in
 * `reconcileAuthIdentity`, which the emulator tests call directly —
 * Firestore triggers do not run in the functions test suite.
 */

import {
  onDocumentWritten,
  type FirestoreEvent,
  type Change,
  type DocumentSnapshot,
} from "firebase-functions/v2/firestore";
import { defaultIdentityDeps, reconcileAuthIdentity } from "./identity";

export const syncAuthIdentity = onDocumentWritten(
  "users/{userId}",
  async (
    event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { userId: string }>
  ) => {
    // The event only says "this doc changed"; reconcile re-reads it.
    await reconcileAuthIdentity(defaultIdentityDeps(), event.params.userId);
  }
);
