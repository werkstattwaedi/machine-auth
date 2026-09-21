// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Canonical realtime hooks for the web apps. Both `useDocument` and
 * `useCollection` accept typed `DocumentReference<T>` / `CollectionReference<T>`
 * / `Query<T>` from `firestore-helpers.ts` — never raw string paths.
 *
 * Refs are matched by their `path` (string-stable); pass `null` to unsubscribe.
 *
 * `useDocumentsByIds` loads an explicit id list (e.g. a price list's items)
 * in chunks of 30, the operand cap of a `documentId() in [...]` query.
 */

import { useEffect, useState } from "react"
import {
  documentId,
  onSnapshot,
  query,
  where,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Query,
  type QueryConstraint,
  type Unsubscribe,
} from "firebase/firestore"
import { httpsCallable, type Functions } from "firebase/functions"
import { useDb, useFunctions } from "./firebase-context"
import { getClientSessionId } from "./client-session"

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
//
// `functions` must be the region-configured instance from context. A bare
// `getFunctions(app)` targets us-central1, where nothing is deployed, so
// the report 404s and is swallowed — listener errors then never reach
// Cloud Logging at all (which is how the create-then-listen race on
// checkout items went unlogged in production).
function reportQueryError(
  functions: Functions,
  path: string,
  err: FirestoreQueryError,
): void {
  const sessionId = getClientSessionId()
  const code = err.code ?? err.name ?? "unknown"
  // Same 200-char cap as useAsyncMutation (ADR-0025); server caps again.
  const message = (err.message ?? String(err)).slice(0, 200)
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
  const functions = useFunctions()
  const [data, setData] = useState<(T & { id: string })[]>([])
  const [loading, setLoading] = useState(!!refOrQuery)
  const [error, setError] = useState<Error | null>(null)
  // The path the currently-held `data`/`error` were last reported for.
  // Distinct from the requested `path` below: when a caller swaps the ref
  // (e.g. null → a real query once an id resolves) the requested path
  // changes immediately, but the re-subscription effect — and the
  // `setLoading(true)` inside it — only runs on the *next* tick. Reading
  // `loading` in that one-render window would otherwise see the stale
  // `false` from the previous subscription. See issue #387.
  const [reportedPath, setReportedPath] = useState("")

  // Re-subscribe when the ref's path changes; constraints are assumed
  // stable per call site (each component always passes the same set of
  // where/orderBy clauses), so we don't include them in deps. This is the
  // same convention the previous string-path hook used.
  const path = refOrQuery ? pathOf(refOrQuery) : ""

  useEffect(() => {
    if (!refOrQuery) {
      setData([])
      setLoading(false)
      setReportedPath("")
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
          setReportedPath(path)
        },
        (err) => {
          reportQueryError(functions, path, err as FirestoreQueryError)
          setError(err)
          setLoading(false)
          setReportedPath(path)
        },
      )
    }, LISTENER_DELAY_MS)

    return () => {
      clearTimeout(timer)
      unsub?.()
    }
    // Re-subscribe only when path, db or functions change. See comment above on
    // constraints stability per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, db, functions])

  // Report loading while the held snapshot belongs to a different path than
  // the one currently requested (a re-subscription is pending). Closes the
  // one-render window where a freshly-supplied ref reads as "loaded with
  // empty data" before its effect runs. See issue #387.
  const stale = path !== reportedPath
  return { data, loading: loading || stale, error }
}

/**
 * Subscribe to a single document. Pass `null` to skip the subscription
 * (e.g. while an id is still being resolved).
 */
export function useDocument<T = DocumentData>(
  ref: DocumentReference<T> | null,
): UseDocumentResult<T> {
  const db = useDb()
  const functions = useFunctions()
  const [data, setData] = useState<(T & { id: string }) | null>(null)
  const [loading, setLoading] = useState(!!ref)
  const [error, setError] = useState<Error | null>(null)
  // See the matching comment in useCollection: tracks which path the held
  // `data`/`error` belong to so a freshly-swapped ref reports loading on
  // the render before its re-subscription effect runs. See issue #387.
  const [reportedPath, setReportedPath] = useState("")

  const path = ref ? pathOf(ref) : ""

  useEffect(() => {
    if (!ref) {
      setData(null)
      setLoading(false)
      setReportedPath("")
      return
    }

    setLoading(true)
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
          setReportedPath(path)
        },
        (err) => {
          reportQueryError(functions, path, err as FirestoreQueryError)
          setError(err)
          setLoading(false)
          setReportedPath(path)
        },
      )
    }, LISTENER_DELAY_MS)

    return () => {
      clearTimeout(timer)
      unsub?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, db, functions])

  // See useCollection: report loading while the held snapshot belongs to a
  // different path than the one requested (re-subscription pending).
  const stale = path !== reportedPath
  return { data, loading: loading || stale, error }
}


// Firestore caps the operand list of an `in` query at 30 entries.
const DOCUMENT_ID_IN_LIMIT = 30

/** Split `ids` into consecutive groups of at most `size` entries. */
export function chunkIds(
  ids: readonly string[],
  size: number = DOCUMENT_ID_IN_LIMIT,
): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size))
  }
  return chunks
}

/**
 * Subscribe to the documents of `ref` whose ids are listed in `ids`, in
 * `ids` order (ids without a document are skipped). Firestore caps a
 * `documentId() in [...]` query at 30 operands, so one listener is opened
 * per chunk of 30 and the snapshots are merged; `loading` stays true until
 * every chunk has reported. A price list with more than 30 items used to
 * be cut off silently at this cap (issue #632).
 *
 * Unlike `useCollection`, the id list is part of the subscription key: a
 * price list edited while the picker is open re-subscribes with the new
 * ids. Pass `null` or an empty list to skip the subscription.
 */
export function useDocumentsByIds<T = DocumentData>(
  ref: CollectionReference<T> | null,
  ids: readonly string[],
): UseCollectionResult<T> {
  const db = useDb()
  const functions = useFunctions()
  const [data, setData] = useState<(T & { id: string })[]>([])
  const [loading, setLoading] = useState(!!ref && ids.length > 0)
  const [error, setError] = useState<Error | null>(null)
  // See useCollection: the key the held `data`/`error` were reported for,
  // so a freshly-changed request reads as loading until its effect runs.
  const [reportedKey, setReportedKey] = useState("")

  const path = ref ? pathOf(ref) : ""
  // Duplicate ids would produce duplicate rows on merge and count double
  // against the operand cap.
  const uniqueIds = Array.from(new Set(ids))
  const key = ref && uniqueIds.length > 0 ? `${path}\n${uniqueIds.join("\n")}` : ""

  useEffect(() => {
    if (!key || !ref) {
      setData([])
      setLoading(false)
      setError(null)
      setReportedKey("")
      return
    }

    setLoading(true)
    setError(null)
    const chunks = chunkIds(uniqueIds)
    const chunkDocs: (T & { id: string })[][] = chunks.map(() => [])
    const reported: boolean[] = chunks.map(() => false)
    const unsubs: Unsubscribe[] = []

    const timer = setTimeout(() => {
      chunks.forEach((chunk, index) => {
        unsubs.push(
          onSnapshot(
            query(ref, where(documentId(), "in", chunk)),
            (snapshot) => {
              chunkDocs[index] = snapshot.docs.map(
                (d) => ({ id: d.id, ...d.data() }) as T & { id: string },
              )
              reported[index] = true
              if (!reported.every(Boolean)) return
              const byId = new Map(chunkDocs.flat().map((d) => [d.id, d]))
              setData(
                uniqueIds.flatMap((id) => {
                  const doc = byId.get(id)
                  return doc ? [doc] : []
                }),
              )
              setLoading(false)
              setReportedKey(key)
            },
            (err) => {
              reportQueryError(functions, path, err as FirestoreQueryError)
              // Listener errors are terminal, so the first one stands; a
              // later chunk's success must not paint over it.
              setError((prev) => prev ?? err)
              setLoading(false)
              setReportedKey(key)
            },
          ),
        )
      })
    }, LISTENER_DELAY_MS)

    return () => {
      clearTimeout(timer)
      unsubs.forEach((unsub) => unsub())
    }
    // `key` covers the collection path and the (deduplicated) id list, so
    // `ref` and `uniqueIds` are stable while it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, db, functions])

  const stale = key !== reportedKey
  return { data, loading: loading || stale, error }
}
