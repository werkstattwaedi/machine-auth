# ADR-0025: Async mutation error handling in web apps

**Status:** Accepted

**Date:** 2026-04-30

## Context

Audit finding A1 from the 2026-04-25 launch-readiness review (issue
#144). The web apps mixed three error-handling styles for async writes:

1. **`useFirestoreMutation`** (`web/modules/hooks/use-firestore-mutation.ts`)
   wrapped Firestore `setDoc` / `addDoc` / `updateDoc` / `deleteDoc`,
   stamped audit fields, toasted success/error via `sonner`. Used by a
   handful of admin pages and `visit.tsx`.
2. **Manual `try/catch` + `toast.error`** in places like
   `admin/create-user-dialog.tsx` and `checkout/usage.tsx` — correct
   but inconsistent (each call site rolls its own message and never
   reports the failure to Cloud Logging).
3. **`try/finally` with NO `catch`** or bare promises in
   `checkout/checkout-wizard.tsx#handleSubmit` (B5 in the launch
   report — silently flips `submitting=false` on a thrown callable),
   `checkout/step-workshops.tsx`, `_authenticated/visit.tsx`'s
   callbacks, `_material/material.add.tsx`. A network blip, a
   permission denial, or a callable timeout left the user staring at
   a half-rendered wizard with money state in limbo.

There was also no telemetry path for write failures: read errors
already flowed through `reportQueryError` in `web/modules/lib/firestore.ts`
to the `logClientError` Cloud Function, but failed mutations never
reached Cloud Logging.

The launch-readiness B5 fix (`checkout-wizard.tsx`) needed a clear
error toast and a "stay in retry state" UX, not yet another bespoke
try/catch. We needed one canonical primitive.

## Decision

All async writes in the web apps go through a single hook,
`useAsyncMutation` (`web/modules/hooks/use-async-mutation.ts`). It
wraps any `() => Promise<T>` (Cloud Function callable, raw Firestore
op, multi-write composite) with the unified contract below.
`useFirestoreMutation` is now a thin delegating wrapper that adds
audit fields and accepts typed Firestore refs; its public surface
(`set` / `add` / `update` / `remove` / `mutate`, plus `loading` /
`error`) is unchanged.

### Toast contract

- The hook owns the toast. Callers MUST NOT add their own
  `toast.error(...)` after `await mutate(...)` — that double-toasts.
- On success: optional `successMessage` toast. Omit for silent
  success (e.g. item add/remove on the visit page where the UI
  already updates from the Firestore subscription).
- On failure: a German `toast.error(...)`. The message is derived
  from `FirebaseError.code` / `FunctionsError.code` via
  `firebaseErrorToGerman()` (covers `permission-denied`,
  `unauthenticated`, `unavailable`, `deadline-exceeded`,
  `not-found`, `already-exists`, `resource-exhausted`, `internal`,
  `cancelled`); unknown codes fall back to the caller's
  `errorMessage` option.

### Retry / disabled-state contract

- The hook re-throws the original error after the toast and telemetry
  fire-and-forget. `await mutate(...)` therefore short-circuits, and
  callers MUST NOT advance UI state on caught errors.
- The hook's `loading` flag flips back to `false` on failure, so a
  disabled submit button re-enables for retry without any caller
  bookkeeping.
- Callers may render `state.error.message` inline (e.g. an `Alert`
  banner above a form) and call `reset()` to clear it.

### Telemetry

- Every failure fires a fire-and-forget call to the existing
  `logClientError` Cloud Function with the same payload shape as
  `reportQueryError` for reads:
  `{ sessionId, context, code, message, path, userAgent }`.
- `context` is a fixed identifier supplied at hook construction —
  e.g. `"checkout.closeAndPay"`, `"firestore.write"`,
  `"admin.createUser"`. It MUST NOT contain user-specific values
  (emails, IDs, tag UIDs).
- `message` is truncated to 200 chars before sending to keep log
  entries bounded. `logClientError` is the second line of redaction
  server-side.
- A telemetry failure (e.g. callable rejected) MUST NOT recurse or
  affect the re-thrown original error.

### Migration

- `useFirestoreMutation`'s public API is preserved verbatim, so the
  ~15 admin and visit-page call sites that already use it gain
  telemetry + better error messages for free.
- Three proof-of-concept refactors land with this ADR:
  - `checkout-wizard.tsx#handleSubmit` (B5 fix — wizard no longer
    silently resets on submit failure; an inline `Alert` shows the
    error message and the submit button re-enables for retry).
  - `admin/create-user-dialog.tsx` (replaces hand-rolled try/catch).
  - `checkout/visit.tsx#confirmUncheckWorkshop` (multi-write
    composite — proves the hook wraps arbitrary closures, not just
    single ops).
- Remaining "no catch" call sites — `step-workshops.tsx`,
  `visit.tsx`'s other callbacks and `toggleWorkshop`,
  `material.add.tsx`, the dynamic-import tag operations in
  `users/$userId.tsx`, `payment-result.tsx`'s legacy fallback — are
  tracked in a follow-up issue. The migration is mechanical now that
  the hook exists.

## Consequences

**Pros:**

- One place owns the toast + telemetry + re-throw contract; new code
  picks it up by default.
- B5 (silent submit failure on `checkout-wizard.tsx`) is fixed: the
  user sees a clear German error toast, an inline banner with the
  structured message, and the submit button is re-enabled for retry.
- Failed writes now reach Cloud Logging, matching the pre-existing
  behaviour for read errors.
- `useFirestoreMutation`'s callers gain code-specific German error
  messages (e.g. `"Keine Berechtigung..."` for `permission-denied`)
  without any caller change.

**Cons:**

- A single shared `inner` `useAsyncMutation` hook inside
  `useFirestoreMutation` means concurrent Firestore writes from the
  same hook instance share `loading` / `error` state. That matches
  the pre-existing behaviour (the previous hook also shared
  `MutationState`), so no caller breaks.
- Per-call `errorMessage` overrides are honoured only as the *fallback*
  string for unknown codes; for known codes the German mapping wins.
  In practice no caller passes `errorMessage` today, and the German
  mapping is more useful than ad-hoc per-call strings.

**Tradeoffs:**

- *Add `errorMessage` to every callable-mapped code.* Rejected as
  premature; the codes covered today are the ones that actually
  surface in the field, and unknown codes fall through to the
  caller's `errorMessage` (or a generic `Fehler: ...`).
- *Use an error boundary instead of toast + inline alert.* Rejected
  for B5 specifically: an error boundary unmounts the wizard, which
  loses the user's entered checkout state. The "stay in failed state"
  contract requires keeping the wizard mounted.
- *Add an allowlist of error codes that get telemetered with full
  message vs. code-only.* Deferred. Today every code goes to
  `logClientError` with the full (truncated) message; if we observe
  user data leaking through we can tighten by code in a follow-up.
- *Migrate every call site in this PR.* Rejected — keeping the PR
  reviewable matters, and the 3 PoC refactors prove the pattern.
  The follow-up issue lists the remaining sites.
