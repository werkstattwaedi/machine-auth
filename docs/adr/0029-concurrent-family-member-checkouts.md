# ADR-0029: Concurrent family-member checkouts — single active participation

**Status:** Proposed

**Date:** 2026-06-09

## Context

A checkout can be started for a group: a `CheckoutEntity`
(`functions/src/types/firestore_entities.ts`) carries a
`persons: CheckoutPersonEntity[]` roster, and each roster entry may carry a
`userRef` linking the visit to a real `/users/{userId}` account — including
child accounts picked from the signed-in user's family roster.

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

The issue body states the two hard constraints directly:

> If they [a secondary family member with their own badge] created their own
> active checkout … we must prevent them from being added to the person
> roster. Similarly, a family member must not be allowed to start a new
> checkout iff there is already one ongoing where they are part of it.

### Existing same-day semantics

Same-day participation is already partially modeled. `entryFeeWaivedToday`
(issue #268, `CheckoutPersonEntity.entryFeeWaivedToday`) waives a named
person's daily entry fee when an *earlier closed* checkout already charged
them on the same **Zurich business day**, where the day boundary is **03:00
Europe/Zurich** (see `functions/src/invoice/close_checkout_and_get_payment.ts`
and `functions/src/util/session_expiration.ts`). This is derived
authoritatively at close time from prior bills — there is no denormalized
"charged today" record.

The interaction matters: a person legitimately *returning* the same day
(prior checkout already **closed**) is a normal, supported flow and must not be
blocked. The thing we want to block is **two simultaneously open** checkouts
that both involve the same person.

### Why detection has to be server-side

Detecting "is this `userRef` already active elsewhere?" requires reading
checkouts owned by *other* users. Owner-scoped Firestore rules deliberately
forbid that (the B2 launch-readiness incident — cross-user `checkouts` read
leak — is guarded by `web/modules/test/cross-user-rules.integration.test.ts`).
Therefore the authoritative guard cannot be a client Firestore query; it must
be a Cloud Function callable that runs with admin privileges. Any client-side
check is UX-only (fast feedback) and is not the source of truth.

This ADR records the **decision framework and proposed rules** for issue #432.
It is design-only: the enforcement code is deliberately deferred to follow-up
issues (see *Consequences → Phasing*), because the merge-vs-attribute policy
(use case 1 below) is a genuine product decision that should be confirmed
before code is written.

## Decision

### Core concept: "active participation"

Define a `userRef` as **actively participating** if it is *either*:

- the **owner** (`CheckoutEntity.userId`) of any checkout with
  `status == "open"`, **or**
- a **roster person** (`persons[].userRef`) on any checkout with
  `status == "open"`.

A user may participate in **at most one open checkout at a time** — as owner
*or* roster member, not both, and not in two of either. A *closed* checkout
never counts as active participation, so same-day return (a new checkout after
the prior one closed) remains allowed and continues to flow through the
existing `entryFeeWaivedToday` logic unchanged.

### Use cases enumerated

1. **Independent usage by a rostered user.** Person P is rostered (via
   `userRef`) on owner O's open checkout; later P taps *their own* badge at a
   machine. The usage is logged against P's user, not O's checkout. **Open
   product decision** — see proposed rule below.
2. **Rostered user starts their own checkout.** P is rostered on O's open
   checkout and then tries to start *their own* checkout (P has an account).
   **Hard-blocked.**
3. **Owner adds an already-active user.** P already owns (or is rostered on)
   their own open checkout; O tries to add P to O's roster. **Hard-blocked.**
4. **Same-day / next-day boundary.** P has a *closed* checkout from a prior
   business day (or earlier the same day) still owing payment, vs. an *open*
   checkout now. Only the **open** checkout counts toward active
   participation; the closed one feeds `entryFeeWaivedToday` and does **not**
   block.
5. **Child vs. adult family members.** A child account
   (`userType == "kind"`, no independent badge/login) cannot start or own a
   checkout, so use cases 2–3 only meaningfully bind for `userType ==
   "erwachsen"`/`"firma"` accounts that have their own badge and login. The
   single-active-participation rule still applies to children for roster
   purposes (a child cannot be rostered onto two open checkouts at once).

### Proposed rules (to be confirmed before phase 2)

- **R1 — Single active participation (hard block, server-authoritative).**
  A callable guard rejects any write that would make a `userRef` active on a
  second open checkout. This covers both use case 2 (P starts their own) and
  use case 3 (O adds P), since both reduce to "make `userRef` active while it
  is already active elsewhere."

- **R2 — Independent usage attribution (recommended default; needs sign-off).**
  When a user who is currently a roster person on someone else's open checkout
  logs independent machine usage via their own badge, **attribute that usage to
  the open checkout they participate in**, and surface it for review at close
  rather than silently creating a second billable record. Rationale: the group
  owner already declared intent to cover that person; splitting their usage
  across two bills is surprising and re-introduces the same double-billing the
  entry-fee waiver was built to prevent. The alternative (hard-block the badge
  tap) is worse UX at the machine. This is the one rule that is a genuine
  product call and is explicitly **not** decided by this ADR.

- **R3 — Closed checkouts never block.** Active participation is scoped to
  `status == "open"`. Same-day return remains fully supported and continues to
  rely on `entryFeeWaivedToday` for fee correctness.

### Enforcement placement

- **Authoritative guard:** a Cloud Function callable (under
  `functions/src/`, dispatched through the appropriate grouped dispatcher per
  ADR-0028) that, given a `userRef` and the target checkout, queries for any
  *other* open checkout where that user is owner or roster person and rejects
  the mutation if found. Runs with admin privileges so it can read across
  owners without violating the owner-scoped Firestore rules.
- **Client UX guard:** `web/apps/checkout/src/components/checkout/validation.ts`
  + `use-checkout-state.ts` give immediate feedback when adding a roster person
  the client already knows is active, but are advisory only.
- **Indexes:** R1 needs an efficient "open checkouts containing `userRef`"
  query. A roster `userRef` lives in an array of objects, which Firestore
  cannot index for membership directly; phase 2 must either denormalize a
  flat `activeParticipantRefs: DocumentReference[]` array on the checkout (for
  `array-contains`) or maintain a per-user "current open checkout" pointer.
  The denormalization choice is left to phase 2.

## Consequences

**Pros:**
- Names the previously-implicit invariant ("a user is in at most one open
  checkout") so future checkout/usage code can rely on it.
- Separates the two *settled* hard-block rules (R1) from the one *unsettled*
  product decision (R2), so phase-2 work can start on R1 without waiting.
- Keeps the same-day-return flow (`entryFeeWaivedToday`) explicitly out of
  scope, avoiding a regression where a legitimate same-day return is blocked.
- Reaffirms that cross-user "active elsewhere" detection must be server-side,
  protecting the B2 cross-user-read regression net.

**Cons:**
- Introduces a new server round-trip (callable guard) on the
  add-person / start-checkout paths, adding latency and a cold-start surface.
- Requires denormalization (a flat participant-refs array or a per-user
  pointer) to query efficiently, which adds write-time bookkeeping and a
  consistency burden whenever a roster changes.
- R2 (usage attribution) remains undecided, so independent-usage reconciliation
  is not closed by this ADR.

**Tradeoffs:**
- **Hard-block vs. auto-merge for a second checkout (use cases 2–3).** We chose
  hard-block because merging two independently-started checkouts after the fact
  (reconciling rosters, usage, payment state) is error-prone and the issue body
  explicitly asks to *prevent* the situation, not merge it. Block-at-creation
  is the simpler, more predictable rule.
- **Attribute vs. hard-block for independent machine usage (R2).** We *propose*
  attribute-to-the-open-checkout rather than blocking the badge at the machine,
  because blocking a member's badge mid-visit is poor UX and the owner already
  signalled intent to cover them. Recorded as a recommendation pending product
  sign-off rather than a decision.
- **Denormalized participant array vs. per-user current-checkout pointer.**
  Deferred to phase 2; both satisfy R1's query, with different write-amplification
  and staleness characteristics.

### Phasing

This ADR (phase 1) is design-only and ships on its own. Phase 2 — the callable
guard (R1), the client UX guard, the chosen denormalization/index, and their
mandatory regression tests (Mocha integration tests under
`functions/test/integration/` for the cross-checkout guard; Vitest unit tests
beside `validation.ts`; cross-user negative cases in
`web/modules/test/cross-user-rules.integration.test.ts` if owner-scoped rules
change) — is tracked as follow-up issues and is **not** part of this PR. R2's
product decision must be confirmed before any usage-attribution code lands.
