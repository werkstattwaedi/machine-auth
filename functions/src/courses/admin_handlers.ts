// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `courseCall` handlers for admins (#842): link a person to an edoobox
 * leader (ADM-17) and remove a participant's link (ADM-18).
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import type {
  ListEdooboxLeadersResult,
  SetEdooboxLeaderInput,
  UnlinkCourseParticipantInput,
} from "@oww/shared";
import { edooboxApi } from "./edoobox";
import { edooboxUnavailable, removeCourseLink, requireAdmin, requireString } from "./course_service";
import { courseLinkRef } from "./types";

export const listEdooboxLeadersHandler = async (
  request: CallableRequest<unknown>
): Promise<ListEdooboxLeadersResult> => {
  const { db } = requireAdmin(request);
  let admins;
  try {
    admins = await edooboxApi().listAdmins();
  } catch (err) {
    throw edooboxUnavailable(err);
  }
  const linked = await db.collection("users").where("edooboxLeaderId", "!=", null).get();
  const byAdmin = new Map(linked.docs.map((d) => [d.get("edooboxLeaderId") as string, d.id]));
  return {
    leaders: admins
      .filter((a) => a.active)
      .map((a) => ({
        adminId: a.id,
        name: `${a.firstName} ${a.lastName}`.trim() || a.email,
        email: a.email,
        linkedUserId: byAdmin.get(a.id) ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "de")),
  };
};

/** The number of courses an edoobox leader leads, for the admin's check. */
export const countLeaderCoursesHandler = async (
  request: CallableRequest<{ adminId?: unknown }>
): Promise<{ courses: number }> => {
  requireAdmin(request);
  const adminId = requireString(request.data?.adminId, "adminId");
  try {
    const dates = await edooboxApi().listLeaderDates(adminId);
    return { courses: new Set(dates.map((d) => d.offerId)).size };
  } catch (err) {
    throw edooboxUnavailable(err);
  }
};

/** ADM-17: an edoobox leader belongs to at most one person. */
export const setEdooboxLeaderHandler = async (
  request: CallableRequest<SetEdooboxLeaderInput>
): Promise<{ ok: true }> => {
  const { db, adminUid } = requireAdmin(request);
  const userId = requireString(request.data?.userId, "userId");
  const adminId = request.data?.adminId ?? null;
  if (adminId !== null && (typeof adminId !== "string" || !adminId)) {
    throw new HttpsError("invalid-argument", "adminId must be a string or null");
  }
  const userRef = db.collection("users").doc(userId);
  await db.runTransaction(async (tx) => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new HttpsError("not-found", "Person nicht gefunden.");
    if (adminId) {
      const holders = await tx.get(db.collection("users").where("edooboxLeaderId", "==", adminId));
      if (holders.docs.some((d) => d.id !== userId)) {
        throw new HttpsError("already-exists", "Diese edoobox-Leitung ist schon mit einer anderen Person verknüpft.");
      }
    }
    tx.update(userRef, {
      edooboxLeaderId: adminId ?? FieldValue.delete(),
      modifiedBy: adminUid,
      modifiedAt: FieldValue.serverTimestamp(),
    });
  });
  logger.info("courseCall: edoobox leader set", { userId, adminId, by: adminUid });
  return { ok: true };
};

/**
 * ADM-18: remove a participant's link, its choice and that course's
 * temporary permission; a permission the close granted for good stays.
 */
export const unlinkCourseParticipantHandler = async (
  request: CallableRequest<UnlinkCourseParticipantInput>
): Promise<{ ok: true }> => {
  const { db, adminUid } = requireAdmin(request);
  const offerId = requireString(request.data?.offerId, "offerId");
  const participantId = requireString(request.data?.participantId, "participantId");
  await db.runTransaction(async (tx) => {
    if (!(await removeCourseLink(db, tx, courseLinkRef(db, offerId, participantId)))) {
      throw new HttpsError("not-found", "Diese Verknüpfung gibt es nicht.");
    }
  });
  logger.info("courseCall: participant unlinked", { offerId, participantId, by: adminUid });
  return { ok: true };
};
