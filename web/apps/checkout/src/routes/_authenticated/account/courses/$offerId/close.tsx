// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kurs abschliessen (#842, CRS-12..14): Ja/Nein per participant for the
 * course's permission, preset by CRS-12; a Nein carries a reason that goes
 * to edoobox as a note (CRS-13). A course without a permission (CRS-17) is
 * just marked closed.
 */

import { useMemo, useState } from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import {
  attendanceSummary,
  closePreset,
  defaultCloseReason,
  type CloseCourseResult,
  type CourseDetail,
  type CourseParticipant,
} from "@oww/shared"
import { useAuth } from "@modules/lib/auth"
import { useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"
import { useAsyncMutation } from "@modules/hooks/use-async-mutation"
import { Button } from "@modules/components/ui/button"
import { Input } from "@modules/components/ui/input"
import { Label } from "@modules/components/ui/label"
import { Skeleton } from "@modules/components/ui/skeleton"
import { cn } from "@modules/lib/utils"
import { EdooboxError } from "@/routes/_authenticated/account/courses/index"
import { SegmentedChoice } from "@/components/courses/segmented-choice"
import { COURSE_MESSAGE_CODES } from "@/lib/courses"
import { useCourse } from "@/lib/courses"

export const Route = createFileRoute("/_authenticated/account/courses/$offerId/close")({
  component: ClosePage,
})

function ClosePage() {
  const { offerId } = Route.useParams()
  const { data: course, error, reload } = useCourse(offerId)
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <Link to="/account/courses/$offerId" params={{ offerId }} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {course?.title ?? "Kurs"}
      </Link>
      {error && !course ? (
        <EdooboxError message={error} onReload={() => void reload()} />
      ) : !course ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : course.closedAt ? (
        <p className="text-sm text-muted-foreground">Der Kurs ist schon abgeschlossen.</p>
      ) : course.phase !== "toClose" ? (
        <p className="text-sm text-muted-foreground">Der Kurs lässt sich erst ab dem letzten Termin abschliessen.</p>
      ) : (
        <CloseForm course={course} />
      )}
    </div>
  )
}

function name(p: CourseParticipant): string {
  return `${p.firstName} ${p.lastName}`.trim()
}

function CloseForm({ course }: { course: CourseDetail }) {
  const navigate = useNavigate()
  const functions = useFunctions()
  const { userDoc } = useAuth()
  const statuses = useMemo(() => new Map(course.allStatuses.map((s) => [s.status, s])), [course.allStatuses])
  const perm = course.permission
  const [choices, setChoices] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(course.participants.map((p) => [p.participantId, closePreset(p, userDoc?.id)]))
  )
  const [reasons, setReasons] = useState<Record<string, string>>(() =>
    Object.fromEntries(course.participants.map((p) => [p.participantId, defaultCloseReason(p, course.dates, statuses)]))
  )
  const close = useAsyncMutation({ context: "courses.closeCourse", serverMessageCodes: COURSE_MESSAGE_CODES })
  const granted = Object.values(choices).filter(Boolean).length

  const submit = async () => {
    let result: CloseCourseResult | undefined
    try {
      await close.mutate(async () => {
        const { data } = await rpcCallable<unknown, CloseCourseResult>(functions, "courseCall", "closeCourse")({
          offerId: course.offerId,
          choices: perm ? choices : {},
          reasons: perm ? Object.fromEntries(Object.entries(reasons).filter(([id]) => !choices[id])) : {},
        })
        result = data
      })
    } catch {
      return
    }
    toast.success("Kurs abgeschlossen")
    if (result && result.notesFailed > 0) {
      toast.warning(`${result.notesFailed} Notiz${result.notesFailed === 1 ? "" : "en"} konnte${result.notesFailed === 1 ? "" : "n"} nicht in edoobox gespeichert werden.`)
    }
    void navigate({ to: "/account/courses/$offerId", params: { offerId: course.offerId } })
  }

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-bold leading-tight">Kurs abschliessen</h1>
        <p className="text-sm text-muted-foreground">{perm ? `Wer «${perm.name}» behält` : "Dieser Kurs gibt keine Berechtigung."}</p>
      </header>
      <section className="divide-y divide-border rounded-2xl border border-border bg-card shadow-xs">
        {course.participants.map((p) => {
          const s = attendanceSummary(p, course.dates, statuses)
          const own = p.link?.userId === userDoc?.id
          const locked = !p.link || own
          const yes = choices[p.participantId]
          return (
            <div key={p.participantId} className="flex flex-col gap-3 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                    {name(p)}
                    {perm && !p.link && <Tag tone="err">Kein Konto</Tag>}
                    {s.attended === 0 ? <Tag tone="warn">Nie anwesend</Tag> : s.missed > 0 ? <Tag tone="warn">An {s.missed} {s.missed === 1 ? "Termin" : "Terminen"} abwesend</Tag> : null}
                    {perm && p.link?.alreadyHeld && <Tag tone="ok">Schon berechtigt</Tag>}
                  </div>
                  <div className="text-sm text-muted-foreground">{p.email}</div>
                </div>
                {perm && (
                  <SegmentedChoice
                    label={name(p)}
                    options={YES_NO}
                    value={yes}
                    disabled={locked}
                    title={locked ? (own ? "Für dein eigenes Konto nicht möglich" : "Ohne Konto keine Berechtigung") : undefined}
                    onChange={(v) => setChoices((c) => ({ ...c, [p.participantId]: v }))}
                  />
                )}
              </div>
              {perm && !yes && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`why-${p.participantId}`}>Grund (Notiz in edoobox)</Label>
                  <Input
                    id={`why-${p.participantId}`}
                    value={reasons[p.participantId] ?? ""}
                    maxLength={1000}
                    onChange={(e) => setReasons((r) => ({ ...r, [p.participantId]: e.target.value }))}
                  />
                </div>
              )}
            </div>
          )
        })}
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{perm ? `${granted} erhalten «${perm.name}»` : ""}</span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void navigate({ to: "/account/courses/$offerId", params: { offerId: course.offerId } })}>
            Abbrechen
          </Button>
          <Button onClick={() => void submit()} disabled={close.loading}>
            Abschliessen
          </Button>
        </div>
      </div>
    </>
  )
}

const YES_NO = [
  { value: false, label: "Nein", selectedClassName: "text-red-700 dark:text-red-300" },
  { value: true, label: "Ja", selectedClassName: "text-emerald-700 dark:text-emerald-300" },
] as const

function Tag({ tone, children }: { tone: "err" | "warn" | "ok"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-semibold",
        tone === "err" && "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
        tone === "warn" && "bg-oww-gold-light text-oww-gold-text",
        tone === "ok" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
      )}
    >
      {children}
    </span>
  )
}
