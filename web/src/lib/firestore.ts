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
import { db } from "./firebase"

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

export function useCollection<T = DocumentData>(
  path: string | null,
  ...constraints: QueryConstraint[]
): UseCollectionResult<T> {
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
          setError(err)
          setLoading(false)
        }
      )
    }, LISTENER_DELAY_MS)

    return () => {
      clearTimeout(timer)
      unsub?.()
    }
    // Re-subscribe when path changes. Constraints are stable per call site
    // (each component always passes the same set of where/orderBy clauses).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  return { data, loading, error }
}

export function useDocument<T = DocumentData>(
  path: string | null
): UseDocumentResult<T> {
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
          setError(err)
          setLoading(false)
        }
      )
    }, LISTENER_DELAY_MS)

    return () => {
      clearTimeout(timer)
      unsub?.()
    }
  }, [path])

  return { data, loading, error }
}
