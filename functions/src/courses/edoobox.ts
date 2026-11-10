// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * edoobox API v2 client (#842). Reference: the Postman collection behind
 * https://api.docs.edoobox.com/; findings from the sandbox spike are in
 * docs/plans/edoobox-courses.md.
 *
 * - Auth: `POST {base}/auth` with key + secret → top-level `access_token`
 *   and `data.edid` (the account); then `edid`, `grant-type: access_token`
 *   and `Authorization: Bearer` on every call.
 * - Write bodies are wrapped in `{ data: {…} }`; list calls take
 *   `filter=[{property, value}]`, `limit={start, reply}`, `fields=[…]`.
 *
 * Staging points at the sandbox (`EDOOBOX_API_BASE_URL`), production at the
 * real account; tests swap the whole API with `setEdooboxApiForTest`.
 */

import * as logger from "firebase-functions/logger";
import { defineSecret, defineString } from "firebase-functions/params";
import type { AttendanceStatus } from "@oww/shared";
import { EMULATOR_FAKE_BASE, firestoreFakeEdoobox } from "./edoobox_fake";

export const edooboxApiKey = defineSecret("EDOOBOX_API_KEY");
export const edooboxApiSecret = defineSecret("EDOOBOX_API_SECRET");
/** e.g. https://sandbox.app.edoobox.ch/v2 (staging) — empty switches the courses off. */
const edooboxBaseUrl = defineString("EDOOBOX_API_BASE_URL", { default: "" });
/** Präsenzstatus the course page offers, in menu order (CRS-4). */
const edooboxAttendanceStatuses = defineString("EDOOBOX_ATTENDANCE_STATUSES", {
  default: "1,2,3,4",
});

export const EDOOBOX_SECRETS = [edooboxApiKey, edooboxApiSecret];

export function isEdooboxConfigured(): boolean {
  return edooboxBaseUrl.value().trim() !== "";
}

/** The configured status numbers; unparsable entries are dropped. */
export function offeredStatusNumbers(): number[] {
  // An empty value (unset in the ops config) means the default too.
  return (edooboxAttendanceStatuses.value().trim() || "1,2,3,4")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export interface EdooboxDate {
  id: string;
  offerId: string;
  /** ISO */
  start: string;
  /** ISO */
  end: string;
  /** edoobox admin ids leading this Termin. */
  leaders: string[];
}

export interface EdooboxOffer {
  id: string;
  name: string;
  /** Tag names (the public workshop filter: «Holz», «Makerspace», …). */
  tags: string[];
}

export interface EdooboxParticipant {
  participantId: string;
  userId: string;
}

export interface EdooboxAttendance {
  attendanceId: string;
  participantId: string;
  dateId: string;
  status: number;
}

export interface EdooboxUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface EdooboxBooking {
  bookingId: string;
  offerId: string;
  /** edoobox user id of the booking's owner. */
  ownerId: string;
  /** Every person the booking covers (a booking can name several). */
  userIds: string[];
  cancelled: boolean;
  waitingList: boolean;
}

export interface EdooboxAdmin {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
}

export interface EdooboxNote {
  subject: string;
  message: string;
  bookingId: string | null;
  offerId: string;
  userId: string;
}

/** What the course feature needs from edoobox. */
export interface EdooboxApi {
  listLeaderDates(adminId: string): Promise<EdooboxDate[]>;
  listOfferDates(offerId: string): Promise<EdooboxDate[]>;
  getOffers(offerIds: string[]): Promise<EdooboxOffer[]>;
  /** Whether the offer still exists in edoobox (deleted, or auto-deleted after its retention). */
  offerExists(offerId: string): Promise<boolean>;
  /** Participants and recorded attendance of one offer, over all its dates. */
  attendanceTable(offerId: string, dateIds: string[]): Promise<{
    participants: EdooboxParticipant[];
    attendances: EdooboxAttendance[];
  }>;
  getUsers(userIds: string[]): Promise<EdooboxUser[]>;
  listBookings(offerId: string): Promise<EdooboxBooking[]>;
  createAttendance(input: { dateId: string; participantId: string; status: number }): Promise<string>;
  updateAttendance(attendanceId: string, status: number): Promise<void>;
  attendanceStatuses(): Promise<AttendanceStatus[]>;
  listAdmins(): Promise<EdooboxAdmin[]>;
  createNote(note: EdooboxNote): Promise<void>;
}

let testApi: EdooboxApi | null = null;

/** Replaces the HTTP client in tests; null restores it. */
export function setEdooboxApiForTest(api: EdooboxApi | null): void {
  testApi = api;
}

import { EdooboxError } from "./edoobox_error";
export { EdooboxError };

export function edooboxApi(): EdooboxApi {
  if (testApi) return testApi;
  const base = edooboxBaseUrl.value().trim().replace(/\/+$/, "");
  if (!base) throw new EdooboxError("edoobox is not configured");
  if (base === EMULATOR_FAKE_BASE) {
    // Only ever in the emulator: e2e tests seed edoobox into Firestore.
    if (process.env.FUNCTIONS_EMULATOR !== "true") throw new EdooboxError("edoobox fake outside the emulator");
    return firestoreFakeEdoobox();
  }
  if (!httpApi || httpApi.base !== base) {
    httpApi = { base, api: new HttpEdooboxApi(base, edooboxApiKey.value(), edooboxApiSecret.value()) };
  }
  return httpApi.api;
}

let httpApi: { base: string; api: EdooboxApi } | null = null;

type Json = Record<string, any>;

/** edoobox lists come keyed by id (`{ id: {…} }`) or as an array (empty). */
function rows(data: unknown): Json[] {
  if (Array.isArray(data)) return data as Json[];
  if (data && typeof data === "object") return Object.values(data as Json);
  return [];
}

const PAGE = 500;
/** A hanging edoobox must end in «nicht erreichbar», not the callable's deadline. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Offers and users change rarely; a course page reads them on every click. */
const CACHE_MS = 5 * 60_000;

class HttpEdooboxApi implements EdooboxApi {
  private session: { token: string; edid: string; until: number } | null = null;
  private loggingIn: Promise<{ token: string; edid: string }> | null = null;
  private userCache = new Map<string, { at: number; user: EdooboxUser }>();
  private offerCache: { at: number; offers: Json[] } | null = null;
  private statusCache: { at: number; statuses: AttendanceStatus[] } | null = null;
  private tagCache: { at: number; names: Map<string, string> } | null = null;

  constructor(
    private readonly base: string,
    private readonly key: string,
    private readonly secret: string
  ) {}

  private async login(): Promise<{ token: string; edid: string }> {
    if (this.session && this.session.until > Date.now()) return this.session;
    // Parallel calls on a cold instance share one login.
    this.loggingIn ??= this.doLogin().finally(() => {
      this.loggingIn = null;
    });
    return this.loggingIn;
  }

  private async doLogin(): Promise<{ token: string; edid: string }> {
    const res = await fetch(`${this.base}/auth`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      method: "POST",
      headers: { "grant-type": "password", "Content-Type": "application/json" },
      body: JSON.stringify({ key: this.key, secret: this.secret }),
    });
    const body = (await res.json().catch(() => ({}))) as Json;
    const token = body?.access_token;
    const edid = body?.data?.edid;
    if (!res.ok || typeof token !== "string" || typeof edid !== "string") {
      throw new EdooboxError("edoobox login failed", res.status, body?.error);
    }
    // The token outlives what we keep; re-login hourly regardless.
    this.session = { token, edid, until: Date.now() + 50 * 60_000 };
    return this.session;
  }

  private async call(method: string, path: string, query?: Json, data?: Json): Promise<Json> {
    const { token, edid } = await this.login();
    const qs = query
      ? "?" +
        Object.entries(query)
          .map(([k, v]) => `${k}=${encodeURIComponent(typeof v === "string" ? v : JSON.stringify(v))}`)
          .join("&")
      : "";
    const res = await fetch(`${this.base}${path}${qs}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      method,
      headers: {
        edid,
        "grant-type": "access_token",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: data ? JSON.stringify({ data }) : undefined,
    });
    const body = (await res.json().catch(() => ({}))) as Json;
    if (res.status === 401) this.session = null;
    if (!res.ok || body?.success === false) {
      throw new EdooboxError(`edoobox ${method} ${path} failed`, res.status, body?.error);
    }
    return body;
  }

  /** All rows of a list endpoint, page by page. */
  private async list(path: string, filter?: Json[], fields?: string[]): Promise<Json[]> {
    const out: Json[] = [];
    for (let start = 0; ; start += PAGE) {
      const query: Json = { limit: { start, reply: PAGE } };
      if (filter) query.filter = filter;
      if (fields) query.fields = fields;
      const body = await this.call("GET", path, query);
      const page = rows(body.data);
      out.push(...page);
      // Without a total, only a short page ends the list.
      const total = body?.limit?.total;
      if (page.length < PAGE || (total !== undefined && out.length >= Number(total))) return out;
    }
  }

  private toDate(d: Json): EdooboxDate {
    return {
      id: d.id,
      offerId: d.offer,
      start: d.date_start,
      end: d.date_end,
      leaders: Array.isArray(d.leader) ? d.leader : [],
    };
  }

  async listLeaderDates(adminId: string): Promise<EdooboxDate[]> {
    // `admin` filters by leader; a plain `?admin=` query is ignored.
    const dates = await this.list("/date/list", [{ property: "admin", value: adminId }]);
    return dates.map((d) => this.toDate(d));
  }

  async listOfferDates(offerId: string): Promise<EdooboxDate[]> {
    const dates = await this.list("/date/list", [{ property: "offer", value: offerId }]);
    return dates.map((d) => this.toDate(d));
  }

  private async tagNames(): Promise<Map<string, string>> {
    if (this.tagCache && Date.now() - this.tagCache.at < 3600_000) return this.tagCache.names;
    const tags = await this.list("/tag/list");
    const names = new Map(tags.map((t) => [String(t.id), String(t.name ?? "")]));
    this.tagCache = { at: Date.now(), names };
    return names;
  }

  /** Every offer's id, name and tags; one list call per few minutes. */
  private async offerList(): Promise<Json[]> {
    if (this.offerCache && Date.now() - this.offerCache.at < CACHE_MS) return this.offerCache.offers;
    const offers = await this.list("/offer/list", undefined, ["id", "name", "tags"]);
    this.offerCache = { at: Date.now(), offers };
    return offers;
  }

  async getOffers(offerIds: string[]): Promise<EdooboxOffer[]> {
    if (offerIds.length === 0) return [];
    const wanted = new Set(offerIds);
    const [offers, tagNames] = await Promise.all([
      this.offerList(),
      this.tagNames().catch((err) => {
        logger.warn("edoobox tags unreadable", { err: String(err) });
        return new Map<string, string>();
      }),
    ]);
    return offers
      .filter((o) => wanted.has(o.id))
      .map((o) => ({
        id: o.id,
        name: String(o.name ?? ""),
        tags: (Array.isArray(o.tags) ? o.tags : []).map((t: unknown) =>
          typeof t === "string" ? tagNames.get(t) ?? t : String((t as Json)?.name ?? "")
        ),
      }));
  }

  async offerExists(offerId: string): Promise<boolean> {
    // A deleted offer answers 200 with empty data, not 404 (sandbox, 2026-11).
    const body = await this.call("GET", `/offer/${encodeURIComponent(offerId)}`);
    return rows(body.data).length > 0;
  }

  async attendanceTable(offerId: string, dateIds: string[]) {
    const participants = new Map<string, EdooboxParticipant>();
    const attendances: EdooboxAttendance[] = [];
    for (const dateId of dateIds) {
      const body = await this.call("GET", "/attendance/list/table", {
        filter: [
          { property: "offer", value: offerId },
          { property: "date", value: dateId },
        ],
      });
      // Its first_name/last_name are swapped; names come from getUsers.
      for (const p of rows(body.data?.participants)) {
        participants.set(p.id, { participantId: p.id, userId: p.user });
      }
      for (const a of rows(body.data?.attendances)) {
        attendances.push({
          attendanceId: a.id,
          participantId: a.participant,
          dateId: a.date,
          status: Number(a.type ?? 0),
        });
      }
    }
    return { participants: [...participants.values()], attendances };
  }

  async getUsers(userIds: string[]): Promise<EdooboxUser[]> {
    const users = await Promise.all(
      [...new Set(userIds)].map(async (id) => {
        const hit = this.userCache.get(id);
        if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;
        const body = await this.call("GET", `/user/${id}`);
        // Keyed by id (`{ data: { user_…: {…} } }`, as the sandbox returns
        // it), or flat when edoobox answers a single record directly.
        const data = body.data as Json;
        const u: Json = data && (data.first_name !== undefined || data.email !== undefined) ? data : (data?.[id] ?? rows(data)[0]);
        const user = {
          id,
          firstName: String(u?.first_name ?? ""),
          lastName: String(u?.last_name ?? ""),
          email: String(u?.email ?? ""),
        };
        this.userCache.set(id, { at: Date.now(), user });
        return user;
      })
    );
    return users;
  }

  async listBookings(offerId: string): Promise<EdooboxBooking[]> {
    const bookings = await this.list("/booking/list", [{ property: "offer", value: offerId }]);
    return bookings.map((b) => ({
      bookingId: b.id,
      offerId: b.offer ?? offerId,
      ownerId: String(b.owner ?? ""),
      userIds: (Array.isArray(b.users) ? b.users : []).map((u: Json) => String(u?.user ?? "")),
      cancelled: b.canceled === true,
      waitingList: b.waiting_list === true,
    }));
  }

  async createAttendance(input: { dateId: string; participantId: string; status: number }) {
    const body = await this.call("POST", "/attendance", undefined, {
      date: input.dateId,
      participant: input.participantId,
      type: input.status,
    });
    return String(body?.data?.id ?? "");
  }

  async updateAttendance(attendanceId: string, status: number) {
    await this.call("PUT", `/attendance/${attendanceId}`, undefined, { type: status });
  }

  async attendanceStatuses(): Promise<AttendanceStatus[]> {
    if (this.statusCache && Date.now() - this.statusCache.at < 3600_000) {
      return this.statusCache.statuses;
    }
    const body = await this.call("GET", "/settings/list");
    const settings = rows(body.data).find((s) => s?.attendance_config) ?? body.data;
    const config = rows(settings?.attendance_config);
    const statuses = config.map((c) => ({
      status: Number(c.status),
      name: String(c.help ?? LOCKED_NAMES[Number(c.status)] ?? `Status ${Number(c.status) + 1}`),
      symbol: String(c.val ?? ""),
      color: String(c.color ?? "#000000"),
      attendancePct: Number(c.counter ?? 0),
    }));
    this.statusCache = { at: Date.now(), statuses };
    return statuses;
  }

  async listAdmins(): Promise<EdooboxAdmin[]> {
    const admins = await this.list("/admin/list");
    return admins.map((a) => ({
      id: a.id,
      firstName: String(a.first_name ?? ""),
      lastName: String(a.last_name ?? ""),
      email: String(a.email ?? ""),
      active: a.status !== false,
    }));
  }

  async createNote(note: EdooboxNote) {
    const pinned: Json = { offer: [note.offerId], user: [note.userId] };
    if (note.bookingId) pinned.booking = [note.bookingId];
    await this.call("POST", "/note", undefined, {
      subject: note.subject,
      message: note.message,
      todo: false,
      type: 2,
      pinned,
    });
  }
}

/** edoobox gives the three locked statuses no `help` text. */
const LOCKED_NAMES: Record<number, string> = {
  0: "Kein Status",
  1: "Anwesend",
  2: "Frühzeitig gegangen",
};
