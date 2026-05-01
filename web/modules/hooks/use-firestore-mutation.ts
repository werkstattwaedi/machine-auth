// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Canonical write API for the web apps. All mutations go through typed
 * `DocumentReference<T>` / `CollectionReference<T>` from
 * `firestore-helpers.ts` — never raw string paths. Audit fields
 * (`modifiedBy`, `modifiedAt`) are stamped automatically on every write.
 *
 * Internally delegates to `useAsyncMutation` (ADR-0025) for the unified
 * toast + telemetry + retry contract. The public surface (`set`, `add`,
 * `update`, `remove`, `mutate`, plus `loading` / `error`) is unchanged.
 */

import { useCallback } from "react"
import {
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type PartialWithFieldValue,
  type WithFieldValue,
} from "firebase/firestore"
import { toast } from "sonner"
import { useAuth } from "../lib/auth"
import { useAsyncMutation, type MutationError } from "./use-async-mutation"

interface MutationOptions {
  successMessage?: string
  errorMessage?: string
}

/** Best-effort `path` extractor for typed Firestore refs — used as the
 * `path` field in telemetry. Both `DocumentReference` and
 * `CollectionReference` expose `.path`. */
function pathOf(ref: { path?: string } | undefined | null): string {
  return ref && typeof ref.path === "string" ? ref.path : ""
}

export function useFirestoreMutation() {
  const { user } = useAuth()
  const inner = useAsyncMutation<unknown>({ context: "firestore.write" })

  const withAuditFields = useCallback(
    <T extends DocumentData>(data: T): T & DocumentData => ({
      ...data,
      modifiedBy: user?.uid ?? null,
      modifiedAt: serverTimestamp(),
    }),
    [user],
  )

  // Wrap the inner mutate to forward the Firestore ref's `path` into
  // telemetry and honour per-call `successMessage`. The inner hook owns
  // the error toast (and re-throws), so we never need to add a
  // try/catch here.
  const runForRef = useCallback(
    async <R>(
      ref: { path?: string } | null | undefined,
      fn: () => Promise<R>,
      options?: MutationOptions,
    ): Promise<R> => {
      const path = pathOf(ref)
      const result = await inner.mutate(async () => {
        const value = await fn()
        if (options?.successMessage) toast.success(options.successMessage)
        return value as unknown
      }, path)
      return result as R
    },
    [inner],
  )

  const mutate = useCallback(
    <R = void>(fn: () => Promise<R>, options?: MutationOptions): Promise<R> =>
      runForRef(null, fn, options),
    [runForRef],
  )

  const set = useCallback(
    <T extends DocumentData>(
      ref: DocumentReference<T>,
      data: WithFieldValue<T>,
      options?: MutationOptions,
    ) =>
      runForRef(
        ref,
        () =>
          setDoc(ref, withAuditFields(data as DocumentData) as WithFieldValue<T>),
        options,
      ),
    [runForRef, withAuditFields],
  )

  const add = useCallback(
    <T extends DocumentData>(
      ref: CollectionReference<T>,
      data: WithFieldValue<T>,
      options?: MutationOptions,
    ) =>
      runForRef(
        ref,
        () =>
          addDoc(ref, withAuditFields(data as DocumentData) as WithFieldValue<T>),
        options,
      ),
    [runForRef, withAuditFields],
  )

  const update = useCallback(
    <T extends DocumentData>(
      ref: DocumentReference<T>,
      data: PartialWithFieldValue<T>,
      options?: MutationOptions,
    ) =>
      runForRef(
        ref,
        () => updateDoc(ref, withAuditFields(data as DocumentData)),
        options,
      ),
    [runForRef, withAuditFields],
  )

  const remove = useCallback(
    (ref: DocumentReference, options?: MutationOptions) =>
      runForRef(ref, () => deleteDoc(ref), options),
    [runForRef],
  )

  // Map the inner hook's structured `MutationError` back to a plain
  // `Error` for the legacy public surface (`error: Error | null`).
  const error: Error | null = inner.error ? errorOf(inner.error) : null

  return {
    loading: inner.loading,
    error,
    set,
    add,
    update,
    remove,
    mutate,
  }
}

function errorOf(err: MutationError): Error {
  if (err.originalError instanceof Error) return err.originalError
  return new Error(err.message)
}
