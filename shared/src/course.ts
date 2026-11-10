// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * edoobox courses (#842, docs/spec/courses.md): the wire types of the
 * `courseCall` dispatcher and the course rules both the server and the
 * checkout apply — attendance from edoobox's Präsenzstatus, the course
 * phase, the close presets and reasons, the temporary permission windows.
 *
 * Times on the wire are ISO strings; the server keeps Timestamps.
 */

import type { WorkshopId } from "./workshop"

/** A Präsenzstatus as the edoobox account defines it (`attendance_config`). */
export interface AttendanceStatus {
  /** edoobox's number; 0 is "Kein Status" (nothing recorded). */
  status: number
  name: string
  symbol: string
  /** `#rrggbb` */
  color: string
  /** edoobox's "Anwesenheit" in percent: above 0 counts as attended. */
  attendancePct: number
}

export const NO_ATTENDANCE_STATUS = 0

/** How a status counts (CRS-12): attended above 0 %, missed at 0 %, none without a status. */
export type AttendanceCount = "attended" | "missed" | "none"

export function attendanceCount(
  status: number | undefined,
  statuses: ReadonlyMap<number, AttendanceStatus>,
): AttendanceCount {
  if (status === undefined || status === NO_ATTENDANCE_STATUS) return "none"
  const def = statuses.get(status)
  // An unknown number (deleted in edoobox) can't be judged; count it as
  // recorded but not attended, like edoobox's 0 % default.
  return def && def.attendancePct > 0 ? "attended" : "missed"
}

export interface CourseDate {
  dateId: string
  /** ISO */
  start: string
  /** ISO */
  end: string
}

/** Upcoming: before the first Termin; running: from its start; toClose: from the last Termin's start (CRS-12). */
export type CoursePhase = "upcoming" | "running" | "toClose"

export function coursePhase(dates: readonly CourseDate[], nowMs: number): CoursePhase {
  const starts = dates.map((d) => Date.parse(d.start)).sort((a, b) => a - b)
  if (starts.length === 0 || nowMs < starts[0]) return "upcoming"
  return nowMs >= starts[starts.length - 1] ? "toClose" : "running"
}

/** A Termin can be recorded once it has started (CRS-4). */
export function dateHasStarted(date: CourseDate, nowMs: number): boolean {
  return Date.parse(date.start) <= nowMs
}

/** The temporary permission's windows: each Termin's start until 1 h after its end (CRS-11). */
export const COURSE_WINDOW_TAIL_MS = 60 * 60 * 1000

export function courseWindows(dates: readonly CourseDate[]): Array<{ fromMs: number; untilMs: number }> {
  return dates
    .map((d) => ({ fromMs: Date.parse(d.start), untilMs: Date.parse(d.end) + COURSE_WINDOW_TAIL_MS }))
    .sort((a, b) => a.fromMs - b.fromMs)
}

/** The course leader's choice per linked participant (CRS-10). */
export type CourseChoice = "no" | "temp" | "yes"

export interface CourseParticipantLink {
  userId: string
  choice: CourseChoice
  /** The linked account has an active badge. */
  hasBadge: boolean
  /** Holds every permission of the course for good, not from this course ("Schon berechtigt"). */
  alreadyHeld: boolean
}

export interface CourseParticipant {
  participantId: string
  bookingId: string | null
  edooboxUserId: string
  firstName: string
  lastName: string
  /** The edoobox e-mail. */
  email: string
  /** Präsenzstatus per dateId; absent = nothing recorded. */
  attendance: Record<string, number>
  link: CourseParticipantLink | null
  /** Without a link: whether an account with the edoobox e-mail exists. */
  accountExists: boolean
}

export interface CoursePermissionRef {
  id: string
  name: string
}

export interface CourseSummary {
  offerId: string
  title: string
  workshop: WorkshopId | null
  dates: CourseDate[]
  participantCount: number
  phase: CoursePhase
}

export interface CourseDetail extends CourseSummary {
  /** What the course grants, possibly none; empty until picked — see `permissionChosen`. */
  permissions: CoursePermissionRef[]
  /** false until the course leader picked permissions or «Keine» (CRS-17). */
  permissionChosen: boolean
  /** The pick is fixed once a participant is linked. */
  permissionLocked: boolean
  /** Statuses the menu offers, in order (CRS-4). */
  offeredStatuses: AttendanceStatus[]
  /** Every status the account defines, to show what edoobox has. */
  allStatuses: AttendanceStatus[]
  participants: CourseParticipant[]
  /** ISO; set once closed (CRS-15). */
  closedAt: string | null
}

/** CRS-12: where the close choice starts; the leader's own account is always Nein. */
export function closePreset(p: Pick<CourseParticipant, "link">, leaderUserId?: string): boolean {
  if (!p.link) return false
  if (leaderUserId && p.link.userId === leaderUserId) return false
  if (p.link.alreadyHeld) return true
  return p.link.choice !== "no"
}

export interface AttendanceSummary {
  attended: number
  missed: number
}

export function attendanceSummary(
  p: Pick<CourseParticipant, "attendance">,
  dates: readonly CourseDate[],
  statuses: ReadonlyMap<number, AttendanceStatus>,
): AttendanceSummary {
  let attended = 0
  let missed = 0
  for (const d of dates) {
    const c = attendanceCount(p.attendance[d.dateId], statuses)
    if (c === "attended") attended++
    else if (c === "missed") missed++
  }
  return { attended, missed }
}

/** CRS-13: the prefilled reason for a Nein, or "" when none applies. */
export function defaultCloseReason(
  p: Pick<CourseParticipant, "link" | "attendance">,
  dates: readonly CourseDate[],
  statuses: ReadonlyMap<number, AttendanceStatus>,
): string {
  if (!p.link) return "Kein Konto"
  const s = attendanceSummary(p, dates, statuses)
  if (s.attended === 0) return "Nicht teilgenommen"
  if (s.missed > 0) return "Nicht an allen Terminen teilgenommen"
  return ""
}

// ── courseCall payloads ────────────────────────────────────────────────

export interface ListMyCoursesResult {
  courses: CourseSummary[]
}

export interface GetCourseInput {
  offerId: string
}

export interface SetCoursePermissionTypeInput {
  offerId: string
  /** [] = the course grants no permission. */
  permissionIds: string[]
}

export interface SetAttendanceInput {
  offerId: string
  participantId: string
  dateId: string
  /** 0 clears it ("Kein Status"). */
  status: number
}

export interface CheckParticipantEmailInput {
  offerId: string
  participantId: string
  email: string
}

export interface CheckParticipantEmailResult {
  accountExists: boolean
}

export interface LinkParticipantInput {
  offerId: string
  participantId: string
  /** The edoobox e-mail, or the course leader's correction (CRS-6). */
  email: string
  /** true: create an account from the edoobox data; false: link the existing one. */
  create: boolean
}

export interface AssignCourseBadgeInput {
  offerId: string
  participantId: string
  /** The kiosk's purchase voucher from probeTag: proof of the tap. */
  badgeVoucher: string
}

export interface SetParticipantChoiceInput {
  offerId: string
  participantId: string
  choice: CourseChoice
}

export interface CloseCourseInput {
  offerId: string
  /** participantId → Ja (true) / Nein (false); participants without a link are Nein. */
  choices: Record<string, boolean>
  /** participantId → reason for a Nein (CRS-13). */
  reasons: Record<string, string>
}

export interface CloseCourseResult {
  granted: number
  /** Notes edoobox didn't take; the close stands (CRS-13). */
  notesFailed: number
}

export interface EdooboxLeader {
  adminId: string
  name: string
  email: string
  /** uid of the account linked to this leader, if any. */
  linkedUserId: string | null
}

export interface ListEdooboxLeadersResult {
  leaders: EdooboxLeader[]
}

export interface SetEdooboxLeaderInput {
  userId: string
  /** null removes the link. */
  adminId: string | null
}

export interface UnlinkCourseParticipantInput {
  offerId: string
  participantId: string
}

/** «Laser Cutter» · «Laser Cutter» und «Gravur» · «A», «B» und «C». */
export function formatPermissionNames(permissions: ReadonlyArray<Pick<CoursePermissionRef, "name">>): string {
  const names = permissions.map((p) => `«${p.name}»`)
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`
}
