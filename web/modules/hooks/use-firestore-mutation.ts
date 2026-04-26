// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Canonical write API for the web apps. All mutations go through typed
 * `DocumentReference<T>` / `CollectionReference<T>` from
 * `firestore-helpers.ts` — never raw string paths. Audit fields
 * (`modifiedBy`, `modifiedAt`) are stamped automatically on every write.
 */

import { useState, useCallback } from "react"
import {
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore"
import { useAuth } from "../lib/auth"
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
    <T extends DocumentData>(data: T): T & DocumentData => ({
      ...data,
      modifiedBy: user?.uid ?? null,
      modifiedAt: serverTimestamp(),
    }),
    [user],
  )

  const mutate = useCallback(
    async <R = void>(
      fn: () => Promise<R>,
      options?: MutationOptions,
    ): Promise<R> => {
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
    [],
  )

  const set = useCallback(
    <T extends DocumentData>(
      ref: DocumentReference<T>,
      data: T,
      options?: MutationOptions,
    ) =>
      mutate(
        () => setDoc(ref, withAuditFields(data) as T),
        options,
      ),
    [mutate, withAuditFields],
  )

  const add = useCallback(
    <T extends DocumentData>(
      ref: CollectionReference<T>,
      data: T,
      options?: MutationOptions,
    ) =>
      mutate(
        () => addDoc(ref, withAuditFields(data) as T),
        options,
      ),
    [mutate, withAuditFields],
  )

  const update = useCallback(
    <T extends DocumentData>(
      ref: DocumentReference<T>,
      data: Partial<T>,
      options?: MutationOptions,
    ) =>
      mutate(
        () => updateDoc(ref, withAuditFields(data as DocumentData)),
        options,
      ),
    [mutate, withAuditFields],
  )

  const remove = useCallback(
    (ref: DocumentReference, options?: MutationOptions) =>
      mutate(() => deleteDoc(ref), options),
    [mutate],
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
