// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * What a course does to a person's permission grants (#842, CRS-10/11/14,
 * MAC-4). Pure functions over the grant map (`users.permissions`, #843); the
 * callers read and write the users doc in a transaction.
 *
 * A course only ever touches its own entry: `source: "course"` with its
 * `course.offerId`. A grant from an admin or another course is left alone,
 * and a person who holds the permission for good already gets nothing.
 */

import { Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { courseWindows, type CourseDate, type StoredPermissions } from "@oww/shared";
import { toGrantMap, type AdminPermissionGrant } from "../auth/permission-grants";

type GrantMap = Record<string, AdminPermissionGrant>;

export function isThisCoursesGrant(grant: AdminPermissionGrant | undefined, offerId: string): boolean {
  return grant?.source === "course" && grant.course?.offerId === offerId;
}

/** Held for good, not from this course: «Schon berechtigt» (CRS-10). */
export function holdsForGoodElsewhere(
  stored: StoredPermissions,
  permissionId: string,
  offerId: string
): boolean {
  const grant = toGrantMap(stored)[permissionId];
  return !!grant && !grant.windows && !isThisCoursesGrant(grant, offerId);
}

/**
 * Vorläufig or Ja before the close (CRS-11): this course's temporary entry
 * with the Termine as windows. Returns null when nothing changes.
 */
export function withTemporaryGrant(
  stored: StoredPermissions,
  input: {
    permission: DocumentReference;
    offerId: string;
    dates: readonly CourseDate[];
    grantedBy: DocumentReference;
    now: Timestamp;
    /** Only move the windows of an existing entry (the daily sync): an admin's removal holds. */
    onlyIfPresent?: boolean;
  }
): GrantMap | null {
  const map = toGrantMap(stored);
  const existing = map[input.permission.id];
  if (existing && !isThisCoursesGrant(existing, input.offerId)) return null;
  if (!existing && input.onlyIfPresent) return null;
  // Already for good from this course (closed with Ja) — not ours to narrow.
  if (existing && !existing.windows) return null;
  const windows = courseWindows(input.dates).map((w) => ({
    from: Timestamp.fromMillis(w.fromMs),
    until: Timestamp.fromMillis(w.untilMs),
  }));
  if (existing && sameWindows(existing.windows ?? [], windows)) return null;
  map[input.permission.id] = {
    permission: input.permission,
    grantedAt: existing?.grantedAt ?? input.now,
    grantedBy: existing?.grantedBy ?? input.grantedBy,
    source: "course",
    course: { offerId: input.offerId },
    windows,
  };
  return map;
}

/** Nein (CRS-10/14), an unlink, a cancelled booking: drop this course's temporary entry. */
export function withoutTemporaryGrant(
  stored: StoredPermissions,
  permissionId: string,
  offerId: string
): GrantMap | null {
  const map = toGrantMap(stored);
  const existing = map[permissionId];
  if (!isThisCoursesGrant(existing, offerId) || !existing.windows) return null;
  delete map[permissionId];
  return map;
}

/**
 * Ja at the close (CRS-14, MAC-4): this course's entry becomes permanent,
 * or a new one is added; a grant from an admin or another course stays.
 */
export function withPermanentGrant(
  stored: StoredPermissions,
  input: {
    permission: DocumentReference;
    offerId: string;
    grantedBy: DocumentReference;
    now: Timestamp;
  }
): GrantMap | null {
  const map = toGrantMap(stored);
  const existing = map[input.permission.id];
  if (existing && !isThisCoursesGrant(existing, input.offerId)) {
    // Someone else's grant. A temporary one from another course is replaced:
    // this close makes it permanent.
    if (!existing.windows) return null;
  }
  if (existing && isThisCoursesGrant(existing, input.offerId) && !existing.windows) return null;
  map[input.permission.id] = {
    permission: input.permission,
    grantedAt: input.now,
    grantedBy: input.grantedBy,
    source: "course",
    course: { offerId: input.offerId },
  };
  return map;
}

function sameWindows(
  a: ReadonlyArray<{ from: Timestamp; until: Timestamp }>,
  b: ReadonlyArray<{ from: Timestamp; until: Timestamp }>
): boolean {
  return (
    a.length === b.length &&
    a.every((w, i) => w.from.toMillis() === b[i].from.toMillis() && w.until.toMillis() === b[i].until.toMillis())
  );
}
