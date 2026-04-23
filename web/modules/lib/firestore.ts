// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react"
import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type QueryConstraint,
  type Unsubscribe,
  query,
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

export function useCollection<T = DocumentData>(
  path: string | null,
  ...constraints: QueryConstraint[]
): UseCollectionResult<T> {
  const db = useDb()
  const [data, setData] = useState<(T & { id: string })[]>([])
  const [loading, setLoading] = useState(!!path)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!path) {
      setData([])
      setLoading(false)
      return
    }

    setLoading(true)
    let unsub: Unsubscribe | undefined

    const timer = setTimeout(() => {
      const ref = collection(db, path)
      const q = constraints.length > 0 ? query(ref, ...constraints) : ref

      unsub = onSnapshot(
        q,
        (snapshot) => {
          setData(
            snapshot.docs.map(
              (d) => ({ id: d.id, ...d.data() }) as T & { id: string }
            )
          )
          setLoading(false)
          setError(null)
        },
        (err) => {
          reportQueryError(functionsForDb(db), path, err as FirestoreQueryError)
          setError(err)
          setLoading(false)
        }
      )
    }, LISTENER_DELAY_MS)

    return () => {
      clearTimeout(timer)
      unsub?.()
    }
    // Re-subscribe when path or db changes. Constraints are stable per call site
    // (each component always passes the same set of where/orderBy clauses).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, db])

  return { data, loading, error }
}

export function useDocument<T = DocumentData>(
  path: string | null
): UseDocumentResult<T> {
  const db = useDb()
  const [data, setData] = useState<(T & { id: string }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!path) {
      setData(null)
      setLoading(false)
      return
    }

    let unsub: Unsubscribe | undefined

    const timer = setTimeout(() => {
      const ref = doc(db, path)

      unsub = onSnapshot(
        ref,
        (snapshot) => {
          if (snapshot.exists()) {
            setData({ id: snapshot.id, ...snapshot.data() } as T & { id: string })
          } else {
            setData(null)
          }
          setLoading(false)
          setError(null)
        },
        (err) => {
          reportQueryError(functionsForDb(db), path, err as FirestoreQueryError)
          setError(err)
          setLoading(false)
        }
      )
    }, LISTENER_DELAY_MS)

    return () => {
      clearTimeout(timer)
      unsub?.()
    }
  }, [path, db])

  return { data, loading, error }
}
