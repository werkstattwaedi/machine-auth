// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Daily course sync (#842), early morning:
 * - CRS-11: keeps the temporary permissions in step with edoobox — new
 *   windows for Termine moved there, no permission for a cancelled booking,
 *   and none left over once a course's last window has passed.
 * - CRS-16: reminds every course leader 1, 3 and 7 days after the last Termin
 *   of a course that isn't closed; on day 7 the office too.
 * - CRS-18: on Sundays, removes the links whose data edoobox no longer has.
 *
 * edoobox has webhooks (see the plan); this polls once a day instead, which
 * the spec accepts ("takes effect the next morning").
 */

import * as logger from "firebase-functions/logger";
import { defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import type { CourseDate } from "@oww/shared";
import { formatFullName } from "../util/username-utils";
import { resolveCheckoutDomain } from "../util/checkout-domain";
import { formatWorkshopDateTime, getWorkshopTimezone } from "../util/workshop_timezone";
import { resendApiKey, sendTemplate } from "../util/resend_template";
import { EDOOBOX_SECRETS, edooboxApi, isEdooboxConfigured, type EdooboxApi } from "./edoobox";
import { forEachPermission, withTemporaryGrant, withoutTemporaryGrant } from "./grants";
import { CLOSE_LISTING_DAYS, removeCourseLink } from "./course_service";
import { allCourseLinks, storedLink, type CourseEntity, type StoredCourseLink } from "./types";

/** Where the day-7 notice goes (CRS-16); empty skips it. */
const courseOfficeEmail = defineString("COURSE_OFFICE_EMAIL", { default: "" });

export const REMINDER_DAYS = [1, 3, 7] as const;

let send: typeof sendTemplate = sendTemplate;

/** Tests: capture the reminder mails; undefined restores Resend. */
export function setCourseMailerForTest(fn: typeof sendTemplate | undefined): void {
  send = fn ?? sendTemplate;
}

export interface CourseSyncReport {
  offers: number;
  grantsChanged: number;
  reminders: number;
  officeNotices: number;
  linksPruned: number;
  failures: number;
}

/** Calendar days between two instants in the workshop's time zone. */
export function zurichDayDiff(earlierMs: number, laterMs: number): number {
  const day = (ms: number) => {
    const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: getWorkshopTimezone() })
      .format(new Date(ms))
      .split("-")
      .map(Number);
    return Date.UTC(y, m - 1, d) / 86400_000;
  };
  return day(laterMs) - day(earlierMs);
}

function toCourseDates(api: Awaited<ReturnType<EdooboxApi["listOfferDates"]>>): CourseDate[] {
  return api
    .map((d) => ({ dateId: d.id, start: d.start, end: d.end }))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/**
 * CRS-11: move the temporary permissions of every open course with links to
 * its Termine, and drop them for a booking no longer active. One whose last
 * window has passed stays: it holds nothing outside its windows, and a
 * Termin added later (a make-up date) must reach it. The close ends it.
 */
async function syncGrants(db: Firestore, api: EdooboxApi, nowMs: number, report: CourseSyncReport): Promise<void> {
  // Nein links hold no temporary permission; skip them.
  const links = await allCourseLinks(db).where("choice", "in", ["temp", "yes"]).get();
  const byOffer = new Map<string, StoredCourseLink[]>();
  for (const d of links.docs) {
    const l = storedLink(d);
    byOffer.set(l.offerId, [...(byOffer.get(l.offerId) ?? []), l]);
  }
  for (const [offerId, offerLinks] of byOffer) {
    try {
      const course = ((await db.collection("courses").doc(offerId).get()).data() ?? {}) as CourseEntity;
      const permissions = course.permissions ?? [];
      if (course.closedAt || !permissions.length) continue;
      report.offers++;
      const [dates, bookings] = await Promise.all([api.listOfferDates(offerId).then(toCourseDates), api.listBookings(offerId)]);
      const booked = new Set(
        bookings.filter((b) => !b.cancelled && !b.waitingList).flatMap((b) => b.userIds)
      );
      for (const link of offerLinks) {
        const keep = booked.has(link.edooboxUserId);
        const changed = await db.runTransaction(async (tx) => {
          const user = await tx.get(link.user);
          if (!user.exists) return false;
          const map = forEachPermission(user.get("permissions"), permissions, (stored, permission) =>
            keep
              ? withTemporaryGrant(stored, {
                  permission,
                  offerId,
                  dates,
                  grantedBy: link.linkedBy,
                  now: Timestamp.fromMillis(nowMs),
                  onlyIfPresent: true,
                })
              : withoutTemporaryGrant(stored, permission.id, offerId)
          );
          if (map) tx.update(link.user, { permissions: map });
          return !!map;
        });
        if (changed) report.grantsChanged++;
      }
    } catch (err) {
      report.failures++;
      logger.warn("syncCourses: offer not synced", { offerId, err: String(err) });
    }
  }
}

/** CRS-16: 1, 3 and 7 days after the last Termin of an unclosed course. */
async function sendReminders(db: Firestore, api: EdooboxApi, nowMs: number, report: CourseSyncReport): Promise<void> {
  const leaders = await db.collection("users").where("edooboxLeaderId", "!=", null).get();
  for (const leader of leaders.docs) {
    const email = leader.get("email") as string | null;
    if (!email) continue;
    const leaderName = formatFullName(
      { firstName: leader.get("firstName"), lastName: leader.get("lastName") },
      email
    );
    let offerIds: string[];
    try {
      const leaderDates = await api.listLeaderDates(leader.get("edooboxLeaderId"));
      // The course's last Termin decides, which another leader may lead
      // (CRS-16): look at every course with a Termin of this leader in the
      // listing window (CRS-2), as Kursleitung does.
      const recent = nowMs - CLOSE_LISTING_DAYS * 86400_000;
      offerIds = [...new Set(leaderDates.filter((d) => Date.parse(d.end) >= recent).map((d) => d.offerId))];
    } catch (err) {
      report.failures++;
      logger.warn("syncCourses: reminders not sent", { leader: leader.id, err: String(err) });
      continue;
    }
    // One course failing doesn't cost the leader's other reminders today.
    for (const offerId of offerIds) {
      try {
        await remindForOffer(db, api, nowMs, report, { id: leader.id, email, name: leaderName }, offerId);
      } catch (err) {
        report.failures++;
        logger.warn("syncCourses: reminder not sent", { leader: leader.id, offerId, err: String(err) });
      }
    }
  }
}

async function remindForOffer(
  db: Firestore,
  api: EdooboxApi,
  nowMs: number,
  report: CourseSyncReport,
  leader: { id: string; email: string; name: string },
  offerId: string
): Promise<void> {
  const courseRef = db.collection("courses").doc(offerId);
  const course = ((await courseRef.get()).data() ?? {}) as CourseEntity;
  if (course.closedAt) return;
  const dates = toCourseDates(await api.listOfferDates(offerId));
  if (!dates.length) return;
  const last = dates[dates.length - 1];
  const days = zurichDayDiff(Date.parse(last.start), nowMs);
  if (days > CLOSE_LISTING_DAYS) return;
  // Only today's reminder — a missed run doesn't send a pile of them.
  // Kept per leader: a course can have several (CRS-16).
  const day = (REMINDER_DAYS as readonly number[]).includes(days) ? days : null;
  if (day === null) return;
  const sent = (course.remindersSent ?? []).map(String);
  const office = courseOfficeEmail.value().trim();
  // Each recorded on its own, so a re-run sends exactly what failed.
  const leaderDue = !sent.includes(`${day}:${leader.id}`);
  const officeDue = day === 7 && !!office && !sent.includes("7:office");
  if (!leaderDue && !officeDue) return;
  const title = course.title ?? (await api.getOffers([offerId]))[0]?.name ?? "Kurs";
  const lastDate = formatWorkshopDateTime(new Date(last.start), "EEEEEE d.M.");
  if (leaderDue) {
    await send({
      to: leader.email,
      mail: "course-close-reminder",
      dims: {},
      variables: {
        LEADER_NAME: leader.name,
        COURSE_TITLE: title,
        LAST_DATE: lastDate,
        COURSE_LINK: `https://${resolveCheckoutDomain()}/account/courses/${offerId}`,
      },
    });
    report.reminders++;
    await courseRef.set({ remindersSent: FieldValue.arrayUnion(`${day}:${leader.id}`), title }, { merge: true });
  }
  if (officeDue) {
    await send({
      to: office,
      mail: "course-close-office",
      dims: {},
      variables: { LEADER_NAME: leader.name, COURSE_TITLE: title, LAST_DATE: lastDate },
    });
    report.officeNotices++;
    await courseRef.set({ remindersSent: FieldValue.arrayUnion("7:office"), title }, { merge: true });
  }
}

/**
 * CRS-18: a link lives as long as edoobox keeps its data — the offer, and a
 * booking (cancelled ones too) of the participant. Gone there, the link and
 * its course's temporary permission go; a permission granted for good stays.
 * Weekly: edoobox deletes rarely, and every course ever linked costs a read.
 */
export async function pruneCourseLinks(db: Firestore, api: EdooboxApi, report: CourseSyncReport): Promise<void> {
  const links = await allCourseLinks(db).get();
  const byOffer = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  for (const d of links.docs) {
    const offerId = d.ref.parent.parent!.id;
    byOffer.set(offerId, [...(byOffer.get(offerId) ?? []), d]);
  }
  for (const [offerId, offerLinks] of byOffer) {
    try {
      // Only a successful answer that the data is gone deletes; a failure skips.
      const exists = await api.offerExists(offerId);
      const booked = exists
        ? new Set((await api.listBookings(offerId)).flatMap((b) => b.userIds))
        : new Set<string>();
      const gone = offerLinks.filter((d) => !booked.has(d.get("edooboxUserId") as string));
      if (!gone.length) continue;
      for (const linkSnap of gone) {
        if (await db.runTransaction((tx) => removeCourseLink(db, tx, linkSnap.ref))) report.linksPruned++;
      }
      logger.info("syncCourses: links pruned", { offerId, count: gone.length, offerGone: !exists });
    } catch (err) {
      report.failures++;
      logger.warn("syncCourses: links not pruned", { offerId, err: String(err) });
    }
  }
}

/** Sunday in the workshop's time zone. */
function isPruneDay(nowMs: number): boolean {
  return new Intl.DateTimeFormat("en-US", { timeZone: getWorkshopTimezone(), weekday: "short" }).format(new Date(nowMs)) === "Sun";
}

export async function runSyncCourses(nowMs = Date.now()): Promise<CourseSyncReport> {
  const report: CourseSyncReport = { offers: 0, grantsChanged: 0, reminders: 0, officeNotices: 0, linksPruned: 0, failures: 0 };
  if (!isEdooboxConfigured()) return report;
  const db = getFirestore();
  const api = edooboxApi();
  await syncGrants(db, api, nowMs, report);
  await sendReminders(db, api, nowMs, report);
  if (isPruneDay(nowMs)) await pruneCourseLinks(db, api, report);
  logger.info("syncCourses done", { ...report });
  return report;
}

export const syncCourses = onSchedule(
  {
    schedule: "every day 05:30",
    timeZone: "Europe/Zurich",
    secrets: [...EDOOBOX_SECRETS, resendApiKey],
    timeoutSeconds: 540,
  },
  async () => {
    await runSyncCourses();
  }
);
