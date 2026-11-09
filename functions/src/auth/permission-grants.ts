// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Callables: an admin grants or removes a person's permission (#843).
 *
 * `users.permissions` is a map of grants that records who granted each
 * permission, when and from where (`@oww/shared` permission-grants). The
 * rules pin the field for every client, admins included — they can't check
 * a map rewritten as a whole — so these callables are the only way an admin
 * changes it, and the stamps can be trusted. An admin may grant to anyone,
 * themselves included.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import {
  FieldValue,
  Timestamp,
  getFirestore,
  type DocumentReference,
  type Firestore,
} from "firebase-admin/firestore";
import {
  type PermissionGrant,
  type StoredPermissions,
} from "@oww/shared";

export type AdminPermissionGrant = PermissionGrant<DocumentReference, Timestamp>;
type GrantMap = Record<string, AdminPermissionGrant>;

interface PermissionChange {
  userId?: unknown;
  permissionId?: unknown;
}

/**
 * The stored value as a grant map: a doc from before the migration still
 * holds a list of refs, which becomes legacy grants on its first change, so
 * a doc never holds both shapes.
 */
export function toGrantMap(stored: StoredPermissions): GrantMap {
  if (!stored) return {};
  if (!Array.isArray(stored)) return { ...(stored as GrantMap) };
  const map: GrantMap = {};
  for (const ref of stored as DocumentReference[]) {
    map[ref.id] = { permission: ref, grantedAt: null, grantedBy: null, source: "legacy" };
  }
  return map;
}

function parse(request: CallableRequest<unknown>): {
  actorUid: string;
  userId: string;
  permissionId: string;
} {
  if (!request.auth?.token?.admin) {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  const { userId, permissionId } = (request.data ?? {}) as PermissionChange;
  if (typeof userId !== "string" || !userId) {
    throw new HttpsError("invalid-argument", "userId is required");
  }
  if (typeof permissionId !== "string" || !permissionId) {
    throw new HttpsError("invalid-argument", "permissionId is required");
  }
  return { actorUid: request.auth.uid, userId, permissionId };
}

export async function grantPermission(
  db: Firestore,
  input: { actorUid: string; userId: string; permissionId: string },
  now: Timestamp = Timestamp.now()
): Promise<{ changed: boolean }> {
  const { actorUid, userId, permissionId } = input;
  const userRef = db.collection("users").doc(userId);
  const permissionRef = db.collection("permission").doc(permissionId);
  return db.runTransaction(async (tx) => {
    const [user, permission] = await Promise.all([tx.get(userRef), tx.get(permissionRef)]);
    if (!user.exists) throw new HttpsError("not-found", "Person nicht gefunden.");
    if (!permission.exists) throw new HttpsError("not-found", "Berechtigung nicht gefunden.");
    const map = toGrantMap(user.get("permissions"));
    const existing = map[permissionId];
    // Held for good already: nothing to record. A temporary grant (course)
    // becomes the admin's permanent one.
    if (existing && !existing.windows) return { changed: false };
    map[permissionId] = {
      permission: permissionRef,
      grantedAt: now,
      grantedBy: db.collection("users").doc(actorUid),
      source: "admin",
    };
    tx.update(userRef, {
      permissions: map,
      modifiedBy: actorUid,
      modifiedAt: FieldValue.serverTimestamp(),
    });
    return { changed: true };
  });
}

export async function revokePermission(
  db: Firestore,
  input: { actorUid: string; userId: string; permissionId: string }
): Promise<{ changed: boolean }> {
  const { actorUid, userId, permissionId } = input;
  const userRef = db.collection("users").doc(userId);
  return db.runTransaction(async (tx) => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new HttpsError("not-found", "Person nicht gefunden.");
    const map = toGrantMap(user.get("permissions"));
    if (!map[permissionId]) return { changed: false };
    delete map[permissionId];
    tx.update(userRef, {
      permissions: map,
      modifiedBy: actorUid,
      modifiedAt: FieldValue.serverTimestamp(),
    });
    return { changed: true };
  });
}

export const grantPermissionHandler = async (request: CallableRequest<unknown>) => {
  const input = parse(request);
  const result = await grantPermission(getFirestore(), input);
  logger.info("Admin granted a permission", {
    userId: input.userId,
    permissionId: input.permissionId,
    by: input.actorUid,
    changed: result.changed,
  });
  return result;
};

export const revokePermissionHandler = async (request: CallableRequest<unknown>) => {
  const input = parse(request);
  const result = await revokePermission(getFirestore(), input);
  logger.info("Admin removed a permission", {
    userId: input.userId,
    permissionId: input.permissionId,
    by: input.actorUid,
    changed: result.changed,
  });
  return result;
};
