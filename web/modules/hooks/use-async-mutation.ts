// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Generic async mutation primitive for the web apps. Wraps any
 * `() => Promise<T>` (Cloud Function callable, raw Firestore op, or
 * multi-write composite) with the project's unified error-handling
 * contract (ADR-0025):
 *
 * - On success: optional German `successMessage` toast.
 * - On failure:
 *   1. Map `FirebaseError` / `FunctionsError` codes to a localized
 *      German message via `firebaseErrorToGerman()`.
 *   2. Show a `toast.error(...)` via `sonner`.
 *   3. Fire-and-forget telemetry to the `logClientError` Cloud Function
 *      with the same payload shape as `reportQueryError` in
 *      `web/modules/lib/firestore.ts`.
 *   4. Set `state.error` so callers may render an inline retry hint.
 *   5. **Re-throw** the original error so `await mutate(...)` callers
 *      naturally short-circuit and do NOT advance UI state.
 *
 * `useFirestoreMutation` is a thin wrapper over this hook that adds
 * audit fields and forwards Firestore-specific operations.
 */

import { useState, useCallback } from "react"
import { httpsCallable, type Functions } from "firebase/functions"
import { toast } from "sonner"
import { useFunctions } from "../lib/firebase-context"
import { getClientSessionId } from "../lib/client-session"

/** Structured error returned by `useAsyncMutation`. */
export interface MutationError {
  /** `FirebaseError`/`FunctionsError` code, or `"unknown"` for plain Errors. */
  code: string
  /** German message suitable for showing to the user. */
  message: string
  /** Original error thrown by the wrapped function. */
  originalError: unknown
}

export interface UseAsyncMutationOptions {
  /**
   * Telemetry context string, e.g. `"checkout.closeAndPay"` or
   * `"firestore.write"`. Stored as the `context` field in
   * `logClientError` so server-side logs can be filtered by feature.
   * MUST NOT contain user-specific values (emails, IDs).
   */
  context: string
  /** Toast on success. Omit for silent success. */
  successMessage?: string
  /** Fallback toast message when the error code has no localized mapping. */
  errorMessage?: string
}

interface MutationState {
  loading: boolean
  error: MutationError | null
}

/** Truncate length for telemetry message field. App-level errors could
 * theoretically contain user data; server-side `logClientError` is the
 * second line of defence, but truncating keeps log entries bounded. */
const MESSAGE_MAX = 200

interface FirebaseLikeError {
  code?: unknown
  message?: unknown
  name?: unknown
}

/** Best-effort code extractor for `FirebaseError` / `FunctionsError` /
 * generic `Error`. */
function extractCode(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as FirebaseLikeError
    if (typeof e.code === "string" && e.code.length > 0) return e.code
    if (typeof e.name === "string" && e.name.length > 0 && e.name !== "Error") {
      return e.name
    }
  }
  return "unknown"
}

function extractMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as FirebaseLikeError
    if (typeof e.message === "string" && e.message.length > 0) return e.message
  }
  return String(err)
}

/**
 * Map a Firebase / Functions error code to a German toast message.
 * Falls back to `fallback` for unknown codes (which is the caller's
 * `errorMessage` option, or a generic message).
 */
export function firebaseErrorToGerman(
  code: string,
  fallback: string,
): string {
  switch (code) {
    case "permission-denied":
      return "Keine Berechtigung für diese Aktion."
    case "unauthenticated":
      return "Bitte melde dich an und versuche es erneut."
    case "unavailable":
      return "Verbindung zum Server fehlgeschlagen. Bitte erneut versuchen."
    case "deadline-exceeded":
      return "Die Anfrage hat zu lange gedauert. Bitte erneut versuchen."
    case "not-found":
      return "Der Eintrag wurde nicht gefunden."
    case "already-exists":
      return "Der Eintrag existiert bereits."
    case "resource-exhausted":
      return "Zu viele Anfragen. Bitte später erneut versuchen."
    case "internal":
      return "Interner Serverfehler. Bitte erneut versuchen."
    case "cancelled":
      return "Die Anfrage wurde abgebrochen."
    default:
      return fallback
  }
}

/** Fire-and-forget telemetry to the `logClientError` callable. Mirrors
 * `reportQueryError` in `web/modules/lib/firestore.ts`. */
function reportMutationError(
  functions: Functions,
  payload: {
    context: string
    code: string
    message: string
    path: string
  },
): void {
  const sessionId = getClientSessionId()
  // eslint-disable-next-line no-console
  console.error("[mutation] error", { ...payload, sessionId })

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
      context: payload.context,
      code: payload.code,
      message: payload.message.slice(0, MESSAGE_MAX),
      path: payload.path,
      userAgent:
        typeof navigator !== "undefined" ? (navigator.userAgent ?? "") : "",
    }).catch(() => {
      // Swallow: telemetry failure must not recurse.
    })
  } catch {
    // Swallow synchronous init errors for the same reason.
  }
}

export interface UseAsyncMutationResult<T> {
  /**
   * Execute the wrapped `fn`. Resolves to its return value on success;
   * re-throws the original error on failure (after toast + telemetry).
   * Optional `path` is forwarded as the `path` field in telemetry —
   * useful for Firestore writes; pass `""` (or omit) otherwise.
   */
  mutate: (fn: () => Promise<T>, path?: string) => Promise<T>
  loading: boolean
  error: MutationError | null
  /** Clear the `error` state (e.g. after the user dismisses a banner). */
  reset: () => void
}

export function useAsyncMutation<T = void>(
  options: UseAsyncMutationOptions,
): UseAsyncMutationResult<T> {
  const functions = useFunctions()
  const [state, setState] = useState<MutationState>({
    loading: false,
    error: null,
  })

  const reset = useCallback(() => {
    setState({ loading: false, error: null })
  }, [])

  const mutate = useCallback(
    async (fn: () => Promise<T>, path: string = ""): Promise<T> => {
      setState({ loading: true, error: null })
      try {
        const result = await fn()
        setState({ loading: false, error: null })
        if (options.successMessage) toast.success(options.successMessage)
        return result
      } catch (err) {
        const code = extractCode(err)
        const rawMessage = extractMessage(err)
        const fallback =
          options.errorMessage ?? `Fehler: ${rawMessage}`
        const message = firebaseErrorToGerman(code, fallback)

        const structured: MutationError = {
          code,
          message,
          originalError: err,
        }
        setState({ loading: false, error: structured })
        toast.error(message)

        // Telemetry is fire-and-forget — never let it interfere with
        // re-throwing the original error.
        try {
          reportMutationError(functions, {
            context: options.context,
            code,
            message: rawMessage,
            path,
          })
        } catch {
          // ignored
        }

        throw err
      }
    },
    [functions, options.context, options.successMessage, options.errorMessage],
  )

  return {
    mutate,
    loading: state.loading,
    error: state.error,
    reset,
  }
}
