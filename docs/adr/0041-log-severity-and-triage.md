# ADR-0041: Log severity is decided by who can cause the failure

**Status:** Accepted

**Date:** 2026-07-26

## Context

Both Firebase projects have a single Cloud Monitoring policy that pages on
`severity>=ERROR` from any Cloud Run revision. That makes the choice
between `logger.warn` and `logger.error` an *alerting* decision, not a
cosmetic one — every `logger.error` on a reachable path is a pager.

Two alerts on 2026-07-24/26 showed the cost of getting it wrong:

- **Prod.** A kiosk badge tap was rejected as an SDM counter replay. The
  tag crypto and the replay defense both worked exactly as designed: two
  concurrent `verifyTagCheckout` calls carried the same counter, one won
  the Firestore transaction, the other lost. `verify_tag.ts` logged the
  loser at `error`.
- **Staging.** Google's post-deploy URL sweep issued `GET /` against every
  deployed function. firebase-functions answers 400 and logs
  `Invalid request, unable to process.` at ERROR — from inside the
  library, on a path any client on the internet can reach.

Neither was a fault. In both cases the server did the right thing and
paged us for it. The general shape: **anything an untrusted client can
provoke will eventually be provoked**, so routing it to a pager hands
strangers a button that wakes the operator.

The information is still worth keeping. `warn` alone is not a solution
either — nobody reads a severity nobody is notified about.

## Decision

**Severity is chosen by who can cause the entry, not by how bad it
sounds.**

- A failure reachable by client input — malformed payloads, replayed or
  stale tokens, duplicate submits, failed auth, bot scans — logs at
  `warn`. The request was rejected correctly; that is the system working.
- A failure that only *we* can cause — a broken invariant, missing
  configuration, a data shape that should be impossible — logs at
  `error` and keeps paging. `Token has no userId` is the canonical
  example: no client can produce it.
- Third-party libraries that log client-triggerable junk at ERROR and
  cannot be changed are excluded in the alert-policy filter instead.

**Real error records come from the client.** The web app reports failed
calls through `reportRpcError` → the `logClientError` callable, which
carries a per-tab `sessionId`, the RPC path, and the error code. The
client knows things the server cannot infer — which browsing context it
was, whether the user saw a failure — and that record, not the server's
rejection log, is what debugging actually runs on.

**Warnings are reviewed in batch, never paged.** Two layers:

1. `dailyLogDigest` (07:00 Europe/Zurich) mails a grouped 24h summary.
   Grouping keys on `(severity, first message line)` with services as a
   *property* of a group, masks volatile identifiers, and drops
   message-less rows. Quiet days send nothing.
2. `/log-triage` is the judgment layer: it reads the same grouped summary,
   decides new-versus-recurrence, and files or updates issues in the
   **private** operations repo. It mails only for genuinely new findings.

Triage output goes to `oww-maco-operations`, never `machine-auth`. Log
payloads carry `userId`, `tokenId`, bill ids and email addresses;
`machine-auth` is public.

Grouping lives in `@oww/shared` (`log-triage.ts`) so the scheduled
function and the local tooling produce **identical fingerprints** — that
identity is what lets triage match a finding against an issue it already
opened.

## Consequences

**Pros:**
- A pager firing now means something we control actually broke.
- No external party can page the operator by malforming a request.
- Client-side records carry context the server never had; the per-tab
  `sessionId` distinguishes "one context retried" from "two contexts
  raced", which server logs alone could not settle.
- One shared grouping implementation, so digest and triage agree.
- Filing into a private repo makes triage output safe by construction.

**Cons:**
- A genuine regression that only manifests as a rejected client request
  is now noticed within a day rather than within minutes. Accepted: such
  a regression also shows up as failing user journeys.
- Every new handler needs an explicit judgment about who can trigger each
  failure. It is a rule people must apply, not one the compiler enforces.
- `known-benign.json` is a suppression list, and suppression lists rot.
  Entries carry `addedOn` so stale ones can be spotted; only humans may
  add to it — `/log-triage` may propose, never commit.
- The triage loop runs on the operator's machine, so it stops when that
  machine does.

**Tradeoffs (rejected alternatives):**
- *Keep logging at error and tune the alert filter*: pushes the whole
  policy into a Cloud Monitoring filter string that is invisible from the
  code, unversioned alongside it, and duplicated per project. Severity at
  the call site is the readable place for the decision.
- *Accept-equal-counter-within-N-seconds on the server* (the direct fix
  for the replay alert): would hand a captured SDM URL a real session
  inside that window — exactly what counter monotonicity exists to
  prevent. The duplicate submit is a client bug and belongs there.
- *A smarter static digest*: tried first. One deploy sweep still produced
  42 rows across 40 services, because the needed judgment is
  "is this new, is this yesterday's recurrence, does this need action" —
  which no grouping rule can express.
- *Scheduled cloud agent / GitHub Actions cron for triage*: more reliable
  than a local loop, but needs a GCP identity (Workload Identity
  Federation) and a bot GitHub identity before it can read logs or file
  issues. Deferred, not rejected — the local loop can move there without
  changing the command.
- *Weekly instead of daily triage*: rejected while the categories are new.
  Seeing a bad pattern within a day beats seeing it six days late; the
  cadence can be relaxed once it is boring.
