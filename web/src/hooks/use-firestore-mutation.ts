// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { useState, useCallback } from "react"
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  serverTimestamp,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuth } from "@/lib/auth"
import { toast } from "sonner"

interface MutationOptions {
  successMessage?: string
  errorMessage?: string
}

interface MutationState {
  loading: boolean
  error: Error | null
}

export function useFirestoreMutation() {
  const { user } = useAuth()
  const [state, setState] = useState<MutationState>({
    loading: false,
    error: null,
  })

  const withAuditFields = useCallback(
    (data: DocumentData): DocumentData => ({
      ...data,
      modifiedBy: user?.uid ?? null,
      modifiedAt: serverTimestamp(),
    }),
    [user]
  )

  const mutate = useCallback(
    async (
      fn: () => Promise<void | DocumentReference>,
      options?: MutationOptions
    ) => {
      setState({ loading: true, error: null })
      try {
        const result = await fn()
        setState({ loading: false, error: null })
        if (options?.successMessage) toast.success(options.successMessage)
        return result
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        setState({ loading: false, error })
        toast.error(options?.errorMessage ?? `Fehler: ${error.message}`)
        throw error
      }
    },
    []
  )

  const set = useCallback(
    (
      path: string,
      id: string,
      data: DocumentData,
      options?: MutationOptions
    ) =>
      mutate(
        () => setDoc(doc(db, path, id), withAuditFields(data)),
        options
      ),
    [mutate, withAuditFields]
  )

  const add = useCallback(
    (collectionPath: string, data: DocumentData, options?: MutationOptions) =>
      mutate(
        () => addDoc(collection(db, collectionPath), withAuditFields(data)),
        options
      ),
    [mutate, withAuditFields]
  )

  const update = useCallback(
    (
      path: string,
      id: string,
      data: DocumentData,
      options?: MutationOptions
    ) =>
      mutate(
        () => updateDoc(doc(db, path, id), withAuditFields(data)),
        options
      ),
    [mutate, withAuditFields]
  )

  const remove = useCallback(
    (path: string, id: string, options?: MutationOptions) =>
      mutate(() => deleteDoc(doc(db, path, id)), options),
    [mutate]
  )

  return {
    ...state,
    set,
    add,
    update,
    remove,
    mutate,
  }
}
