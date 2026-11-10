// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * A course (#842): its participants with their Präsenzstatus per Termin
 * (CRS-4) and Zugang (CRS-5), the permission pick (CRS-17) and, from the
 * last Termin's start, «Kurs abschliessen» (CRS-12). Read-only once closed
 * (CRS-15).
 */

import { useRef, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, ChevronRight, Clock, Lock } from "lucide-react"
import { dateHasStarted, formatPermissionNames, type CourseDetail } from "@oww/shared"
import { useAuth } from "@modules/lib/auth"
import { useCollection } from "@modules/lib/firestore"
import { permissionsCollection } from "@modules/lib/firestore-helpers"
import { useDb, useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"
import { useBridge } from "@modules/lib/use-bridge"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { Button } from "@modules/components/ui/button"
import { Skeleton } from "@modules/components/ui/skeleton"
import { Checkbox } from "@modules/components/ui/checkbox"
import { Label } from "@modules/components/ui/label"
import { cn } from "@modules/lib/utils"
import { AttendanceCell } from "@/components/courses/attendance-cell"
import { ZugangStatus, zugangState } from "@/components/courses/zugang-status"
import { EdooboxError } from "@/routes/_authenticated/account/courses/index"
import { COURSE_MESSAGE_CODES, formatCourseDay, formatCourseTime, isToday, useCourse } from "@/lib/courses"

export const Route = createFileRoute("/_authenticated/account/courses/$offerId/")({
  component: CoursePage,
})

function CoursePage() {
  const { offerId } = Route.useParams()
  const query = useCourse(offerId)
  const { data: course, error, reload } = query
  if (error && !course) {
    return (
      <Shell>
        <EdooboxError message={error} onReload={() => void reload()} />
      </Shell>
    )
  }
  if (!course) {
    return (
      <Shell>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-72 rounded-2xl" />
      </Shell>
    )
  }
  return <CourseView course={course} onChange={query.set} reload={reload} />
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <Link to="/account/courses" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Kursleitung
      </Link>
      {children}
    </div>
  )
}

export function courseSubtitle(course: CourseDetail): string {
  const days = course.dates.map((d) => formatCourseDay(d.start)).join(" · ")
  const first = course.dates[0]
  const time = first ? ` · ${formatCourseTime(first.start, first.end)}` : ""
  const grants = course.permissions.length ? ` · gibt ${formatPermissionNames(course.permissions)}` : ""
  return `${days}${time}${grants}`
}

function CourseView({
  course,
  onChange,
  reload,
}: {
  course: CourseDetail
  onChange: (c: CourseDetail) => void
  reload: () => Promise<void>
}) {
  const navigate = useNavigate()
  const functions = useFunctions()
  const { userDoc } = useAuth()
  const kiosk = useBridge().available
  const closed = !!course.closedAt
  const now = Date.now()
  const setAttendance = useAsyncMutation({
    context: "courses.setAttendance",
    successMessage: "In edoobox gespeichert",
    serverMessageCodes: COURSE_MESSAGE_CODES,
  })
  // One save per cell at a time: a second pick while the first is on its
  // way would create a second attendance record in edoobox.
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set())
  const latest = useRef(course)
  latest.current = course

  const setCell = (participantId: string, dateId: string, status: number | undefined) => {
    const c = latest.current
    const next = {
      ...c,
      participants: c.participants.map((p) => {
        if (p.participantId !== participantId) return p
        const attendance = { ...p.attendance }
        if (status === undefined) delete attendance[dateId]
        else attendance[dateId] = status
        return { ...p, attendance }
      }),
    }
    latest.current = next
    onChange(next)
  }

  const onSet = async (participantId: string, dateId: string, status: number) => {
    const key = `${participantId}|${dateId}`
    if (saving.has(key)) return
    const before = latest.current.participants.find((p) => p.participantId === participantId)?.attendance[dateId]
    setCell(participantId, dateId, status)
    setSaving((s) => new Set(s).add(key))
    try {
      await setAttendance.mutate(async () => {
        await rpcCallable(functions, "courseCall", "setAttendance")({ offerId: course.offerId, participantId, dateId, status })
      })
    } catch {
      // Put back only this cell; other cells may have changed meanwhile.
      setCell(participantId, dateId, before)
    } finally {
      setSaving((s) => {
        const n = new Set(s)
        n.delete(key)
        return n
      })
    }
  }

  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-3xl font-bold leading-tight">{course.title}</h1>
          <p className="text-sm text-muted-foreground" data-testid="course-dates">{courseSubtitle(course)}</p>
        </div>
        {!closed && course.phase === "toClose" && course.permissionChosen && (
          <Button variant="outline" onClick={() => void navigate({ to: "/account/courses/$offerId/close", params: { offerId: course.offerId } })}>
            Kurs abschliessen
          </Button>
        )}
      </div>

      {closed && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-border bg-muted/50 p-4 text-sm">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Abgeschlossen am {formatCourseDay(course.closedAt!)}</p>
            <p className="text-muted-foreground">Änderungen macht das Sekretariat.</p>
          </div>
        </div>
      )}

      {!closed && <PermissionPick course={course} onChange={onChange} reload={reload} />}

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
        <div className="border-b border-border px-6 py-4">
          <h2 className="font-heading text-lg font-bold">Teilnehmende</h2>
        </div>
        {course.participants.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">In edoobox ist noch niemand gebucht.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th rowSpan={2} className="px-4 py-2 font-semibold sm:px-6">
                    Teilnehmer:in
                  </th>
                  <th colSpan={course.dates.length} className="px-2 pt-2 text-center font-semibold">
                    <span className="inline-block border-b-2 border-primary px-4 pb-1">Anwesenheit</span>
                  </th>
                  <th rowSpan={2} className="hidden px-4 py-2 font-semibold sm:table-cell">
                    Zugang
                  </th>
                  <th rowSpan={2} className="w-8" aria-hidden="true" />
                </tr>
                <tr className="text-xs uppercase tracking-wide">
                  {course.dates.map((d) => (
                    <th key={d.dateId} className={cn("w-14 px-1 pb-2 text-center font-semibold sm:w-[84px] sm:px-2", isToday(d.start) ? "text-primary" : "text-muted-foreground")}>
                      {formatCourseDay(d.start)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {course.participants.map((p) => {
                  const name = `${p.firstName} ${p.lastName}`.trim()
                  const z = zugangState(p, { hasPermission: course.permissions.length > 0, kiosk, closed, leaderUserId: userDoc?.id })
                  const open = () =>
                    !closed && void navigate({ to: "/account/courses/$offerId/$participantId", params: { offerId: course.offerId, participantId: p.participantId } })
                  return (
                    <tr key={p.participantId} className={cn("border-t border-border", !closed && "cursor-pointer hover:bg-muted/30")} onClick={open}>
                      <td className="px-4 py-3 align-middle sm:px-6">
                        {closed ? (
                          <div className="font-semibold">{name}</div>
                        ) : (
                          <Link
                            to="/account/courses/$offerId/$participantId"
                            params={{ offerId: course.offerId, participantId: p.participantId }}
                            className="font-semibold hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {name}
                          </Link>
                        )}
                        <div className="hidden text-muted-foreground sm:block">{p.email}</div>
                        <ZugangStatus state={z} className="mt-2 sm:hidden" />
                      </td>
                      {course.dates.map((d) => {
                        const future = !dateHasStarted(d, now)
                        return (
                          <td key={d.dateId} className="h-px w-14 border-x-2 border-card p-0 sm:w-[84px]" onClick={(e) => e.stopPropagation()}>
                            <AttendanceCell
                              personName={name}
                              dateLabel={formatCourseDay(d.start)}
                              value={p.attendance[d.dateId]}
                              allStatuses={course.allStatuses}
                              offeredStatuses={course.offeredStatuses}
                              disabled={closed || future || saving.has(`${p.participantId}|${d.dateId}`)}
                              future={future}
                              onSet={(status) => void onSet(p.participantId, d.dateId, status)}
                            />
                          </td>
                        )
                      })}
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <ZugangStatus state={z} />
                      </td>
                      <td className="pr-4 text-muted-foreground">{!closed && <ChevronRight className="size-4" aria-hidden="true" />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Shell>
  )
}

function grantsLine(course: CourseDetail): string {
  return course.permissions.length ? `Gibt ${formatPermissionNames(course.permissions)}.` : "Gibt keine Berechtigung."
}

/** CRS-17: what the course grants — none, one or several; fixed while someone is linked. */
function PermissionPick({ course, onChange, reload }: { course: CourseDetail; onChange: (c: CourseDetail) => void; reload: () => Promise<void> }) {
  const db = useDb()
  const functions = useFunctions()
  const { data: permissions } = useCollection(permissionsCollection(db))
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(course.permissions.map((p) => p.id)))
  const save = useAsyncMutation({ context: "courses.setPermissionType", successMessage: "Gespeichert", serverMessageCodes: COURSE_MESSAGE_CODES })

  if (course.permissionChosen && !editing) {
    if (course.permissionLocked) {
      return (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="size-4" aria-hidden="true" />
          {grantsLine(course)} Festgelegt, solange jemand verknüpft ist.
        </p>
      )
    }
    return (
      <p className="text-sm text-muted-foreground">
        {grantsLine(course)}{" "}
        <button type="button" className="font-semibold text-primary underline-offset-2 hover:underline" onClick={() => setEditing(true)}>
          Ändern
        </button>
      </p>
    )
  }

  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked)
    if (on) next.add(id)
    else next.delete(id)
    setPicked(next)
  }

  const submit = async () => {
    try {
      await save.mutate(async () => {
        const { data } = await rpcCallable<unknown, CourseDetail>(functions, "courseCall", "setCoursePermissionType")({
          offerId: course.offerId,
          permissionIds: [...picked],
        })
        onChange(data)
      })
      setEditing(false)
    } catch {
      void reload()
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-oww-gold-border bg-oww-gold-light p-5 text-oww-gold-text">
      <div>
        <h2 className="font-heading text-lg font-bold">Welche Berechtigungen gibt dieser Kurs?</h2>
        <p className="text-sm">Lege sie fest, bevor du Teilnehmende verknüpfst. Danach lassen sie sich nicht mehr ändern.</p>
      </div>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Berechtigungen</legend>
        {permissions.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 text-foreground">
            <Checkbox id={`perm-${p.id}`} checked={picked.has(p.id)} onCheckedChange={(v) => toggle(p.id, v === true)} />
            <Label htmlFor={`perm-${p.id}`} className="flex-1 cursor-pointer font-normal">
              {p.name || p.id}
            </Label>
          </div>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void submit()} disabled={save.loading}>
          {picked.size ? "Speichern" : "Ohne Berechtigung speichern"}
        </Button>
        {editing && (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Abbrechen
          </Button>
        )}
      </div>
    </section>
  )
}
