// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Canonical realtime hooks for the web apps. Both `useDocument` and
 * `useCollection` accept typed `DocumentReference<T>` / `CollectionReference<T>`
 * / `Query<T>` from `firestore-helpers.ts` — never raw string paths.
 *
 * Refs are matched by their `path` (string-stable); pass `null` to unsubscribe.
 */

import { useEffect, useState } from "react"
import {
  onSnapshot,
  query,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Query,
  type QueryConstraint,
  type Unsubscribe,
} from "firebase/firestore"
import { getFunctions, httpsCallable, type Functions } from "firebase/functions"
import { useDb } from "./firebase-context"
import { getClientSessionId } from "./client-session"
import type { FirebaseApp } from "firebase/app"

interface UseCollectionResult<T> {
  data: (T & { id: string })[]
  loading: boolean
  error: Error | null
}

interface UseDocumentResult<T> {
  data: (T & { id: string }) | null
  loading: boolean
  error: Error | null
}

// Delay before subscribing to a snapshot listener. Prevents Firestore SDK
// watch-stream assertion errors caused by rapid mount/unmount cycles
// (React StrictMode double-mount, fast navigation between pages).
const LISTENER_DELAY_MS = 50

interface FirestoreQueryError {
  code?: string
  message?: string
  name?: string
}

// Fire-and-forget: log an error to console and to Cloud Logging via the
// logClientError callable. Never throws — a failure here must not trigger
// another error callback.
function reportQueryError(
  functions: Functions,
  path: string,
  err: FirestoreQueryError,
): void {
  const sessionId = getClientSessionId()
  const code = err.code ?? err.name ?? "unknown"
  const message = err.message ?? String(err)
  // eslint-disable-next-line no-console
  console.error("[firestore] error", { path, code, message, sessionId })

  try {
    const callable = httpsCallable<
      {
        sessionId: string
        context: string
        code: string
        message: string
        path: string
        userAgent: string
      },
      { ok: boolean }
    >(functions, "logClientError")
    callable({
      sessionId,
      context: "firestore",
      code,
      message,
      path,
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent ?? "" : "",
    }).catch(() => {
      // Swallow: never let logClientError failure recurse into reportQueryError.
    })
  } catch {
    // Swallow synchronous init errors for the same reason.
  }
}

function functionsForDb(db: { app: FirebaseApp }): Functions {
  return getFunctions(db.app)
}

/**
 * Some refs/queries don't expose `.path` directly (e.g. queries built by
 * `query(collectionRef, ...constraints)` only carry the path on their
 * underlying CollectionReference). This pulls the most useful identifier
 * for logging purposes.
 */
function pathOf(refOrQuery: unknown): string {
  if (!refOrQuery || typeof refOrQuery !== "object") return ""
  const r = refOrQuery as {
    path?: string
    type?: string
    _query?: { path?: { canonicalString?: () => string } }
  }
  if (typeof r.path === "string") return r.path
  // Firestore Query objects carry the path on an internal `_query` field
  // shaped like { path: ResourcePath }. Best-effort only; on any miss
  // we just log an empty string so we never throw.
  try {
    const internal = r._query?.path?.canonicalString?.()
    if (typeof internal === "string") return internal
  } catch {
    // ignored
  }
  return ""
}

/**
 * Subscribe to a collection or query. Pass `null` to skip the subscription
 * (e.g. when waiting for an id to become available). When extra constraints
 * are provided, the ref is wrapped in `query(ref, ...constraints)` for you.
 */
export function useCollection<T = DocumentData>(
  refOrQuery: CollectionReference<T> | Query<T> | null,
  ...constraints: QueryConstraint[]
): UseCollectionResult<T> {
  const db = useDb()
  const [data, setData] = useState<(T & { id: string })[]>([])
  const [loading, setLoading] = useState(!!refOrQuery)
  const [error, setError] = useState<Error | null>(null)

  // Re-subscribe when the ref's path changes; constraints are assumed
  // stable per call site (each component always passes the same set of
  // where/orderBy clauses), so we don't include them in deps. This is the
  // same convention the previous string-path hook used.
  const path = refOrQuery ? pathOf(refOrQuery) : ""

  useEffect(() => {
    if (!refOrQuery) {
      setData([])
      setLoading(false)
      return
    }

    setLoading(true)
    let unsub: Unsubscribe | undefined

    const timer = setTimeout(() => {
      const target =
        constraints.length > 0
          ? query(refOrQuery, ...constraints)
          : refOrQuery

      unsub = onSnapshot(
        target,
        (snapshot) => {
          setData(
            snapshot.docs.map(
              (d) => ({ id: d.id, ...d.data() }) as T & { id: string },
            ),
          )
          setLoading(false)
          setError(null)
        },
        (err) => {
          reportQueryError(
            functionsForDb(db),
            path,
            err as FirestoreQueryError,
          )
          setError(err)
          setLoading(false)
        },
      )
    }, LISTENER_DELAY_MS)

    return () => {
      clearTimeout(timer)
      unsub?.()
    }
    // Re-subscribe only when path or db changes. See comment above on
    // constraints stability per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, db])

  return { data, loading, error }
}

/**
 * Subscribe to a single document. Pass `null` to skip the subscription
 * (e.g. while an id is still being resolved).
 */
export function useDocument<T = DocumentData>(
  ref: DocumentReference<T> | null,
): UseDocumentResult<T> {
  const db = useDb()
  const [data, setData] = useState<(T & { id: string }) | null>(null)
  const [loading, setLoading] = useState(!!ref)
  const [error, setError] = useState<Error | null>(null)

  const path = ref ? pathOf(ref) : ""

  useEffect(() => {
    if (!ref) {
      setData(null)
      setLoading(false)
      return
    }

    let unsub: Unsubscribe | undefined

    const timer = setTimeout(() => {
      unsub = onSnapshot(
        ref,
        (snapshot) => {
          if (snapshot.exists()) {
            setData({
              id: snapshot.id,
              ...snapshot.data(),
            } as T & { id: string })
          } else {
            setData(null)
          }
          setLoading(false)
          setError(null)
        },
        (err) => {
          reportQueryError(
            functionsForDb(db),
            path,
            err as FirestoreQueryError,
          )
          setError(err)
          setLoading(false)
        },
      )
    }, LISTENER_DELAY_MS)

    return () => {
      clearTimeout(timer)
      unsub?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, db])

  return { data, loading, error }
}

