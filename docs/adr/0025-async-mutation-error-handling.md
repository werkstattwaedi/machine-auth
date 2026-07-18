# ADR-0025: Async mutation error handling in web apps

**Status:** Accepted

**Date:** 2026-04-30

## Context

Web async writes used inconsistent error handling: a typed Firestore
wrapper (`useFirestoreMutation`), hand-rolled `try/catch` + `toast`,
and bare promises with no error path. The bare-promise sites silently
dropped failures — `checkout-wizard.tsx#handleSubmit` flipped
`submitting=false` on a thrown callable, leaving the user staring at a
half-rendered wizard with money state in limbo. Failed writes never
reached Cloud Logging, unlike read errors which already flow through
`reportQueryError`. Issue #144 / launch-readiness finding A1.

## Decision

All async writes in the web apps go through a single hook,
`useAsyncMutation` (`web/modules/hooks/use-async-mutation.ts`). It
wraps any `() => Promise<T>` (Cloud Function callable, raw Firestore
op, multi-write composite). `useFirestoreMutation` is now a thin
wrapper that adds audit fields and accepts typed Firestore refs; its
public surface (`set` / `add` / `update` / `remove` / `mutate`, plus
`loading` / `error`) is unchanged.

### Toast contract

- The hook owns the toast. Callers MUST NOT add their own
  `toast.error(...)` after `await mutate(...)` — that double-toasts.
- On success: optional `successMessage` toast. Omit for silent
  success when the UI already updates from a Firestore subscription.
- On failure: a German `toast.error(...)` derived from
  `FirebaseError.code` / `FunctionsError.code` via
  `firebaseErrorToGerman()` (covers `permission-denied`,
  `unauthenticated`, `unavailable`, `deadline-exceeded`,
  `not-found`, `already-exists`, `resource-exhausted`, `internal`,
  `cancelled`); unknown codes fall back to the caller's
  `errorMessage` option.

### Retry / disabled-state contract

- The hook re-throws the original error after toast and telemetry
  fire. `await mutate(...)` therefore short-circuits, and callers
  MUST NOT advance UI state on caught errors.
- The hook's `loading` flag flips back to `false` on failure, so a
  disabled submit button re-enables for retry without caller
  bookkeeping.
- Callers may render `state.error.message` inline (e.g. an `Alert`
  banner above a form) and call `reset()` to clear it.

### Telemetry contract

- Every failure fires fire-and-forget to the existing `logClientError`
  Cloud Function with the same payload shape as `reportQueryError`:
  `{ sessionId, context, code, message, path, userAgent }`.
- `context` is a fixed identifier supplied at hook construction —
  e.g. `"checkout.closeAndPay"`, `"firestore.write"`,
  `"admin.createUser"`. It MUST NOT contain user-specific values
  (emails, IDs, tag UIDs).
- `message` is truncated to 200 chars before sending; `logClientError`
  is the second line of redaction server-side.
- A telemetry failure MUST NOT recurse or affect the re-thrown
  original error.
- The same contract covers background *reads* whose failures degrade
  to an empty UI instead of a toast: `reportQueryError`
  (`web/modules/lib/firestore.ts`) for Firestore listeners and
  `reportRpcError` (`web/modules/lib/rpc.ts`) for fetch-and-degrade
  RPCs (e.g. the pending-invites banner). A `catch` that renders a
  fallback state MUST report through one of these — a swallowed error
  once hid a missing-index outage entirely (family-invite incident,
  2026-07).

## Consequences

**Pros:**
- One place owns the toast + telemetry + re-throw contract; new code
  picks it up by default.
- B5 (silent submit failure on `checkout-wizard.tsx`) is fixed: clear
  toast, inline banner, button re-enables for retry.
- Failed writes now reach Cloud Logging, matching the pre-existing
  behaviour for read errors.
- Code-specific German error messages (e.g. `"Keine Berechtigung..."`
  for `permission-denied`) for free across all callers.

**Cons:**
- A single `useAsyncMutation` instance inside `useFirestoreMutation`
  means concurrent writes from the same hook share `loading` /
  `error` state. Matches pre-existing behaviour, so no caller breaks.

**Tradeoffs:**
- **Error boundary instead of toast + inline alert.** Rejected — would
  unmount the wizard and lose the user's entered checkout state.
- **Migrate every call site in this PR.** Rejected — keeping the PR
  reviewable matters; remaining sites are tracked in a follow-up.
- **Allowlist of telemetered codes / message redaction by code.**
  Deferred — tighten only if user data is observed leaking through.
