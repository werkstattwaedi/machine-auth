# ADR-0028: Grouped callable dispatchers + europe-west6 region

**Status:** Accepted

**Date:** 2026-06-01

## Context

Two related sources of user-facing latency on the web apps (#211, #277):

1. **Region.** All Cloud Functions defaulted to `us-central1`. Every call —
   warm or cold — paid ~100–150 ms transatlantic RTT for our Swiss users.
2. **Cold starts.** We had ~58 deployed functions, of which ~20 are
   user-facing `onCall` callables (login, membership, checkout/billing,
   catalog). Each callable saw little traffic, so almost every web action hit
   a cold start. The remaining functions are Firestore/Auth triggers and
   scheduled jobs: they run in the background, **cannot** be merged behind a
   dispatcher (each event source needs its own registration), and their cold
   starts don't affect interactive latency.

`minInstances`/keep-warm was off the table at ~20 functions (paying to keep
each warm is not justified — see the cost note below).

## Decision

### Region — europe-west6, set globally

A single `setGlobalOptions({ region: "europe-west6" })` in
`functions/src/options.ts`, imported as the **first** statement of
`functions/src/index.ts`. Per-function `region:` options were removed; the
global is now the single source.

Import order is load-bearing: `firebase-functions` (v2) computes each
function's `__endpoint` **eagerly** when `onCall`/`onRequest`/`onSchedule`
runs, reading the global options at that moment. `index.ts` re-exports its
function modules, and ES modules evaluate those dependencies *before* the
`index.ts` body — so the region must be set in a module that evaluates first.
`import "./options"` as the first line guarantees that.

Client side targets the same region: `getFunctions(app, "europe-west6")`, the
gateway `firebaseUrl`, and the test/env fixtures. The production region lives in
the operations repo config (`firebase.region`, `gateway.firebaseUrl`).

### Grouping — four domain dispatchers

The ~20 user-facing callables collapse into **four** grouped `onCall`
functions, one per domain:

| Dispatcher | Methods |
|---|---|
| `authCall` | createUser, requestLoginCode, verifyLoginCode, verifyMagicLink, resolveTag, verifyTagCheckout |
| `membershipCall` | purchase/invite/accept/reject/revoke/remove/createChild/cancel/cancelAutoRenew + the two admin ops |
| `billingCall` | getInvoiceDownloadUrl, getPaymentQrData, closeCheckoutAndGetPayment, acknowledgeBill |
| `catalogCall` | upsertCatalogItem, getPriceListPdfUrl |

The wire contract is a `{ method, payload }` envelope. `dispatchRpc`
(`functions/src/rpc/dispatch.ts`) looks the method up in a per-group handler
map and invokes it with a **synthetic request** — the real `CallableRequest`
spread with `data` swapped for the payload. This preserves the verified
`auth`, `rawRequest`, and the `HttpsError` error contract, so the former
`onCall` bodies are reused **unchanged**: each `export const X = onCall(opts,
fn)` became `export const Xhandler = fn`, with the per-callable secrets/memory
options lifted to the owning dispatcher.

**Pooling traffic is the whole point:** a session that logs in, opens
membership, then checks out reuses a few warm dispatcher instances instead of
cold-starting ~6 separate functions.

### What stays separate

- **`logClientError`** stays a standalone `onCall`. It's the unauthenticated,
  fire-and-forget error reporter and must not depend on a dispatcher that may
  itself be failing.
- **Triggers and scheduled jobs** stay individual functions (only their region
  changed). They can't be merged and don't affect interactive latency.

### Client wrapper

`web/modules/lib/rpc.ts` exposes `rpcCallable(functions, group, method)`, which
mirrors `httpsCallable` (returns `Promise<HttpsCallableResult<Res>>`, so call
sites still read `.data`). All web call sites route through it; the method
strings mirror the original callable names. `logClientError` is the one
exception — it keeps calling `httpsCallable` directly.

## Consequences

**Pros:**
- Fewer cold starts on interactive paths (shared warmth per domain), and
  europe-west6 removes transatlantic RTT on every call.
- The pure-handler split that already existed made the refactor mechanical and
  low-risk; handler bodies and their tests are unchanged.
- `rpcCallable` + the per-group handler maps are a single chokepoint for the
  method-name registry.

**Cons:**
- Per-endpoint metrics collapse into four functions. Recover granularity with
  log-based metrics on the logged `method` field (`dispatchRpc` logs
  `{ group, method }`).
- One deploy surface per domain: a bad deploy affects a whole group. Acceptable
  at this scale (all functions already deploy together).
- A typo'd method string type-checks but throws `not-found` at runtime. Keep
  the call-site method strings aligned with the dispatcher handler-map keys.

**Cost:** grouping + the region move add ~$0/mo (traffic stays inside the Cloud
Run free tier). Consolidation does change the keep-warm calculus: pinning ~20
callables was never worth it, but `minInstances=1` on just the 1–2 hottest
dispatchers is now cheap (single-digit $/mo, a bit more in Zurich's Tier-2
region). Ship grouping + region first, measure cold-start frequency, and only
then pin what still goes cold.

## Tradeoffs / alternatives considered

- **One mega-dispatcher** for all callables. Warmest and simplest client, but
  loses per-domain console metrics and couples unrelated domains in one deploy.
  Rejected in favour of four domain groups, which keep the mental model the
  team already uses while still collapsing 20 → 4.
- **`onRequest` + Express + manual ID-token verification** (like the device
  `api`). Rejected: `onCall` gives verified `request.auth`, CORS, and the
  client SDK ergonomics for free; the web callables all rely on the auth
  context.
- **`minInstances` on the existing functions.** Rejected on cost at ~20
  functions; reconsidered as a cheap, optional follow-up now that there are
  only four dispatchers (see cost note).
