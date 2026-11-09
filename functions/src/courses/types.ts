// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/** Firestore shapes of the course feature (#842); see firestore/schema.jsonc. */

import type { DocumentReference, Timestamp } from "firebase-admin/firestore";
import type { CourseChoice } from "@oww/shared";

/** `courses/{offerId}` — what the checkout keeps of an edoobox course. */
export interface CourseEntity {
  /** The permission the course grants; null = none. Unset until the leader picked. */
  permission?: DocumentReference | null;
  permissionSetBy?: DocumentReference;
  permissionSetAt?: Timestamp;
  /** Title at the last read, for admin lists and mails. */
  title?: string;
  closedAt?: Timestamp | null;
  closedBy?: DocumentReference | null;
  /** participantId → Ja/Nein at the close. */
  closeChoices?: Record<string, boolean>;
  /** Reminder days already sent (1, 3, 7) — CRS-16. */
  remindersSent?: number[];
}

/** `courseLinks/{offerId}_{participantId}` — a participant linked to an account (CRS-6/7). */
export interface CourseLinkEntity {
  offerId: string;
  participantId: string;
  edooboxUserId: string;
  user: DocumentReference;
  choice: CourseChoice;
  linkedBy: DocumentReference;
  linkedAt: Timestamp;
  /** For the admin's list of a person's course links (ADM-18). */
  offerTitle: string;
  participantName: string;
}

export function courseLinkId(offerId: string, participantId: string): string {
  return `${offerId}_${participantId}`;
}
