// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/** Firestore shapes of the course feature (#842); see firestore/schema.jsonc. */

import type {
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Query,
  Timestamp,
} from "firebase-admin/firestore";
import type { CourseChoice } from "@oww/shared";

/** `courses/{offerId}` — what the checkout keeps of an edoobox course. */
export interface CourseEntity {
  /** The permissions the course grants; [] = none. Unset until the leader picked (CRS-17). */
  permissions?: DocumentReference[];
  permissionSetBy?: DocumentReference;
  permissionSetAt?: Timestamp;
  /** Title at the last read, for admin lists and mails. */
  title?: string;
  closedAt?: Timestamp | null;
  closedBy?: DocumentReference | null;
  /** participantId → Ja/Nein at the close. */
  closeChoices?: Record<string, boolean>;
  /** Reminders sent, `<day>:<leader uid>` and `7:office` — CRS-16. */
  remindersSent?: string[];
}

/**
 * `courses/{offerId}/links/{participantId}` — a participant linked to an
 * account (CRS-6/7). The doc id is edoobox's participant id (their place on
 * this course, which attendance is recorded against); `edooboxUserId` is the
 * person in edoobox, which bookings name.
 */
export interface CourseLinkEntity {
  /** The parent course's id, for collection-group readers. */
  offerId: string;
  edooboxUserId: string;
  user: DocumentReference;
  choice: CourseChoice;
  linkedBy: DocumentReference;
  linkedAt: Timestamp;
  /** For the admin's list of a person's course links (ADM-18). */
  offerTitle: string;
  participantName: string;
}

/** One course's links: `courses/{offerId}/links`. */
export function courseLinksOf(db: Firestore, offerId: string): CollectionReference {
  return db.collection("courses").doc(offerId).collection(COURSE_LINKS);
}

export function courseLinkRef(db: Firestore, offerId: string, participantId: string): DocumentReference {
  return courseLinksOf(db, offerId).doc(participantId);
}

/** Every course's links (the daily job, the person's list, erasure). */
export function allCourseLinks(db: Firestore): Query {
  return db.collectionGroup(COURSE_LINKS);
}

export const COURSE_LINKS = "links";

/** A stored link with its participant id (the doc id). */
export type StoredCourseLink = CourseLinkEntity & { participantId: string; ref: DocumentReference };

export function storedLink(snap: DocumentSnapshot): StoredCourseLink {
  return { ...(snap.data() as CourseLinkEntity), participantId: snap.id, ref: snap.ref };
}
