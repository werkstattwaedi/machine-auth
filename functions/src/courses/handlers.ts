// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * `courseCall` handlers for course leaders (#842, docs/spec/courses.md).
 * Every one checks the caller leads the offer in edoobox (CRS-1, CRS-8) and
 * that the course is still open (CRS-15); the checkout's buttons only
 * mirror these checks.
 */

import * as logger from "firebase-functions/logger";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  coursePhase,
  dateHasStarted,
  NO_ATTENDANCE_STATUS,
  type AssignCourseBadgeInput,
  type CheckParticipantEmailInput,
  type CheckParticipantEmailResult,
  type CloseCourseInput,
  type CloseCourseResult,
  type CourseChoice,
  type CourseDetail,
  type GetCourseInput,
  type LinkParticipantInput,
  type ListMyCoursesResult,
  type SetAttendanceInput,
  type SetCoursePermissionTypeInput,
  type SetParticipantChoiceInput,
} from "@oww/shared";
import {
  defaultIdentityDeps,
  ensureAuthIdentity,
  findUserDocByEmail,
  normalizeEmail,
} from "../auth/identity";
import { isPlausibleEmail as isPlausibleEmailAddress } from "../auth/login-code/helpers";
import { formatFullName } from "../util/username-utils";
import { diversificationMasterKey } from "../config/tag-secrets";
import { verifyBadgeVoucher } from "../badge/voucher";
import { sendAccountInstructionsEmail } from "../checkout/account_instructions";
import { edooboxApi } from "./edoobox";
import {
  edooboxUnavailable,
  listMyCourses,
  loadCourse,
  participantOf,
  requireLeader,
  requireOpen,
  requireString,
  type Leader,
  type LoadedCourse,
} from "./course_service";
import { withPermanentGrant, withTemporaryGrant, withoutTemporaryGrant } from "./grants";
import { courseLinkId, type CourseLinkEntity } from "./types";

const CHOICES: readonly CourseChoice[] = ["no", "temp", "yes"];

/** Runs `fn`; edoobox failures become the «nicht erreichbar» error. */
async function withEdoobox<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.warn("courseCall: edoobox failed", { err: String(err) });
    throw edooboxUnavailable(err);
  }
}

async function load(leader: Leader, offerId: string): Promise<LoadedCourse> {
  return withEdoobox(() => loadCourse(leader, offerId));
}

export const listMyCoursesHandler = async (request: CallableRequest<unknown>): Promise<ListMyCoursesResult> => {
  const leader = await requireLeader(request);
  return { courses: await withEdoobox(() => listMyCourses(leader)) };
};

export const getCourseHandler = async (request: CallableRequest<GetCourseInput>): Promise<CourseDetail> => {
  const leader = await requireLeader(request);
  const offerId = requireString(request.data?.offerId, "offerId");
  return (await load(leader, offerId)).detail;
};

/** CRS-17: the leader picks once what the course grants; fixed once someone is linked. */
export const setCoursePermissionTypeHandler = async (
  request: CallableRequest<SetCoursePermissionTypeInput>
): Promise<CourseDetail> => {
  const leader = await requireLeader(request);
  const offerId = requireString(request.data?.offerId, "offerId");
  const permissionId = request.data?.permissionId ?? null;
  if (permissionId !== null && typeof permissionId !== "string") {
    throw new HttpsError("invalid-argument", "permissionId must be a string or null");
  }
  const loaded = await load(leader, offerId);
  requireOpen(loaded);
  const permissionRef = permissionId ? leader.db.collection("permission").doc(permissionId) : null;
  if (permissionRef && !(await permissionRef.get()).exists) {
    throw new HttpsError("not-found", "Berechtigung nicht gefunden.");
  }
  const courseRef = leader.db.collection("courses").doc(offerId);
  await leader.db.runTransaction(async (tx) => {
    const links = await tx.get(leader.db.collection("courseLinks").where("offerId", "==", offerId).limit(1));
    if (!links.empty) {
      throw new HttpsError("failed-precondition", "Die Berechtigung ist festgelegt, sobald jemand verknüpft ist.");
    }
    tx.set(
      courseRef,
      { permission: permissionRef, permissionSetBy: leader.userRef, permissionSetAt: FieldValue.serverTimestamp(), title: loaded.detail.title },
      { merge: true }
    );
  });
  return (await load(leader, offerId)).detail;
};

/** CRS-4: a Präsenzstatus on offer (or 0 to clear), for a Termin that has started. */
export const setAttendanceHandler = async (request: CallableRequest<SetAttendanceInput>): Promise<{ ok: true }> => {
  const leader = await requireLeader(request);
  const offerId = requireString(request.data?.offerId, "offerId");
  const participantId = requireString(request.data?.participantId, "participantId");
  const dateId = requireString(request.data?.dateId, "dateId");
  const status = request.data?.status;
  if (typeof status !== "number" || !Number.isInteger(status)) {
    throw new HttpsError("invalid-argument", "status must be an integer");
  }
  const loaded = await load(leader, offerId);
  requireOpen(loaded);
  participantOf(loaded, participantId);
  const date = loaded.dates.find((d) => d.dateId === dateId);
  if (!date) throw new HttpsError("not-found", "Termin nicht gefunden.");
  if (!dateHasStarted(date, Date.now())) {
    throw new HttpsError("failed-precondition", "Dieser Termin hat noch nicht begonnen.");
  }
  const offered = new Set(loaded.detail.offeredStatuses.map((s) => s.status));
  if (status !== NO_ATTENDANCE_STATUS && !offered.has(status)) {
    throw new HttpsError("invalid-argument", "Dieser Status steht nicht zur Wahl.");
  }
  const api = edooboxApi();
  const existing = loaded.attendanceIds.get(`${participantId}|${dateId}`);
  await withEdoobox(async () => {
    if (existing) await api.updateAttendance(existing, status);
    else if (status !== NO_ATTENDANCE_STATUS) await api.createAttendance({ dateId, participantId, status });
  });
  return { ok: true };
};

export const checkParticipantEmailHandler = async (
  request: CallableRequest<CheckParticipantEmailInput>
): Promise<CheckParticipantEmailResult> => {
  const leader = await requireLeader(request);
  const offerId = requireString(request.data?.offerId, "offerId");
  const participantId = requireString(request.data?.participantId, "participantId");
  const email = normalizeEmail(requireString(request.data?.email, "email"));
  if (!isPlausibleEmailAddress(email)) throw new HttpsError("invalid-argument", "Ungültige E-Mail-Adresse.");
  const loaded = await load(leader, offerId);
  participantOf(loaded, participantId);
  return { accountExists: !!(await findUserDocByEmail(leader.db, email)) };
};

/**
 * CRS-6/7: link an existing account by e-mail, or create one from the
 * edoobox data. One link per participant (the doc id), one participant per
 * account and course (the query in the transaction).
 */
export const linkParticipantHandler = async (request: CallableRequest<LinkParticipantInput>): Promise<{ userId: string }> => {
  const leader = await requireLeader(request);
  const offerId = requireString(request.data?.offerId, "offerId");
  const participantId = requireString(request.data?.participantId, "participantId");
  const email = normalizeEmail(requireString(request.data?.email, "email"));
  const create = request.data?.create === true;
  if (!isPlausibleEmailAddress(email)) throw new HttpsError("invalid-argument", "Ungültige E-Mail-Adresse.");

  const loaded = await load(leader, offerId);
  requireOpen(loaded);
  // The pick is fixed by the first link (CRS-17), so it must come first.
  if (loaded.course.permission === undefined) {
    throw new HttpsError("failed-precondition", "Wähle zuerst, welche Berechtigung der Kurs gibt.");
  }
  const p = participantOf(loaded, participantId);
  if (p.link) throw new HttpsError("already-exists", "Diese Person ist schon verknüpft.");
  const db = leader.db;

  let userRef = (await findUserDocByEmail(db, email))?.ref ?? null;
  if (create) {
    if (userRef) throw new HttpsError("already-exists", "Für diese E-Mail gibt es schon ein Konto.");
    userRef = await createAccount(db, { email, firstName: p.firstName, lastName: p.lastName });
  } else if (!userRef) {
    throw new HttpsError("not-found", "Für diese E-Mail gibt es kein Konto.");
  }
  const target = userRef;
  const isSelf = target.id === leader.userRef.id;
  // Linking yourself never grants you anything (CRS-8): your choice is Nein.
  const choice: CourseChoice = isSelf ? "no" : "temp";
  const permission = loaded.course.permission ?? null;
  const now = Timestamp.now();

  await db.runTransaction(async (tx) => {
    const linkRef = db.collection("courseLinks").doc(courseLinkId(offerId, participantId));
    const [linkSnap, sameAccount, userSnap] = await Promise.all([
      tx.get(linkRef),
      tx.get(db.collection("courseLinks").where("offerId", "==", offerId).where("user", "==", target).limit(1)),
      tx.get(target),
    ]);
    if (linkSnap.exists) throw new HttpsError("already-exists", "Diese Person ist schon verknüpft.");
    if (!sameAccount.empty) {
      throw new HttpsError("already-exists", "Dieses Konto ist schon mit einer anderen Person in diesem Kurs verknüpft.");
    }
    const link: CourseLinkEntity = {
      offerId,
      participantId,
      edooboxUserId: p.edooboxUserId,
      user: target,
      choice,
      linkedBy: leader.userRef,
      linkedAt: now,
      offerTitle: loaded.detail.title,
      participantName: formatFullName({ firstName: p.firstName, lastName: p.lastName }, email),
    };
    tx.create(linkRef, link);
    // Keep the title for mails and the admin's lists.
    tx.set(db.collection("courses").doc(offerId), { title: loaded.detail.title }, { merge: true });
    if (permission && choice !== "no") {
      const map = withTemporaryGrant(userSnap.get("permissions"), {
        permission,
        offerId,
        dates: loaded.dates,
        grantedBy: leader.userRef,
        now,
      });
      if (map) tx.update(target, { permissions: map });
    }
  });
  logger.info("courseCall: participant linked", { offerId, participantId, userId: target.id, created: create });
  return { userId: target.id };
};

async function createAccount(
  db: FirebaseFirestore.Firestore,
  input: { email: string; firstName: string; lastName: string }
): Promise<FirebaseFirestore.DocumentReference> {
  const ref = db.collection("users").doc();
  const displayName = formatFullName(input, input.email);
  // Auth first: a conflict aborts before any doc exists (ADR-0043).
  const result = await ensureAuthIdentity(defaultIdentityDeps(), ref.id, {
    email: input.email,
    displayName,
    isAdmin: false,
  });
  if (result === "conflict") throw new HttpsError("already-exists", "Für diese E-Mail gibt es schon ein Konto.");
  await ref.create({
    created: FieldValue.serverTimestamp(),
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    permissions: {},
    roles: [],
    termsAcceptedAt: null,
    userType: "erwachsen",
    billingAddress: null,
    phone: null,
  });
  try {
    await sendAccountInstructionsEmail(input.email, input.firstName);
    await ref.update({ accountInstructionsSentAt: FieldValue.serverTimestamp() });
  } catch (err) {
    // The account exists; the mail is an ops problem, not the course leader's.
    logger.error("courseCall: account-instructions email failed", { err: String(err) });
  }
  return ref;
}

/** Only a participant's linked account, never the leader's own (CRS-8). */
function linkedTarget(loaded: LoadedCourse, leader: Leader, participantId: string): CourseLinkEntity {
  const link = loaded.links.get(participantId);
  if (!link) throw new HttpsError("failed-precondition", "Diese Person ist noch nicht verknüpft.");
  if (link.user.id === leader.userRef.id) {
    throw new HttpsError("permission-denied", "Für dein eigenes Konto geht das nicht.");
  }
  return link;
}

/** CRS-9: a tapped, unregistered badge is registered to the linked account, free. */
export const assignCourseBadgeHandler = async (
  request: CallableRequest<AssignCourseBadgeInput>
): Promise<{ tokenId: string }> => {
  const leader = await requireLeader(request);
  const offerId = requireString(request.data?.offerId, "offerId");
  const participantId = requireString(request.data?.participantId, "participantId");
  const voucher = verifyBadgeVoucher(
    requireString(request.data?.badgeVoucher, "badgeVoucher"),
    diversificationMasterKey.value()
  );
  if (!voucher) throw new HttpsError("invalid-argument", "Bitte Badge erneut auflegen.");
  const loaded = await load(leader, offerId);
  requireOpen(loaded);
  const link = linkedTarget(loaded, leader, participantId);
  const tokenRef = leader.db.collection("tokens").doc(voucher.tokenId);
  await leader.db.runTransaction(async (tx) => {
    if ((await tx.get(tokenRef)).exists) {
      throw new HttpsError("already-exists", "Dieser Badge ist schon registriert.");
    }
    tx.create(tokenRef, {
      userId: link.user,
      registered: Timestamp.now(),
      label: `Badge (Kurs ${loaded.detail.title})`,
      // Seed the replay defense with the assigning tap's counter.
      lastSdmCounter: voucher.sdmCounter,
    });
  });
  logger.info("courseCall: badge assigned", { offerId, participantId, userId: link.user.id });
  return { tokenId: voucher.tokenId };
};

/** CRS-10/11: Nein / Vorläufig / Ja, saved at once; Nein ends the temporary permission. */
export const setParticipantChoiceHandler = async (
  request: CallableRequest<SetParticipantChoiceInput>
): Promise<{ ok: true }> => {
  const leader = await requireLeader(request);
  const offerId = requireString(request.data?.offerId, "offerId");
  const participantId = requireString(request.data?.participantId, "participantId");
  const choice = request.data?.choice as CourseChoice;
  if (!CHOICES.includes(choice)) throw new HttpsError("invalid-argument", "invalid choice");
  const loaded = await load(leader, offerId);
  requireOpen(loaded);
  const link = linkedTarget(loaded, leader, participantId);
  const permission = loaded.course.permission ?? null;
  const db = leader.db;
  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(link.user);
    tx.update(db.collection("courseLinks").doc(courseLinkId(offerId, participantId)), { choice });
    if (!permission) return;
    const map =
      choice === "no"
        ? withoutTemporaryGrant(userSnap.get("permissions"), permission.id, offerId)
        : withTemporaryGrant(userSnap.get("permissions"), {
            permission,
            offerId,
            dates: loaded.dates,
            grantedBy: leader.userRef,
            now: Timestamp.now(),
          });
    if (map) tx.update(link.user, { permissions: map });
  });
  return { ok: true };
};

/**
 * CRS-12..14: from the last Termin's start. Ja grants for good, Nein ends
 * this course's temporary permission; a Nein's reason goes to edoobox as a
 * note afterwards — a note that fails leaves the close in place.
 */
export const closeCourseHandler = async (request: CallableRequest<CloseCourseInput>): Promise<CloseCourseResult> => {
  const leader = await requireLeader(request);
  const offerId = requireString(request.data?.offerId, "offerId");
  const choices = (request.data?.choices ?? {}) as Record<string, unknown>;
  const reasons = (request.data?.reasons ?? {}) as Record<string, unknown>;
  const loaded = await load(leader, offerId);
  requireOpen(loaded);
  if (coursePhase(loaded.dates, Date.now()) !== "toClose") {
    throw new HttpsError("failed-precondition", "Der Kurs lässt sich erst ab dem letzten Termin abschliessen.");
  }
  const permission = loaded.course.permission ?? null;
  const db = leader.db;
  const now = Timestamp.now();
  const decided: Record<string, boolean> = {};
  for (const p of loaded.detail.participants) {
    const isSelf = p.link?.userId === leader.userRef.id;
    decided[p.participantId] = !!p.link && !isSelf && choices[p.participantId] === true;
  }

  let granted = 0;
  await db.runTransaction(async (tx) => {
    const courseRef = db.collection("courses").doc(offerId);
    if ((await tx.get(courseRef)).get("closedAt")) {
      throw new HttpsError("failed-precondition", "Der Kurs ist schon abgeschlossen.");
    }
    const linked = loaded.detail.participants.filter((p) => p.link);
    const userSnaps = linked.length ? await tx.getAll(...linked.map((p) => db.collection("users").doc(p.link!.userId))) : [];
    if (permission) {
      linked.forEach((p, i) => {
        const stored = userSnaps[i].get("permissions");
        const map = decided[p.participantId]
          ? withPermanentGrant(stored, { permission, offerId, grantedBy: leader.userRef, now })
          : withoutTemporaryGrant(stored, permission.id, offerId);
        if (decided[p.participantId]) granted++;
        if (map) tx.update(userSnaps[i].ref, { permissions: map });
      });
    }
    tx.set(
      courseRef,
      { closedAt: now, closedBy: leader.userRef, closeChoices: decided, title: loaded.detail.title },
      { merge: true }
    );
  });

  let notesFailed = 0;
  const api = edooboxApi();
  const subject = permission
    ? `Kurs abgeschlossen: keine Berechtigung «${loaded.detail.permission?.name ?? permission.id}»`
    : "Kurs abgeschlossen";
  for (const p of loaded.detail.participants) {
    const reason = typeof reasons[p.participantId] === "string" ? String(reasons[p.participantId]).trim() : "";
    if (decided[p.participantId] || !reason) continue;
    try {
      await api.createNote({
        subject,
        message: reason.slice(0, 1000),
        bookingId: p.bookingId,
        offerId,
        userId: p.edooboxUserId,
      });
    } catch (err) {
      notesFailed++;
      logger.warn("courseCall: close note not written", { offerId, participantId: p.participantId, err: String(err) });
    }
  }
  logger.info("courseCall: course closed", { offerId, granted, notesFailed });
  return { granted, notesFailed };
};
