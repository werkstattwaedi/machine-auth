// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Reading the course leader's courses (#842). Course data is edoobox's and
 * read live through `courseCall` (CRS-3), so these are plain fetch-on-mount
 * hooks with a `reload`, not Firestore listeners. Writes go through
 * `useAsyncMutation` at the call site (ADR-0025).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { CourseDetail, ListMyCoursesResult } from "@oww/shared"
import { useFunctions } from "@modules/lib/firebase-context"
import { rpcCallable } from "@modules/lib/rpc"

export interface CourseQuery<T> {
  data: T | null
  loading: boolean
  /** Set when edoobox (or the call) failed; the page shows the banner. */
  error: string | null
  reload: () => Promise<void>
  /** Replace the data with a server answer (e.g. after a write that returns it). */
  set: (data: T) => void
}

function useCourseQuery<I, T>(method: string, input: I | null): CourseQuery<T> {
  const functions = useFunctions()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(input !== null)
  const [error, setError] = useState<string | null>(null)
  const key = JSON.stringify(input)
  const seq = useRef(0)

  // Another course on the same mounted route: never show the previous one.
  const [shownKey, setShownKey] = useState(key)
  if (shownKey !== key) {
    setShownKey(key)
    setData(null)
    setError(null)
  }

  const reload = useCallback(async () => {
    if (key === "null") return
    const mine = ++seq.current
    setLoading(true)
    try {
      const { data: result } = await rpcCallable<I, T>(functions, "courseCall", method)(JSON.parse(key) as I)
      if (mine !== seq.current) return
      setData(result)
      setError(null)
    } catch (err) {
      if (mine !== seq.current) return
      const message = (err as { message?: unknown })?.message
      setError(typeof message === "string" && message ? message : "Die Kurse konnten nicht geladen werden.")
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [functions, method, key])

  useEffect(() => {
    void reload()
  }, [reload])

  // A server answer outranks any read still in flight, which started earlier.
  const set = useCallback((next: T) => {
    seq.current++
    setData(next)
    setError(null)
    setLoading(false)
  }, [])

  return { data, loading, error, reload, set }
}

export function useMyCourses(): CourseQuery<ListMyCoursesResult> {
  return useCourseQuery<object, ListMyCoursesResult>("listMyCourses", {})
}

export function useCourse(offerId: string): CourseQuery<CourseDetail> {
  return useCourseQuery<{ offerId: string }, CourseDetail>("getCourse", { offerId })
}

/** «Sa 31.10.» in the workshop's time zone. */
export function formatCourseDay(iso: string): string {
  const d = new Date(iso)
  const day = new Intl.DateTimeFormat("de-CH", { weekday: "short", timeZone: "Europe/Zurich" })
    .format(d)
    .replace(".", "")
  const date = new Intl.DateTimeFormat("de-CH", { day: "numeric", month: "numeric", timeZone: "Europe/Zurich" }).format(d)
  return `${day} ${date}${date.endsWith(".") ? "" : "."}`
}

/** «9:00–12:00» for a Termin. */
export function formatCourseTime(startIso: string, endIso: string): string {
  const f = new Intl.DateTimeFormat("de-CH", { hour: "numeric", minute: "2-digit", timeZone: "Europe/Zurich" })
  return `${f.format(new Date(startIso))}–${f.format(new Date(endIso))}`
}

export function isToday(iso: string, now = new Date()): boolean {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" })
  return f.format(new Date(iso)) === f.format(now)
}

/** Workshop colour token for the course list's dot (`--color-ws-*`). */
export function workshopColorVar(workshop: string | null): string {
  return workshop ? `var(--color-ws-${workshop})` : "var(--color-muted-foreground)"
}

/** Codes whose server message tells the course leader what happened (ADR-0025). */
export const COURSE_MESSAGE_CODES = [
  "functions/already-exists",
  "functions/permission-denied",
  "functions/failed-precondition",
  "functions/not-found",
  "functions/aborted",
  "functions/unavailable",
  "functions/invalid-argument",
]
