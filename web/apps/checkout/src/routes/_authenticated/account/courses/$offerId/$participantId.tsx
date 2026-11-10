// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * One participant of a course (#842): link an account by the edoobox
 * e-mail or create one (CRS-6/7), assign a badge at the kiosk (CRS-9) and
 * set the permission choice (CRS-10). Pager through the participants.
 */

import { useEffect, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, ChevronLeft, ChevronRight, Lock, Pencil } from "lucide-react"
import type { CheckParticipantEmailResult, CourseChoice, CourseDetail, CourseParticipant } from "@oww/shared"
import { useAuth } from "@modules/lib/auth"
import { useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"
import { useBridge } from "@modules/lib/use-bridge"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { Button } from "@modules/components/ui/button"
import { Input } from "@modules/components/ui/input"
import { Label } from "@modules/components/ui/label"
import { Skeleton } from "@modules/components/ui/skeleton"
import { cn } from "@modules/lib/utils"
import { BadgeAssignDialog } from "@/components/courses/badge-assign-dialog"
import { SegmentedChoice } from "@/components/courses/segmented-choice"
import { COURSE_MESSAGE_CODES } from "@/lib/courses"
import { EdooboxError } from "@/routes/_authenticated/account/courses/index"
import { useCourse } from "@/lib/courses"

export const Route = createFileRoute("/_authenticated/account/courses/$offerId/$participantId")({
  component: ParticipantPage,
})

function ParticipantPage() {
  const { offerId, participantId } = Route.useParams()
  const { data: course, error, reload } = useCourse(offerId)
  const back = (
    <Link
      to="/account/courses/$offerId"
      params={{ offerId }}
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {course?.title ?? "Kurs"}
    </Link>
  )
  if (error && !course) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {back}
        <EdooboxError message={error} onReload={() => void reload()} />
      </div>
    )
  }
  if (!course) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {back}
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    )
  }
  const idx = course.participants.findIndex((p) => p.participantId === participantId)
  const p = course.participants[idx]
  if (!p) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {back}
        <p className="text-sm text-muted-foreground">Diese Person ist nicht (mehr) in diesem Kurs.</p>
      </div>
    )
  }
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      {back}
      <ParticipantView key={p.participantId} course={course} participant={p} index={idx} reload={reload} />
    </div>
  )
}

function fullName(p: CourseParticipant): string {
  return `${p.firstName} ${p.lastName}`.trim()
}

function ParticipantView({
  course,
  participant: p,
  index,
  reload,
}: {
  course: CourseDetail
  participant: CourseParticipant
  index: number
  reload: () => Promise<void>
}) {
  const navigate = useNavigate()
  const prev = course.participants[index - 1]
  const next = course.participants[index + 1]
  const go = (q: CourseParticipant) =>
    void navigate({ to: "/account/courses/$offerId/$participantId", params: { offerId: course.offerId, participantId: q.participantId } })
  const closed = !!course.closedAt
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-3xl font-bold leading-tight">{fullName(p)}</h1>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Button variant="ghost" size="icon" disabled={!prev} onClick={() => prev && go(prev)} aria-label={prev ? `Vorherige Person: ${fullName(prev)}` : "Vorherige Person"}>
            <ChevronLeft />
          </Button>
          <span className="tabular-nums">
            {index + 1} / {course.participants.length}
          </span>
          <Button variant="ghost" size="icon" disabled={!next} onClick={() => next && go(next)} aria-label={next ? `Nächste Person: ${fullName(next)}` : "Nächste Person"}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      {p.link ? (
        <LinkedView key={p.participantId} course={course} participant={p} reload={reload} closed={closed} />
      ) : (
        <LinkCard key={p.participantId} course={course} participant={p} reload={reload} closed={closed} />
      )}
    </>
  )
}

const card = "rounded-2xl border border-border bg-card p-6 shadow-xs flex flex-col gap-4"

function LinkCard({ course, participant: p, reload, closed }: { course: CourseDetail; participant: CourseParticipant; reload: () => Promise<void>; closed: boolean }) {
  const functions = useFunctions()
  const [email, setEmail] = useState(p.email)
  const [draft, setDraft] = useState(p.email)
  const [editing, setEditing] = useState(false)
  // null while unknown: the e-mail's check failed or is still running.
  const [exists, setExists] = useState<boolean | null>(p.accountExists)
  const check = useAsyncMutation({ context: "courses.checkParticipantEmail", serverMessageCodes: COURSE_MESSAGE_CODES })
  const link = useAsyncMutation({ context: "courses.linkParticipant", serverMessageCodes: COURSE_MESSAGE_CODES })

  // A corrected e-mail is for matching only (CRS-6): ask whether it has an account.
  useEffect(() => {
    if (email === p.email) {
      setExists(p.accountExists)
      return
    }
    let stale = false
    setExists(null)
    void check
      .mutate(async () => {
        const { data } = await rpcCallable<unknown, CheckParticipantEmailResult>(functions, "courseCall", "checkParticipantEmail")({
          offerId: course.offerId,
          participantId: p.participantId,
          email,
        })
        if (!stale) setExists(data.accountExists)
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email])

  const doLink = async (create: boolean) => {
    try {
      await link.mutate(async () => {
        await rpcCallable(functions, "courseCall", "linkParticipant")({ offerId: course.offerId, participantId: p.participantId, email, create })
      })
    } catch {
      return
    }
    await reload()
  }

  return (
    <section className={card}>
      <h2 className="font-heading text-lg font-bold">Konto</h2>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="course-email">E-Mail für die Zuordnung</Label>
          <Input id="course-email" type="email" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <p className="text-xs text-muted-foreground">Wird nur hier zum Finden des Kontos verwendet; edoobox behält seine Adresse.</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setEmail(draft.trim().toLowerCase() || p.email)
                setEditing(false)
              }}
            >
              Übernehmen
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setDraft(email); setEditing(false) }}>
              Abbrechen
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="break-all">{email}</span>
          {!closed && (
            <Button variant="ghost" size="icon" aria-label="E-Mail für die Zuordnung ändern" onClick={() => setEditing(true)}>
              <Pencil />
            </Button>
          )}
        </div>
      )}
      {!editing && !closed && (
        <>
          <p className="text-sm text-muted-foreground">{check.loading ? "Konto wird gesucht …" : exists === null ? "Konto konnte nicht gesucht werden" : exists ? "Konto vorhanden" : "Noch kein Konto"}</p>
          {!course.permissionChosen ? (
            <p className="rounded-lg bg-oww-gold-light p-3 text-sm text-oww-gold-text">
              Lege auf der Kursseite zuerst fest, welche Berechtigung der Kurs gibt.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <Button className="w-fit" disabled={link.loading || check.loading || exists === null} onClick={() => void doLink(!exists)}>
                {exists ? "Mit diesem Konto verknüpfen" : "Konto anlegen und verknüpfen"}
              </Button>
              <p className="text-xs text-muted-foreground">Die Verknüpfung kann danach nur das Sekretariat ändern.</p>
            </div>
          )}
        </>
      )}
    </section>
  )
}

const CHOICES: Array<{ value: CourseChoice; label: string; hint: string }> = [
  { value: "no", label: "Nein", hint: "Keine" },
  { value: "temp", label: "Vorläufig", hint: "Während der Termine" },
  { value: "yes", label: "Ja", hint: "Dauerhaft" },
]

function LinkedView({ course, participant: p, reload, closed }: { course: CourseDetail; participant: CourseParticipant; reload: () => Promise<void>; closed: boolean }) {
  const functions = useFunctions()
  const kiosk = useBridge().available
  const { userDoc } = useAuth()
  const link = p.link!
  const own = link.userId === userDoc?.id
  const [choice, setChoice] = useState<CourseChoice>(link.choice)
  // Follow the server after a reload (another device, or the sync).
  const [serverChoice, setServerChoice] = useState(link.choice)
  if (serverChoice !== link.choice) {
    setServerChoice(link.choice)
    setChoice(link.choice)
  }
  const [badgeOpen, setBadgeOpen] = useState(false)
  const save = useAsyncMutation({ context: "courses.setParticipantChoice", successMessage: "Gespeichert", serverMessageCodes: COURSE_MESSAGE_CODES })

  const pick = async (c: CourseChoice) => {
    const before = choice
    setChoice(c)
    try {
      await save.mutate(async () => {
        await rpcCallable(functions, "courseCall", "setParticipantChoice")({ offerId: course.offerId, participantId: p.participantId, choice: c })
      })
    } catch {
      setChoice(before)
    }
  }

  return (
    <>
      <section className={card}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-bold">Konto</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold">
            <Lock className="size-3" aria-hidden="true" />
            Verknüpft
          </span>
        </div>
        <p className="break-all text-sm text-muted-foreground">{p.email}</p>
      </section>
      <section className={cn(card, "gap-5")}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold">Badge</h3>
            <p className="text-sm text-muted-foreground">{link.hasBadge ? "Vorhanden" : "Fehlt"}</p>
          </div>
          {!link.hasBadge && !closed && !own &&
            (kiosk ? (
              <Button onClick={() => setBadgeOpen(true)}>Badge zuweisen</Button>
            ) : (
              <span className="text-sm font-semibold text-oww-gold-text">Am Kiosk zuweisen</span>
            ))}
        </div>
        {course.permission && (
          <div className="flex flex-col gap-3 border-t border-border pt-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">Berechtigung «{course.permission.name}»</h3>
              {link.alreadyHeld && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  Schon berechtigt
                </span>
              )}
            </div>
            {own ? (
              <p className="text-sm text-muted-foreground">Für dein eigenes Konto vergibst du keine Berechtigung.</p>
            ) : link.alreadyHeld ? null : (
              <SegmentedChoice
                label={`Berechtigung «${course.permission.name}»`}
                options={CHOICES}
                value={choice}
                disabled={closed || save.loading}
                onChange={(c) => void pick(c)}
              />
            )}
          </div>
        )}
      </section>
      <BadgeAssignDialog
        open={badgeOpen}
        onOpenChange={setBadgeOpen}
        offerId={course.offerId}
        participantId={p.participantId}
        personName={`${p.firstName} ${p.lastName}`.trim()}
        onAssigned={() => void reload()}
      />
    </>
  )
}
