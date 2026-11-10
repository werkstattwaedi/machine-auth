// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * A stand-in for edoobox (#842): `InMemoryEdoobox` for unit tests
 * (`setEdooboxApiForTest`), and the same thing persisted in the Firestore
 * doc `testing_edoobox/state` for the emulator, where the e2e tests seed it
 * (`EDOOBOX_API_BASE_URL=emulator-fake`, emulator only — `edooboxApi()`
 * refuses it anywhere else).
 */

import { getFirestore } from "firebase-admin/firestore";
import { EdooboxError } from "./edoobox_error";
import type { AttendanceStatus } from "@oww/shared";
import type {
  EdooboxAdmin,
  EdooboxApi,
  EdooboxAttendance,
  EdooboxBooking,
  EdooboxDate,
  EdooboxNote,
  EdooboxOffer,
  EdooboxParticipant,
  EdooboxUser,
} from "./edoobox";

export const EMULATOR_FAKE_BASE = "emulator-fake";

export interface FakeEdooboxState {
  admins: EdooboxAdmin[];
  offers: EdooboxOffer[];
  dates: EdooboxDate[];
  users: EdooboxUser[];
  bookings: EdooboxBooking[];
  /** participantId ↔ edoobox user per offer. */
  participants: Array<EdooboxParticipant & { offerId: string }>;
  attendances: EdooboxAttendance[];
  statuses: AttendanceStatus[];
  notes: EdooboxNote[];
}

/** edoobox's defaults, as the sandbox account has them. */
export const DEFAULT_FAKE_STATUSES: AttendanceStatus[] = [
  { status: 0, name: "Kein Status", symbol: "●", color: "#000000", attendancePct: 0 },
  { status: 1, name: "Anwesend", symbol: "✓", color: "#22E312", attendancePct: 100 },
  { status: 2, name: "Frühzeitig gegangen", symbol: "✓>", color: "#84CC16", attendancePct: 90 },
  { status: 3, name: "Entschuldigt", symbol: "❶", color: "#4400FF", attendancePct: 0 },
  { status: 4, name: "Unentschuldigt", symbol: "①", color: "#FF0000", attendancePct: 0 },
];

export function emptyFakeState(): FakeEdooboxState {
  return {
    admins: [],
    offers: [],
    dates: [],
    users: [],
    bookings: [],
    participants: [],
    attendances: [],
    statuses: DEFAULT_FAKE_STATUSES,
    notes: [],
  };
}

export class InMemoryEdoobox implements EdooboxApi {
  /** Set to make every call fail, like edoobox being down. */
  failing = false;

  constructor(public state: FakeEdooboxState = emptyFakeState()) {}

  private check(): void {
    if (this.failing) throw new EdooboxError("edoobox fake: unavailable", 503);
  }

  async listLeaderDates(adminId: string) {
    this.check();
    return this.state.dates.filter((d) => d.leaders.includes(adminId));
  }

  async listOfferDates(offerId: string) {
    this.check();
    return this.state.dates.filter((d) => d.offerId === offerId);
  }

  async getOffers(offerIds: string[]) {
    this.check();
    return this.state.offers.filter((o) => offerIds.includes(o.id));
  }

  async offerExists(offerId: string) {
    this.check();
    return this.state.offers.some((o) => o.id === offerId);
  }

  async attendanceTable(offerId: string, dateIds: string[]) {
    this.check();
    return {
      participants: this.state.participants
        .filter((p) => p.offerId === offerId)
        .map(({ participantId, userId }) => ({ participantId, userId })),
      attendances: this.state.attendances.filter((a) => dateIds.includes(a.dateId)),
    };
  }

  async getUsers(userIds: string[]) {
    this.check();
    return this.state.users.filter((u) => userIds.includes(u.id));
  }

  async listBookings(offerId: string) {
    this.check();
    return this.state.bookings.filter((b) => b.offerId === offerId);
  }

  async createAttendance(input: { dateId: string; participantId: string; status: number }) {
    this.check();
    const attendanceId = `attendance_fake_${this.state.attendances.length + 1}`;
    this.state.attendances.push({ attendanceId, ...input });
    return attendanceId;
  }

  async updateAttendance(attendanceId: string, status: number) {
    this.check();
    const a = this.state.attendances.find((x) => x.attendanceId === attendanceId);
    if (!a) throw new EdooboxError(`edoobox fake: no attendance ${attendanceId}`, 404);
    a.status = status;
  }

  async attendanceStatuses() {
    this.check();
    return this.state.statuses;
  }

  async listAdmins() {
    this.check();
    return this.state.admins;
  }

  async createNote(note: EdooboxNote) {
    this.check();
    this.state.notes.push(note);
  }
}

const STATE_DOC = "testing_edoobox/state";

/** The emulator's edoobox: state in Firestore, written back after every call. */
export function firestoreFakeEdoobox(): EdooboxApi {
  const ref = getFirestore().doc(STATE_DOC);
  const run = async <T>(fn: (api: InMemoryEdoobox) => Promise<T>): Promise<T> => {
    const snap = await ref.get();
    const api = new InMemoryEdoobox({ ...emptyFakeState(), ...((snap.data() as Partial<FakeEdooboxState>) ?? {}) });
    api.failing = snap.get("failing") === true;
    const result = await fn(api);
    await ref.set(api.state, { merge: true });
    return result;
  };
  return {
    listLeaderDates: (a) => run((api) => api.listLeaderDates(a)),
    listOfferDates: (o) => run((api) => api.listOfferDates(o)),
    getOffers: (o) => run((api) => api.getOffers(o)),
    offerExists: (o) => run((api) => api.offerExists(o)),
    attendanceTable: (o, d) => run((api) => api.attendanceTable(o, d)),
    getUsers: (u) => run((api) => api.getUsers(u)),
    listBookings: (o) => run((api) => api.listBookings(o)),
    createAttendance: (i) => run((api) => api.createAttendance(i)),
    updateAttendance: (i, s) => run((api) => api.updateAttendance(i, s)),
    attendanceStatuses: () => run((api) => api.attendanceStatuses()),
    listAdmins: () => run((api) => api.listAdmins()),
    createNote: (n) => run((api) => api.createNote(n)),
  };
}
