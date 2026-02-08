// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react"
import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type QueryConstraint,
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

export function useCollection<T = DocumentData>(
  path: string,
  ...constraints: QueryConstraint[]
): UseCollectionResult<T> {
  const [data, setData] = useState<(T & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const ref = collection(db, path)
    const q = constraints.length > 0 ? query(ref, ...constraints) : ref

    return onSnapshot(
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
    // Re-subscribe when path changes
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

    const ref = doc(db, path)

    return onSnapshot(
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
  }, [path])

  return { data, loading, error }
}
