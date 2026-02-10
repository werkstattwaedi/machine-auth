// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Firestore trigger: sync user roles to Firebase Auth custom claims.
 *
 * When a user document is written, this sets custom claims on the
 * corresponding Auth user (doc ID = Auth UID) so that Firestore
 * security rules can check `request.auth.token.admin`.
 */

import * as logger from "firebase-functions/logger";
import { getAuth } from "firebase-admin/auth";
import {
  onDocumentWritten,
  type FirestoreEvent,
  type Change,
  type DocumentSnapshot,
} from "firebase-functions/v2/firestore";

export const syncCustomClaims = onDocumentWritten(
  "users/{userId}",
  async (
    event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { userId: string }>
  ) => {
    const after = event.data?.after?.data();
    if (!after) return; // Document deleted

    const authUid = event.params.userId; // Doc ID = Firebase Auth UID
    const roles = after.roles as string[] | undefined;

    const isAdmin = roles?.includes("admin") ?? false;

    try {
      const auth = getAuth();
      const currentUser = await auth.getUser(authUid);
      const currentClaims = currentUser.customClaims ?? {};

      // Only update if claims actually changed
      if (currentClaims.admin === isAdmin) return;

      await auth.setCustomUserClaims(authUid, {
        ...currentClaims,
        admin: isAdmin,
      });

      logger.info(
        `Custom claims updated for ${authUid}: admin=${isAdmin}`
      );
    } catch (error) {
      logger.error(`Failed to set custom claims for ${authUid}`, error);
    }
  }
);
