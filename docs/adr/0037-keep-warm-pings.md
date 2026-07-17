# ADR-0037: Keep-warm pings for grouped dispatchers and the api function

**Status:** Accepted

**Date:** 2026-07-17

## Context

ADR-0028 grouped ~20 user-facing callables into four domain dispatchers
(`authCall`, `membershipCall`, `billingCall`, `catalogCall`) so a session
reuses one warm instance per domain. That fixed the *within-session* cold
starts, but the *first* hit of the day (or after ~15 idle minutes) still
pays a full container boot — noticeable on the login page, at checkout
payment, and on the first tag check-in through the gateway's `api` function.

`minInstances` remains rejected on cost: one always-on idle instance bills
continuously (CHF 2–5/month per function), which is worse than the problem.
Cloud Run gives no other keep-alive primitive — an instance stays warm an
unpredictable ~15 minutes after its last request. Periodic requests are
therefore the only free-tier keep-alive mechanism.

## Decision

**Ping when we know a call is imminent, not on a fixed schedule.**

1. **Server:** `dispatchRpc` (functions/src/rpc/dispatch.ts) answers
   `method: "ping"` centrally with `{ ok: true }` before the handler lookup,
   so all four dispatcher groups support it. The ping deliberately runs
   before any per-handler auth — an unauthenticated ping still boots the
   container, which is the entire point — and returns no data. The `api`
   HTTP function gets an equivalent `GET /ping` route behind its bearer-key
   middleware.
2. **Web:** `prewarm(functions, group)` in `web/modules/lib/rpc.ts` fires a
   fire-and-forget ping, deduped per group for a few minutes. UI surfaces
   that know a dispatcher call is imminent call it on mount:
   - login page (shared) → `authCall`
   - kiosk check-in sign-in → `authCall`
   - checkout wizard → `billingCall` (warm before `closeCheckoutAndGetPayment`)
   - admin materials page → `catalogCall`
   Prewarm errors are swallowed; a failed warm must never surface in the UI.
3. **Gateway:** during workshop opening hours the gateway pings
   `/api/ping` every 10 minutes (`maco_gateway/maco_gateway/warm.py`),
   so the first tag check-in of the day is warm. The window is a simple
   weekly `WARM_SCHEDULE` env value (e.g. `Mon-Sun 08-22`, from
   `gateway.warmSchedule` in the operations config); empty disables it.
   Vacations are deliberately not modeled — pings are effectively free
   (well inside the 2M/month invocation free tier), and when the workshop
   Pi is off they stop anyway.

## Consequences

- Cold starts move off the interactive path for the covered surfaces at
  ~zero cost (a ping is one no-op invocation).
- The `ping` method name is reserved: no dispatcher handler may be
  registered under it.
- The dispatcher ping is unauthenticated **and unrate-limited**: anyone can
  invoke the four callables with `{method:"ping"}` at arbitrary volume. The
  exposure is invocation count/cost only (no data, no Firestore access, no
  payload processing) and is accepted per the project's cost posture
  (CLAUDE.md: watch the dashboard, fix the offending path if a quota is
  breached, no pre-emptive mitigation). If ping-flood cost ever shows up on
  the dashboard, the first lever is per-IP throttling in front of the
  dispatchers, not removing the warm path.
- The client must tolerate servers without ping support (rolling deploys):
  `prewarm` swallows all errors, so deploy ordering is soft — functions
  first is preferred but not required for correctness.
- Warming is best-effort. An instance may still be recycled between ping
  and use; the ping only makes a warm hit likely, not guaranteed.

## See also

- ADR-0028 — grouped callable dispatchers (the structural half of the
  cold-start mitigation; this ADR adds the temporal half).
