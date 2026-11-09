// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

// edoobox courses (#842, docs/spec/courses.md): the courseCall handlers
// against the emulator, with edoobox as an in-memory fake.

import { expect } from "chai";
import { Timestamp } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { heldPermissionIds } from "@oww/shared";
import { setupEmulator, clearFirestore, teardownEmulator, getFirestore } from "../emulator-helper";
import { setEdooboxApiForTest } from "../../src/courses/edoobox";
import { InMemoryEdoobox, emptyFakeState } from "../../src/courses/edoobox_fake";
import {
  assignCourseBadgeHandler,
  closeCourseHandler,
  getCourseHandler,
  linkParticipantHandler,
  listMyCoursesHandler,
  setAttendanceHandler,
  setCoursePermissionTypeHandler,
  setParticipantChoiceHandler,
} from "../../src/courses/handlers";
import { setEdooboxLeaderHandler, unlinkCourseParticipantHandler } from "../../src/courses/admin_handlers";
import { runSyncCourses, setCourseMailerForTest } from "../../src/courses/sync_courses";
import { mintBadgeVoucher } from "../../src/badge/voucher";

const MASTER_KEY = "fedcba9876543210fedcba9876543210";
const LEADER = "leader-1";
const OTHER_LEADER = "leader-2";
const ANNA = "anna-1";
const ADMIN_ID = "admin_A";
const OFFER = "offer_1";
const HOUR = 3600_000;

function req<T>(data: T, uid = LEADER, token: Record<string, unknown> = {}): CallableRequest<T> {
  return { data, auth: { uid, token } } as unknown as CallableRequest<T>;
}
const adminReq = <T>(data: T) => req(data, "the-admin", { admin: true });

async function expectCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
  } catch (err: any) {
    expect(err?.code, err?.message).to.equal(code);
    return;
  }
  expect.fail(`expected ${code}`);
}

let fake: InMemoryEdoobox;

/** d1 has started (yesterday), d2 is tomorrow — the course is running. */
function seedEdoobox(now = Date.now(), d2InPast = false) {
  const iso = (ms: number) => new Date(ms).toISOString();
  const s = emptyFakeState();
  s.admins = [{ id: ADMIN_ID, firstName: "Petra", lastName: "Keller", email: "petra@x.ch", active: true }];
  s.offers = [{ id: OFFER, name: "Einführung Lasercutter", tags: ["Makerspace"] }];
  s.dates = [
    { id: "d1", offerId: OFFER, start: iso(now - 26 * HOUR), end: iso(now - 23 * HOUR), leaders: [ADMIN_ID] },
    {
      id: "d2",
      offerId: OFFER,
      start: iso(d2InPast ? now - 3 * HOUR : now + 22 * HOUR),
      end: iso(d2InPast ? now - 1 * HOUR : now + 25 * HOUR),
      leaders: [ADMIN_ID],
    },
  ];
  s.users = [
    { id: "eu_anna", firstName: "Anna", lastName: "Brunner", email: "anna@x.ch" },
    { id: "eu_luca", firstName: "Luca", lastName: "Meier", email: "luca@x.ch" },
  ];
  s.bookings = [
    { bookingId: "b1", offerId: OFFER, ownerId: "eu_anna", userIds: ["eu_anna"], cancelled: false, waitingList: false },
    { bookingId: "b2", offerId: OFFER, ownerId: "eu_luca", userIds: ["eu_luca"], cancelled: false, waitingList: false },
  ];
  s.participants = [
    { offerId: OFFER, participantId: "p_anna", userId: "eu_anna" },
    { offerId: OFFER, participantId: "p_luca", userId: "eu_luca" },
  ];
  fake = new InMemoryEdoobox(s);
  setEdooboxApiForTest(fake);
}

async function seedUsers() {
  const db = getFirestore();
  const base = { created: Timestamp.now(), roles: [], permissions: {}, userType: "erwachsen" };
  await db.doc(`users/${LEADER}`).set({ ...base, email: "petra@x.ch", firstName: "Petra", lastName: "Keller", edooboxLeaderId: ADMIN_ID });
  await db.doc(`users/${OTHER_LEADER}`).set({ ...base, email: "olga@x.ch", firstName: "Olga", lastName: "O", edooboxLeaderId: "admin_other" });
  await db.doc(`users/${ANNA}`).set({ ...base, email: "anna@x.ch", firstName: "Anna", lastName: "Brunner" });
  await db.doc("permission/laser").set({ name: "Lasercutter" });
}

async function grantsOf(uid: string) {
  return (await getFirestore().doc(`users/${uid}`).get()).get("permissions");
}

const link = (participantId: string, email: string, create = false) =>
  linkParticipantHandler(req({ offerId: OFFER, participantId, email, create }));

describe("courses (#842)", () => {
  before(async function () {
    this.timeout(10000);
    await setupEmulator();
    process.env.EDOOBOX_API_BASE_URL = "test";
    process.env.DIVERSIFICATION_MASTER_KEY = MASTER_KEY;
    process.env.CHECKOUT_DOMAIN = "checkout.test";
  });
  after(async () => {
    setEdooboxApiForTest(null);
    await teardownEmulator();
  });
  beforeEach(async () => {
    await clearFirestore();
    seedEdoobox();
    await seedUsers();
  });

  describe("access (CRS-1, CRS-8)", () => {
    it("refuses an account that isn't a course leader", async () => {
      await expectCode(() => listMyCoursesHandler(req({}, ANNA)), "permission-denied");
    });
    it("refuses a leader who doesn't lead the course", async () => {
      await expectCode(() => getCourseHandler(req({ offerId: OFFER }, OTHER_LEADER)), "permission-denied");
    });
    it("lists the leader's course with its phase and participants (CRS-2)", async () => {
      const { courses } = await listMyCoursesHandler(req({}));
      expect(courses).to.have.length(1);
      expect(courses[0]).to.include({ offerId: OFFER, phase: "running", participantCount: 2, workshop: "makerspace" });
    });
    it("hides a closed course", async () => {
      await getFirestore().doc(`courses/${OFFER}`).set({ closedAt: Timestamp.now() });
      expect((await listMyCoursesHandler(req({}))).courses).to.deep.equal([]);
    });
    it("says edoobox is unreachable", async () => {
      fake.failing = true;
      await expectCode(() => listMyCoursesHandler(req({})), "unavailable");
    });
  });

  describe("permission pick (CRS-17)", () => {
    it("starts unpicked, takes «Keine» or a permission, and is fixed after the first link", async () => {
      let c = await getCourseHandler(req({ offerId: OFFER }));
      expect(c.permissionChosen).to.equal(false);
      c = await setCoursePermissionTypeHandler(req({ offerId: OFFER, permissionId: null }));
      expect(c).to.include({ permissionChosen: true, permission: null });
      c = await setCoursePermissionTypeHandler(req({ offerId: OFFER, permissionId: "laser" }));
      expect(c.permission).to.deep.equal({ id: "laser", name: "Lasercutter" });
      await link("p_anna", "anna@x.ch");
      await expectCode(
        () => setCoursePermissionTypeHandler(req({ offerId: OFFER, permissionId: null })),
        "failed-precondition"
      );
    });
  });

  describe("linking (CRS-6, CRS-7)", () => {
    beforeEach(async () => {
      await setCoursePermissionTypeHandler(req({ offerId: OFFER, permissionId: "laser" }));
    });

    it("links an existing account, Vorläufig, with this course's windows (CRS-10, CRS-11)", async () => {
      await link("p_anna", "anna@x.ch");
      const grant = (await grantsOf(ANNA)).laser;
      expect(grant.source).to.equal("course");
      expect(grant.course).to.deep.equal({ offerId: OFFER });
      expect(grant.windows).to.have.length(2);
      const c = await getCourseHandler(req({ offerId: OFFER }));
      const anna = c.participants.find((p) => p.participantId === "p_anna")!;
      expect(anna.link).to.include({ userId: ANNA, choice: "temp", hasBadge: false, alreadyHeld: false });
      // d1 ended 23 h ago + 1 h tail: not held now; inside d1 it was.
      expect(heldPermissionIds(await grantsOf(ANNA), Date.now())).to.deep.equal([]);
      expect(heldPermissionIds(await grantsOf(ANNA), Date.now() - 25 * HOUR)).to.deep.equal(["laser"]);
    });

    it("creates an account from the edoobox data", async () => {
      const { userId } = await link("p_luca", "luca@x.ch", true);
      const doc = await getFirestore().doc(`users/${userId}`).get();
      expect(doc.data()).to.include({ email: "luca@x.ch", firstName: "Luca", lastName: "Meier" });
      expect(Object.keys(doc.get("permissions"))).to.deep.equal(["laser"]);
    });

    it("refuses a second link and one account for two participants", async () => {
      await link("p_anna", "anna@x.ch");
      await expectCode(() => link("p_anna", "anna@x.ch"), "already-exists");
      await expectCode(() => link("p_luca", "anna@x.ch"), "already-exists");
    });

    it("refuses linking to a missing account, and creating one that exists", async () => {
      await expectCode(() => link("p_luca", "nobody@x.ch"), "not-found");
      await expectCode(() => link("p_anna", "anna@x.ch", true), "already-exists");
    });

    it("refuses linking before the permission is picked (CRS-17)", async () => {
      await getFirestore().doc(`courses/${OFFER}`).delete();
      await expectCode(() => link("p_anna", "anna@x.ch"), "failed-precondition");
    });

    it("refuses a participant of another course", async () => {
      await expectCode(() => link("p_nobody", "anna@x.ch"), "not-found");
    });

    it("marks someone who holds the permission for good, and adds nothing", async () => {
      await getFirestore().doc(`users/${ANNA}`).update({
        "permissions.laser": { permission: getFirestore().doc("permission/laser"), grantedAt: null, grantedBy: null, source: "admin" },
      });
      await link("p_anna", "anna@x.ch");
      expect((await grantsOf(ANNA)).laser.source).to.equal("admin");
      const c = await getCourseHandler(req({ offerId: OFFER }));
      expect(c.participants.find((p) => p.participantId === "p_anna")!.link!.alreadyHeld).to.equal(true);
    });

    it("never gives the leader a permission through their own course (CRS-8)", async () => {
      fake.state.users.push({ id: "eu_petra", firstName: "Petra", lastName: "Keller", email: "petra@x.ch" });
      fake.state.participants.push({ offerId: OFFER, participantId: "p_petra", userId: "eu_petra" });
      fake.state.bookings.push({ bookingId: "b3", offerId: OFFER, ownerId: "eu_petra", userIds: ["eu_petra"], cancelled: false, waitingList: false });
      await link("p_petra", "petra@x.ch");
      expect(await grantsOf(LEADER)).to.deep.equal({});
      await expectCode(
        () => setParticipantChoiceHandler(req({ offerId: OFFER, participantId: "p_petra", choice: "yes" })),
        "permission-denied"
      );
    });
  });

  describe("choice (CRS-10, CRS-11)", () => {
    beforeEach(async () => {
      await setCoursePermissionTypeHandler(req({ offerId: OFFER, permissionId: "laser" }));
      await link("p_anna", "anna@x.ch");
    });
    it("Nein ends the temporary permission, Ja brings it back", async () => {
      await setParticipantChoiceHandler(req({ offerId: OFFER, participantId: "p_anna", choice: "no" }));
      expect(await grantsOf(ANNA)).to.deep.equal({});
      await setParticipantChoiceHandler(req({ offerId: OFFER, participantId: "p_anna", choice: "yes" }));
      expect((await grantsOf(ANNA)).laser.windows).to.have.length(2);
    });
    it("Nein leaves an admin's grant alone", async () => {
      await getFirestore().doc(`users/${ANNA}`).update({
        "permissions.laser": { permission: getFirestore().doc("permission/laser"), grantedAt: null, grantedBy: null, source: "admin" },
      });
      await setParticipantChoiceHandler(req({ offerId: OFFER, participantId: "p_anna", choice: "no" }));
      expect((await grantsOf(ANNA)).laser.source).to.equal("admin");
    });
  });

  describe("attendance (CRS-4)", () => {
    it("writes a status on offer for a started Termin, changes and clears it", async () => {
      await setAttendanceHandler(req({ offerId: OFFER, participantId: "p_anna", dateId: "d1", status: 1 }));
      expect(fake.state.attendances).to.deep.include({ attendanceId: "attendance_fake_1", dateId: "d1", participantId: "p_anna", status: 1 });
      await setAttendanceHandler(req({ offerId: OFFER, participantId: "p_anna", dateId: "d1", status: 3 }));
      await setAttendanceHandler(req({ offerId: OFFER, participantId: "p_anna", dateId: "d1", status: 0 }));
      expect(fake.state.attendances).to.have.length(1);
      expect(fake.state.attendances[0].status).to.equal(0);
      const c = await getCourseHandler(req({ offerId: OFFER }));
      expect(c.offeredStatuses.map((s) => s.status)).to.deep.equal([1, 2, 3, 4]);
    });
    it("refuses a Termin that hasn't started, and a status not on offer", async () => {
      await expectCode(
        () => setAttendanceHandler(req({ offerId: OFFER, participantId: "p_anna", dateId: "d2", status: 1 })),
        "failed-precondition"
      );
      await expectCode(
        () => setAttendanceHandler(req({ offerId: OFFER, participantId: "p_anna", dateId: "d1", status: 7 })),
        "invalid-argument"
      );
    });
  });

  describe("badge (CRS-9)", () => {
    beforeEach(async () => {
      await setCoursePermissionTypeHandler(req({ offerId: OFFER, permissionId: null }));
      await link("p_anna", "anna@x.ch");
    });
    it("registers a tapped, unregistered badge to the linked account; refuses a registered one", async () => {
      const voucher = mintBadgeVoucher({ tokenId: "04aaaaaaaaaaaa", sdmCounter: 3 }, MASTER_KEY);
      await assignCourseBadgeHandler(req({ offerId: OFFER, participantId: "p_anna", badgeVoucher: voucher }));
      const token = await getFirestore().doc("tokens/04aaaaaaaaaaaa").get();
      expect(token.get("userId").id).to.equal(ANNA);
      expect(token.get("lastSdmCounter")).to.equal(3);
      await expectCode(
        () => assignCourseBadgeHandler(req({ offerId: OFFER, participantId: "p_anna", badgeVoucher: voucher })),
        "already-exists"
      );
    });
    it("refuses a forged voucher and an unlinked participant", async () => {
      await expectCode(
        () => assignCourseBadgeHandler(req({ offerId: OFFER, participantId: "p_anna", badgeVoucher: "04aaaaaaaaaaaa.3.9999999999999.x" })),
        "invalid-argument"
      );
      const voucher = mintBadgeVoucher({ tokenId: "04bbbbbbbbbbbb", sdmCounter: 1 }, MASTER_KEY);
      await expectCode(
        () => assignCourseBadgeHandler(req({ offerId: OFFER, participantId: "p_luca", badgeVoucher: voucher })),
        "failed-precondition"
      );
    });
  });

  describe("close (CRS-12..15)", () => {
    it("can't close before the last Termin has started", async () => {
      await setCoursePermissionTypeHandler(req({ offerId: OFFER, permissionId: "laser" }));
      await expectCode(() => closeCourseHandler(req({ offerId: OFFER, choices: {}, reasons: {} })), "failed-precondition");
    });

    it("grants Ja for good, ends Nein's temporary permission, notes the reason, then refuses changes", async () => {
      seedEdoobox(Date.now(), true);
      // A fresh address: the Auth emulator keeps accounts across tests.
      fake.state.users[1].email = "luca.close@x.ch";
      await setCoursePermissionTypeHandler(req({ offerId: OFFER, permissionId: "laser" }));
      await link("p_anna", "anna@x.ch");
      const { userId: luca } = await link("p_luca", "luca.close@x.ch", true);
      const result = await closeCourseHandler(
        req({ offerId: OFFER, choices: { p_anna: true, p_luca: false }, reasons: { p_luca: "Nicht teilgenommen" } })
      );
      expect(result).to.deep.equal({ granted: 1, notesFailed: 0 });
      const anna = (await grantsOf(ANNA)).laser;
      expect(anna.source).to.equal("course");
      expect(anna.windows).to.equal(undefined);
      expect(await grantsOf(luca)).to.deep.equal({});
      expect(fake.state.notes).to.have.length(1);
      expect(fake.state.notes[0]).to.include({ message: "Nicht teilgenommen", bookingId: "b2", userId: "eu_luca", offerId: OFFER });
      expect((await getCourseHandler(req({ offerId: OFFER }))).closedAt).to.be.a("string");
      await expectCode(
        () => setAttendanceHandler(req({ offerId: OFFER, participantId: "p_anna", dateId: "d1", status: 1 })),
        "failed-precondition"
      );
      await expectCode(() => closeCourseHandler(req({ offerId: OFFER, choices: {}, reasons: {} })), "failed-precondition");
    });

    it("keeps the close when edoobox refuses a note", async () => {
      seedEdoobox(Date.now(), true);
      await setCoursePermissionTypeHandler(req({ offerId: OFFER, permissionId: null }));
      fake.createNote = async () => {
        throw new Error("down");
      };
      const result = await closeCourseHandler(req({ offerId: OFFER, choices: {}, reasons: { p_luca: "Kein Konto" } }));
      expect(result.notesFailed).to.equal(1);
      expect((await getFirestore().doc(`courses/${OFFER}`).get()).get("closedAt")).to.be.instanceOf(Timestamp);
    });
  });

  describe("admin (ADM-17, ADM-18)", () => {
    it("links a leader to one person only", async () => {
      await setEdooboxLeaderHandler(adminReq({ userId: ANNA, adminId: "admin_new" }));
      expect((await getFirestore().doc(`users/${ANNA}`).get()).get("edooboxLeaderId")).to.equal("admin_new");
      await expectCode(() => setEdooboxLeaderHandler(adminReq({ userId: LEADER, adminId: "admin_new" })), "already-exists");
      await setEdooboxLeaderHandler(adminReq({ userId: ANNA, adminId: null }));
      expect((await getFirestore().doc(`users/${ANNA}`).get()).get("edooboxLeaderId")).to.equal(undefined);
      await expectCode(() => setEdooboxLeaderHandler(req({ userId: ANNA, adminId: "x" })), "permission-denied");
    });
    it("unlinks a participant and drops that course's temporary permission", async () => {
      await setCoursePermissionTypeHandler(req({ offerId: OFFER, permissionId: "laser" }));
      await link("p_anna", "anna@x.ch");
      await unlinkCourseParticipantHandler(adminReq({ offerId: OFFER, participantId: "p_anna" }));
      expect(await grantsOf(ANNA)).to.deep.equal({});
      expect((await getFirestore().doc(`courseLinks/${OFFER}_p_anna`).get()).exists).to.equal(false);
    });
  });

  describe("daily sync (CRS-11, CRS-16)", () => {
    it("drops the temporary permission of a cancelled booking", async () => {
      await setCoursePermissionTypeHandler(req({ offerId: OFFER, permissionId: "laser" }));
      await link("p_anna", "anna@x.ch");
      fake.state.bookings[0].cancelled = true;
      const report = await runSyncCourses();
      expect(report.grantsChanged).to.equal(1);
      expect(await grantsOf(ANNA)).to.deep.equal({});
    });
    it("reminds the leader on days 1, 3 and 7, the office on day 7, each once (CRS-16)", async () => {
      process.env.COURSE_OFFICE_EMAIL = "office@x.ch";
      const sent: Array<{ to: string; mail: string; dims: unknown; variables: Record<string, string> }> = [];
      setCourseMailerForTest((async (m: any) => {
        sent.push(m);
      }) as any);
      try {
        const now = Date.now();
        // Last Termin 7 days ago: day 7 is due; days 1 and 3 were missed, not sent late.
        fake.state.dates[1].start = new Date(now - 7 * 24 * HOUR).toISOString();
        fake.state.dates[1].end = new Date(now - 7 * 24 * HOUR + 3 * HOUR).toISOString();
        fake.state.dates[0].start = new Date(now - 14 * 24 * HOUR).toISOString();
        await runSyncCourses(now);
        expect(sent.map((m) => [m.to, m.mail])).to.deep.equal([
          ["petra@x.ch", "course-close-reminder"],
          ["office@x.ch", "course-close-office"],
        ]);
        expect(sent[0].dims).to.deep.equal({});
        expect(sent[0].variables.COURSE_LINK).to.equal(`https://checkout.test/account/courses/${OFFER}`);
        await runSyncCourses(now);
        expect(sent).to.have.length(2);
        // A second leader of the same course gets their own reminder.
        await getFirestore().doc(`users/${OTHER_LEADER}`).update({ edooboxLeaderId: "admin_B" });
        fake.state.dates[1].leaders.push("admin_B");
        await runSyncCourses(now);
        expect(sent.map((m) => m.to)).to.deep.equal(["petra@x.ch", "office@x.ch", "olga@x.ch"]);
        await getFirestore().doc(`courses/${OFFER}`).set({ closedAt: Timestamp.now(), remindersSent: [] }, { merge: true });
        await runSyncCourses(now);
        expect(sent).to.have.length(3);
      } finally {
        setCourseMailerForTest(undefined);
        delete process.env.COURSE_OFFICE_EMAIL;
      }
    });

    it("keeps an admin's removal of a temporary permission (no re-add)", async () => {
      await setCoursePermissionTypeHandler(req({ offerId: OFFER, permissionId: "laser" }));
      await link("p_anna", "anna@x.ch");
      await getFirestore().doc(`users/${ANNA}`).update({ permissions: {} });
      await runSyncCourses();
      expect(await grantsOf(ANNA)).to.deep.equal({});
    });

    it("refuses closing a course whose permission isn't picked", async () => {
      seedEdoobox(Date.now(), true);
      await expectCode(() => closeCourseHandler(req({ offerId: OFFER, choices: {}, reasons: {} })), "failed-precondition");
    });

    it("moves the windows with a Termin moved in edoobox", async () => {
      await setCoursePermissionTypeHandler(req({ offerId: OFFER, permissionId: "laser" }));
      await link("p_anna", "anna@x.ch");
      const moved = Date.now() + 48 * HOUR;
      fake.state.dates[1].start = new Date(moved).toISOString();
      fake.state.dates[1].end = new Date(moved + 3 * HOUR).toISOString();
      await runSyncCourses();
      const windows = (await grantsOf(ANNA)).laser.windows;
      expect(windows[1].from.toMillis()).to.equal(moved);
    });
  });
});
