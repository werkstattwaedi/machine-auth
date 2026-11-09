// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Kursleitung (#842, CRS-1/2): the course leader's courses from edoobox —
 * running, to close, upcoming. Closed ones are not listed.
 */

import { createFileRoute, Link } from "@tanstack/react-router"
import { AlertTriangle, ChevronRight, GraduationCap } from "lucide-react"
import type { CourseSummary } from "@oww/shared"
import { Button } from "@modules/components/ui/button"
import { EmptyState } from "@modules/components/empty-state"
import { Skeleton } from "@modules/components/ui/skeleton"
import { cn } from "@modules/lib/utils"
import { formatCourseDay, useMyCourses, workshopColorVar } from "@/lib/courses"

export const Route = createFileRoute("/_authenticated/account/courses/")({
  component: CoursesPage,
})

export function CoursesPage() {
  const { data, loading, error, reload } = useMyCourses()
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-bold leading-tight">Kursleitung</h1>
        <p className="text-sm text-muted-foreground">Deine Kurse aus edoobox</p>
      </header>
      {error ? (
        <EdooboxError message={error} onReload={() => void reload()} />
      ) : loading && !data ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[76px] rounded-2xl" />
          ))}
        </div>
      ) : !data || data.courses.length === 0 ? (
        <EmptyState icon={GraduationCap} title="Keine Kurse" description="Du leitest zurzeit keine laufenden Kurse." />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.courses.map((c) => (
            <li key={c.offerId}>
              <CourseRow course={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function EdooboxError({ message, onReload }: { message: string; onReload: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-2xl border border-oww-gold-border bg-oww-gold-light p-4 text-oww-gold-text sm:flex-row sm:items-center"
    >
      <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
      <p className="flex-1 text-sm">{message}</p>
      <Button variant="outline" size="sm" onClick={onReload}>
        Neu laden
      </Button>
    </div>
  )
}

const PILL: Record<CourseSummary["phase"], { label: string; className: string } | null> = {
  running: { label: "Heute", className: "bg-cog-teal/15 text-cog-teal-dark dark:text-cog-teal" },
  toClose: { label: "Abschliessen", className: "bg-oww-gold text-oww-gold-text" },
  upcoming: null,
}

function CourseRow({ course }: { course: CourseSummary }) {
  const pill = course.phase === "running" && !course.dates.some((d) => isTodayIso(d.start)) ? null : PILL[course.phase]
  return (
    <Link
      to="/account/courses/$offerId"
      params={{ offerId: course.offerId }}
      className="grid grid-cols-[10px_1fr_auto_16px] items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-xs transition-colors hover:bg-muted/40"
    >
      <span className="size-2.5 rounded-full" style={{ background: workshopColorVar(course.workshop) }} aria-hidden="true" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{course.title}</span>
        <span className="text-sm text-muted-foreground" data-testid="course-dates">
          {course.dates.map((d) => formatCourseDay(d.start)).join(" · ")} · {course.participantCount} Teilnehmende
        </span>
      </span>
      {pill ? <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", pill.className)}>{pill.label}</span> : <span />}
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
    </Link>
  )
}

function isTodayIso(iso: string): boolean {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" })
  return f.format(new Date(iso)) === f.format(new Date())
}
