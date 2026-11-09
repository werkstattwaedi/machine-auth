// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Reading a course leader's courses (#842, docs/spec/courses.md): who may
 * act (CRS-1, CRS-8) and the course as edoobox has it, merged with what the
 * checkout keeps — the links, the choices, the picked permission and the
 * close (CRS-3).
 */

import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import {
  getFirestore,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from "firebase-admin/firestore";
import {
  WORKSHOP_IDS,
  coursePhase,
  type AttendanceStatus,
  type CourseDate,
  type CourseDetail,
  type CourseParticipant,
  type CourseSummary,
  type WorkshopId,
} from "@oww/shared";
import { callerUserRef } from "../membership/shared";
import { findUserDocByEmail, normalizeEmail } from "../auth/identity";
import {
  EdooboxError,
  edooboxApi,
  isEdooboxConfigured,
  offeredStatusNumbers,
  type EdooboxApi,
  type EdooboxDate,
} from "./edoobox";
import { holdsForGoodElsewhere } from "./grants";
import { courseLinkId, type CourseEntity, type CourseLinkEntity } from "./types";

/**
 * A course past its last Termin stays on Kursleitung this long while it
 * isn't closed (CRS-2); older ones — e.g. every course from before the
 * feature — would otherwise all show «Abschliessen» forever.
 */
export const CLOSE_LISTING_DAYS = 60;

export interface Leader {
  db: Firestore;
  userRef: DocumentReference;
  adminId: string;
}

/** CRS-1: only an account linked to an edoobox leader. Kiosk sessions need the step-up. */
export async function requireLeader(request: CallableRequest<unknown>): Promise<Leader> {
  if (!isEdooboxConfigured()) {
    throw new HttpsError("failed-precondition", "Kurse sind nicht eingerichtet.");
  }
  const db = getFirestore();
  const userRef = callerUserRef(db, request.auth?.uid, request.auth?.token as Record<string, unknown>);
  const user = await userRef.get();
  const adminId = user.get("edooboxLeaderId");
  if (typeof adminId !== "string" || !adminId) {
    throw new HttpsError("permission-denied", "Nur für Kursleitende.");
  }
  return { db, userRef, adminId };
}

export function requireAdmin(request: CallableRequest<unknown>): { db: Firestore; adminUid: string } {
  if (!request.auth?.token?.admin) {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  return { db: getFirestore(), adminUid: request.auth.uid };
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) {
    throw new HttpsError("invalid-argument", `${name} is required`);
  }
  return value;
}

/** edoobox failures reach the page as one message (the list's error banner). */
export function edooboxUnavailable(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  return new HttpsError("unavailable", "edoobox ist nicht erreichbar. Versuche es in ein paar Minuten nochmals.", {
    reason: "edoobox",
    detail: err instanceof EdooboxError ? `${err.status ?? ""} ${err.code ?? ""}`.trim() : undefined,
  });
}

function toCourseDate(d: EdooboxDate): CourseDate {
  return { dateId: d.id, start: d.start, end: d.end };
}

function sortDates(dates: CourseDate[]): CourseDate[] {
  return dates.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

function workshopOf(tags: readonly string[]): WorkshopId | null {
  for (const t of tags) {
    const id = t.trim().toLowerCase() as WorkshopId;
    if ((WORKSHOP_IDS as readonly string[]).includes(id)) return id;
  }
  return null;
}

/** CRS-8: the leader leads at least one Termin of the offer. */
export async function requireLeadsOffer(api: EdooboxApi, leader: Leader, offerId: string): Promise<void> {
  const dates = await api.listLeaderDates(leader.adminId);
  if (!dates.some((d) => d.offerId === offerId)) {
    throw new HttpsError("permission-denied", "Diesen Kurs leitest du nicht.");
  }
}

export async function listMyCourses(leader: Leader, nowMs = Date.now()): Promise<CourseSummary[]> {
  const api = edooboxApi();
  const leaderDates = await api.listLeaderDates(leader.adminId);
  const offerIds = [...new Set(leaderDates.map((d) => d.offerId))];
  if (offerIds.length === 0) return [];

  const courseDocs = await leader.db.getAll(...offerIds.map((id) => leader.db.collection("courses").doc(id)));
  const closed = new Set(courseDocs.filter((d) => d.get("closedAt")).map((d) => d.id));
  const open = offerIds.filter((id) => !closed.has(id));
  if (open.length === 0) return [];

  const [offers, datesPerOffer, bookingsPerOffer] = await Promise.all([
    api.getOffers(open),
    Promise.all(open.map((id) => api.listOfferDates(id))),
    Promise.all(open.map((id) => api.listBookings(id))),
  ]);
  const cutoff = nowMs - CLOSE_LISTING_DAYS * 86400_000;
  const out: CourseSummary[] = [];
  open.forEach((offerId, i) => {
    const offer = offers.find((o) => o.id === offerId);
    const dates = sortDates(datesPerOffer[i].map(toCourseDate));
    if (!offer || dates.length === 0) return;
    const phase = coursePhase(dates, nowMs);
    if (phase === "toClose" && Date.parse(dates[dates.length - 1].end) < cutoff) return;
    const participants = new Set(
      bookingsPerOffer[i].filter((b) => !b.cancelled && !b.waitingList).flatMap((b) => b.userIds)
    );
    out.push({
      offerId,
      title: offer.name,
      workshop: workshopOf(offer.tags),
      dates,
      participantCount: participants.size,
      phase,
    });
  });
  // Running and to-close first, then upcoming; each by first Termin.
  const rank = { running: 0, toClose: 1, upcoming: 2 } as const;
  return out.sort((a, b) => rank[a.phase] - rank[b.phase] || Date.parse(a.dates[0].start) - Date.parse(b.dates[0].start));
}

/** Everything a course handler needs, read once. */
export interface LoadedCourse {
  detail: CourseDetail;
  course: CourseEntity;
  links: Map<string, CourseLinkEntity>;
  dates: CourseDate[];
  statuses: Map<number, AttendanceStatus>;
  /** participantId → edoobox attendance record id, per dateId. */
  attendanceIds: Map<string, string>;
  bookingByUser: Map<string, string>;
}

export async function loadCourse(leader: Leader, offerId: string, nowMs = Date.now()): Promise<LoadedCourse> {
  const api = edooboxApi();
  await requireLeadsOffer(api, leader, offerId);
  const [offers, rawDates, bookings, statuses, courseSnap, linkSnap] = await Promise.all([
    api.getOffers([offerId]),
    api.listOfferDates(offerId),
    api.listBookings(offerId),
    api.attendanceStatuses(),
    leader.db.collection("courses").doc(offerId).get(),
    leader.db.collection("courseLinks").where("offerId", "==", offerId).get(),
  ]);
  const offer = offers[0];
  if (!offer) throw new HttpsError("not-found", "Kurs nicht gefunden.");
  const dates = sortDates(rawDates.map(toCourseDate));
  const table = await api.attendanceTable(offerId, dates.map((d) => d.dateId));

  const activeBookings = bookings.filter((b) => !b.cancelled && !b.waitingList);
  const bookingByUser = new Map<string, string>();
  for (const b of activeBookings) for (const u of b.userIds) bookingByUser.set(u, b.bookingId);
  const participants = table.participants.filter((p) => bookingByUser.has(p.userId));
  const users = new Map((await api.getUsers(participants.map((p) => p.userId))).map((u) => [u.id, u]));

  const statusMap = new Map(statuses.map((s) => [s.status, s]));
  const offeredNumbers = offeredStatusNumbers();
  const offeredStatuses = offeredNumbers.map((n) => statusMap.get(n)).filter((s): s is AttendanceStatus => !!s);

  const attendance = new Map<string, Record<string, number>>();
  const attendanceIds = new Map<string, string>();
  for (const a of table.attendances) {
    const rec = attendance.get(a.participantId) ?? {};
    rec[a.dateId] = a.status;
    attendance.set(a.participantId, rec);
    attendanceIds.set(`${a.participantId}|${a.dateId}`, a.attendanceId);
  }

  const course = (courseSnap.data() ?? {}) as CourseEntity;
  const links = new Map(linkSnap.docs.map((d) => [d.get("participantId") as string, d.data() as CourseLinkEntity]));
  const permissionRef = course.permission ?? null;
  const permissionSnap = permissionRef ? await permissionRef.get() : null;

  // Linked accounts: their badge and whether they hold the permission already.
  const linkedUserSnaps = new Map<string, DocumentSnapshot>();
  const linkedRefs = [...links.values()].map((l) => l.user);
  if (linkedRefs.length) {
    for (const s of await leader.db.getAll(...linkedRefs)) linkedUserSnaps.set(s.id, s);
  }
  const badgeHolders = new Set<string>();
  await Promise.all(
    linkedRefs.map(async (ref) => {
      const tokens = await leader.db.collection("tokens").where("userId", "==", ref).get();
      if (tokens.docs.some((t) => !t.get("deactivated"))) badgeHolders.add(ref.id);
    })
  );

  const out: CourseParticipant[] = await Promise.all(
    participants.map(async (p) => {
      const u = users.get(p.userId);
      const link = links.get(p.participantId);
      const email = u?.email ?? "";
      const userSnap = link ? linkedUserSnaps.get(link.user.id) : undefined;
      return {
        participantId: p.participantId,
        bookingId: bookingByUser.get(p.userId) ?? null,
        edooboxUserId: p.userId,
        firstName: u?.firstName ?? "",
        lastName: u?.lastName ?? "",
        email,
        attendance: attendance.get(p.participantId) ?? {},
        link: link
          ? {
              userId: link.user.id,
              choice: link.choice,
              hasBadge: badgeHolders.has(link.user.id),
              alreadyHeld: permissionRef
                ? holdsForGoodElsewhere(userSnap?.get("permissions"), permissionRef.id, offerId)
                : false,
            }
          : null,
        accountExists: link ? true : email ? !!(await findUserDocByEmail(leader.db, normalizeEmail(email))) : false,
      };
    })
  );
  out.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, "de"));

  const detail: CourseDetail = {
    offerId,
    title: offer.name,
    workshop: workshopOf(offer.tags),
    dates,
    participantCount: out.length,
    phase: coursePhase(dates, nowMs),
    permission: permissionRef && permissionSnap?.exists
      ? { id: permissionRef.id, name: String(permissionSnap.get("name") ?? permissionRef.id) }
      : null,
    permissionChosen: course.permission !== undefined,
    permissionLocked: links.size > 0,
    offeredStatuses,
    allStatuses: statuses,
    participants: out,
    closedAt: course.closedAt ? course.closedAt.toDate().toISOString() : null,
  };
  return { detail, course, links, dates, statuses: statusMap, attendanceIds, bookingByUser };
}

export function participantOf(loaded: LoadedCourse, participantId: string): CourseParticipant {
  const p = loaded.detail.participants.find((x) => x.participantId === participantId);
  if (!p) throw new HttpsError("not-found", "Diese Person ist nicht in diesem Kurs.");
  return p;
}

export function requireOpen(loaded: LoadedCourse): void {
  if (loaded.detail.closedAt) {
    throw new HttpsError("failed-precondition", "Der Kurs ist abgeschlossen. Änderungen macht das Sekretariat.");
  }
}

export { courseLinkId };
