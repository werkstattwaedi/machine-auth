# ADR-0029: Family-member checkouts — only account-less members can be rostered

**Status:** Accepted

**Date:** 2026-06-12

## Context

A checkout can be started for a group: a `CheckoutEntity`
(`functions/src/types/firestore_entities.ts`) carries a
`persons: CheckoutPersonEntity[]` roster, and each roster entry may carry a
`userRef` linking the visit to a real `/users/{userId}` account — including
family members picked from the signed-in user's family roster via the
quick-add chips (issue #209).

This creates a class of "multi-family-member" failure modes (issue #432).
The same person can be represented twice at the same time:

- once as a **roster person** on someone else's open checkout (via `userRef`), and
- once as the **owner** (`CheckoutEntity.userId`) of their *own* open checkout, and/or
- as the **badge holder** logging independent machine usage against their own user.

Today nothing reconciles these. Concretely, the data model does not prevent:

1. The same `userRef` being a roster person on checkout **A** while
   simultaneously owning a separate open checkout **B**.
2. A person rostered onto checkout A (so the group owner intends to pay for
   them) *also* tapping their own badge at a machine, producing usage that is
   attributed to their own user rather than to checkout A.

### Existing same-day semantics

Same-day participation is already partially modeled. `entryFeeWaivedToday`
(issue #268, `CheckoutPersonEntity.entryFeeWaivedToday`) waives a named
person's daily entry fee when an *earlier closed* checkout already charged
them on the same **Zurich business day**, where the day boundary is **03:00
Europe/Zurich** (see `functions/src/invoice/close_checkout_and_get_payment.ts`
and `functions/src/util/session_expiration.ts`). A person legitimately
*returning* the same day (prior checkout already **closed**) is a normal,
supported flow and must not be blocked.

### The rejected first draft: "single active participation"

The first version of this ADR proposed an invariant of *at most one active
participation per user* (owner or roster member of any `status == "open"`
checkout), enforced by a new server-authoritative callable that queries
across owners. Detecting "is this `userRef` already active elsewhere?"
requires reading checkouts owned by *other* users, which owner-scoped
Firestore rules deliberately forbid (the B2 launch-readiness incident —
cross-user `checkouts` read leak — is guarded by
`web/modules/test/cross-user-rules.integration.test.ts`). That design
therefore needed:

- a new admin-privileged callable on the add-person / start-checkout paths
  (latency + cold-start surface),
- a denormalized `activeParticipantRefs` array or per-user
  "current open checkout" pointer (write amplification, staleness
  bookkeeping),
- a new Firestore index for "open checkouts containing `userRef`", and
- an unresolved product decision on how to attribute independent badge usage
  by a rostered person.

PR #439 review surfaced a structurally simpler alternative, which this ADR
adopts.

## Decision

**Only account-less family members can be rostered onto someone else's
checkout.** A family member who has their own account never appears on
another person's roster — family members visiting together each check in and
out on their own account.

Definitions and rules:

- **Account-less user**: a `/users/{userId}` doc with `email == null` (no
  Firebase Auth sign-in credentials — typically, but not necessarily, a
  child account, `userType == "kind"`). When a family member is added with
  an email, they get their own login; without one, they are account-less.
- **R1 — Roster entries must be account-less (hard block,
  server-authoritative).** A `persons[].userRef` may only reference an
  account-less user. The one exception is the checkout **owner** themselves
  (`userRef.id == CheckoutEntity.userId.id`), whose own roster line
  naturally carries their `userRef`. Once an account-less member is given
  an account, they stop being rosterable.
- **R2 — Badge usage by rostered persons is impossible by construction.**
  Tokens require an account (`TokenEntity.userId` is non-optional and tokens
  are admin-created only), so a badge holder is always an account-holder and
  therefore never rostered on someone else's checkout. The first draft's
  open product question — how to attribute independent machine usage by a
  rostered person — dissolves entirely.
- **R3 — Closed checkouts and guests are unaffected.** Same-day return
  continues to rely on `entryFeeWaivedToday`. Walk-in guests added by typing
  a name (no `userRef`) remain fully supported — the block is specifically
  about rostering a *linked account-holder*.

The original failure modes resolve by construction: an account-less rostered
person has no login, so they cannot start or own a checkout (use cases 2–3 of
the first draft) and cannot hold a badge (use case 1). No cross-user state
needs to be consulted to validate a roster — each entry is checked against a
single user doc.

### Enforcement placement

- **Authoritative server guard (local, single-doc reads):** the
  `closeCheckoutAndGetPayment` callable (both the close-existing and the
  create-and-close paths) rejects with `failed-precondition` when any
  non-owner roster entry's `userRef` resolves to a user with an account
  (non-empty `email`). This is a per-entry single-document lookup
  (`db.getAll`) — **no cross-user query, no denormalization, no index, no
  new callable**. Note the callable's wire payload does not carry
  `userRef`s; the stored open-checkout doc (written client-side by
  `persistPersons`) is the authoritative carrier, so the close path checks
  the stored roster.
- **Client UX guard (advisory):** `buildFamilyCandidates`
  (`web/apps/checkout/src/components/checkout/wizard-context.tsx`) marks
  account-holding co-members; the quick-add chips render them disabled with
  a "checks in with their own account" hint instead of hiding them, so the
  behaviour is discoverable. `validation.ts` additionally flags a rehydrated
  roster that already contains an account-holder (e.g. an open checkout
  created before this rule), blocking advance with a clear message instead
  of failing later at submit.

## Consequences

**Pros:**
- Deletes the entire cross-user enforcement surface of the first draft: no
  admin-privileged callable, no denormalized participant index, no extra
  round-trip on add-person/start-checkout, no new consistency bookkeeping.
- Stays entirely inside owner-scoped Firestore rules — the B2 cross-user-read
  regression net is untouched.
- The independent-usage attribution question (first draft's R2) is closed by
  construction rather than deferred as an open product decision.
- The invariant is locally checkable: validating a roster touches only the
  user docs it references.

**Cons / accepted residual risk:**
- Two account-holding adults visiting together can no longer be paid on one
  bill — each checks out separately. Judged "no practical limitation"; the
  same-day entry-fee dedup concern is independently handled by
  `entryFeeWaivedToday`.
- An account-less member can still be rostered on two *different owners'*
  simultaneously open checkouts (e.g. both parents check the same child in).
  Blocking that would require exactly the cross-user machinery this ADR
  removes. Worst case is a duplicated entry fee — account-less members have
  no badge and no login, so the exposure is bounded at the entry fee — and
  the common same-owner case is already deduped by #268. Accepted.
- Giving a family member an account silently changes how they participate
  (own check-in instead of rostered). The disabled chip + hint makes this
  visible at the point of use.

**Tradeoffs:**
- **Restrict-the-roster vs. reconcile-concurrent-participation.** We chose to
  make the conflicting states unrepresentable instead of detecting and
  blocking them at write time. The cost is flexibility (no mixed
  account-holder rosters); the win is that correctness no longer depends on
  cross-user queries, denormalized state, or merge policies.
- **Disabled chips vs. hidden chips.** Account-holding family members stay
  visible but disabled so users learn the rule in place, rather than
  wondering where a family member went.

### Phasing

The first draft deferred enforcement to follow-up issues because it required
new server machinery and an unresolved product decision. Under the adopted
decision the enforcement shrank to a local server check plus chip filtering,
so it ships **with this ADR in the same PR**, including its regression tests:
Mocha integration tests for the server guard
(`functions/test/integration/close-checkout-and-get-payment.test.ts`), and
Vitest unit tests beside `buildFamilyCandidates` and `validation.ts`.
Owner-scoped Firestore rules are unchanged, so no new cross-user-rules cases
are needed.
