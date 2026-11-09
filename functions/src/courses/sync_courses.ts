// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Daily course sync (#842), early morning:
 * - CRS-11: keeps the temporary permissions in step with edoobox — new
 *   windows for Termine moved there, no permission for a cancelled booking,
 *   and none left over once a course's last window has passed.
 * - CRS-16: reminds the course leader 1, 3 and 7 days after the last Termin
 *   of a course that isn't closed; on day 7 the office too.
 *
 * edoobox has webhooks (see the plan); this polls once a day instead, which
 * the spec accepts ("takes effect the next morning").
 */

import * as logger from "firebase-functions/logger";
import { defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import { COURSE_WINDOW_TAIL_MS, type CourseDate } from "@oww/shared";
import { formatFullName } from "../util/username-utils";
import { resolveCheckoutDomain } from "../util/checkout-domain";
import { formatWorkshopDateTime, getWorkshopTimezone } from "../util/workshop_timezone";
import { resendApiKey, sendTemplate } from "../util/resend_template";
import { EDOOBOX_SECRETS, edooboxApi, isEdooboxConfigured, type EdooboxApi } from "./edoobox";
import { withTemporaryGrant, withoutTemporaryGrant } from "./grants";
import { CLOSE_LISTING_DAYS } from "./course_service";
import type { CourseEntity, CourseLinkEntity } from "./types";

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

/** CRS-11: rewrite or drop the temporary permissions of every open course with links. */
async function syncGrants(db: Firestore, api: EdooboxApi, nowMs: number, report: CourseSyncReport): Promise<void> {
  const links = await db.collection("courseLinks").get();
  const byOffer = new Map<string, CourseLinkEntity[]>();
  for (const d of links.docs) {
    const l = d.data() as CourseLinkEntity;
    byOffer.set(l.offerId, [...(byOffer.get(l.offerId) ?? []), l]);
  }
  for (const [offerId, offerLinks] of byOffer) {
    try {
      const course = ((await db.collection("courses").doc(offerId).get()).data() ?? {}) as CourseEntity;
      const permission = course.permission ?? null;
      if (course.closedAt || !permission) continue;
      report.offers++;
      const [dates, bookings] = await Promise.all([api.listOfferDates(offerId).then(toCourseDates), api.listBookings(offerId)]);
      const booked = new Set(
        bookings.filter((b) => !b.cancelled && !b.waitingList).flatMap((b) => b.userIds)
      );
      const lastUntil = dates.length ? Date.parse(dates[dates.length - 1].end) + COURSE_WINDOW_TAIL_MS : 0;
      for (const link of offerLinks) {
        if (link.choice === "no") continue;
        const keep = booked.has(link.edooboxUserId) && nowMs < lastUntil;
        const changed = await db.runTransaction(async (tx) => {
          const user = await tx.get(link.user);
          if (!user.exists) return false;
          const map = keep
            ? withTemporaryGrant(user.get("permissions"), {
                permission,
                offerId,
                dates,
                grantedBy: link.linkedBy,
                now: Timestamp.fromMillis(nowMs),
              })
            : withoutTemporaryGrant(user.get("permissions"), permission.id, offerId);
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
    try {
      const leaderDates = await api.listLeaderDates(leader.get("edooboxLeaderId"));
      const offerIds = [...new Set(leaderDates.map((d) => d.offerId))];
      for (const offerId of offerIds) {
        const courseRef = db.collection("courses").doc(offerId);
        const course = ((await courseRef.get()).data() ?? {}) as CourseEntity;
        if (course.closedAt) continue;
        const dates = toCourseDates(await api.listOfferDates(offerId));
        if (!dates.length) continue;
        const last = dates[dates.length - 1];
        const days = zurichDayDiff(Date.parse(last.start), nowMs);
        if (days > CLOSE_LISTING_DAYS) continue;
        const due = REMINDER_DAYS.filter((d) => d <= days && !(course.remindersSent ?? []).includes(d));
        // Only today's reminder — a missed run doesn't send a pile of them.
        const day = due.includes(days as 1 | 3 | 7) ? days : null;
        if (day === null) continue;
        const title = course.title ?? (await api.getOffers([offerId]))[0]?.name ?? "Kurs";
        const permissionName = course.permission
          ? String((await course.permission.get()).get("name") ?? "")
          : "";
        const lastDate = formatWorkshopDateTime(new Date(last.start), "EEEEEE d.M.");
        await send({
          to: email,
          mail: "course-close-reminder",
          dims: { grants: permissionName ? "permission" : "none" },
          variables: {
            LEADER_NAME: leaderName,
            COURSE_TITLE: title,
            LAST_DATE: lastDate,
            PERMISSION_NAME: permissionName,
            COURSE_LINK: `https://${resolveCheckoutDomain()}/account/courses/${offerId}`,
          },
        });
        report.reminders++;
        const office = courseOfficeEmail.value().trim();
        if (day === 7 && office) {
          await send({
            to: office,
            mail: "course-close-office",
            dims: {},
            variables: { LEADER_NAME: leaderName, COURSE_TITLE: title, LAST_DATE: lastDate },
          });
          report.officeNotices++;
        }
        await courseRef.set({ remindersSent: FieldValue.arrayUnion(day), title }, { merge: true });
      }
    } catch (err) {
      report.failures++;
      logger.warn("syncCourses: reminders not sent", { leader: leader.id, err: String(err) });
    }
  }
}

export async function runSyncCourses(nowMs = Date.now()): Promise<CourseSyncReport> {
  const report: CourseSyncReport = { offers: 0, grantsChanged: 0, reminders: 0, officeNotices: 0, failures: 0 };
  if (!isEdooboxConfigured()) return report;
  const db = getFirestore();
  const api = edooboxApi();
  await syncGrants(db, api, nowMs, report);
  await sendReminders(db, api, nowMs, report);
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
