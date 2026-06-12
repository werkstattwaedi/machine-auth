# ADR-0029: Concurrent family-member checkouts — account-less family members

**Status:** Proposed

**Date:** 2026-06-09 (revised 2026-06-12)

## Context

A checkout can be started for a group: a `CheckoutEntity`
(`functions/src/types/firestore_entities.ts`) carries a
`persons: CheckoutPersonEntity[]` roster, and each roster entry may carry a
`userRef` linking the visit to a real `/users/{userId}` account — including
family members picked from the signed-in user's family roster
(the `familyCandidates` quick-add in
`web/apps/checkout/src/components/checkout/wizard-context.tsx`, issue #209).

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

### Accounts, account-less users, and tokens

Two existing data-model facts turn out to be load-bearing:

- `UserEntity.email` is `string | null` — **null for accounts without Firebase
  Auth credentials** (`functions/src/types/firestore_entities.ts`). A user with
  `email === null` has no login and cannot sign in to the checkout app at all.
- `TokenEntity.userId` is a **non-optional** `DocumentReference` to
  `/users/{userId}`, and tokens are **admin-created only** (`/tokens/{tokenId}`
  in `firestore/firestore.rules` is admin read/write). Combined with the
  product rule confirmed in review — **users with tokens MUST have an
  account** — every badge holder is an account-holder.

### Why the originally-proposed detection had to be server-side

The first draft of this ADR proposed detecting "is this `userRef` already
active on another open checkout?" That requires reading checkouts owned by
*other* users. Owner-scoped Firestore rules deliberately forbid that (the B2
launch-readiness incident — cross-user `checkouts` read leak — is guarded by
`web/modules/test/cross-user-rules.integration.test.ts`), so the guard would
have had to be an admin-privileged Cloud Function callable plus a
denormalized index. During review a simpler alternative was proposed and
adopted; the original design is recorded under *Tradeoffs* below.

This ADR records the **decision and rules** for issue #432. It is design-only:
the enforcement code is deferred to follow-up issues (see *Consequences →
Phasing*).

## Decision

### Core rule: only account-less family members are rostered

A family member can be included in another person's checkout roster **as long
as they don't have an account. Once they have one, they can't be rostered** —
they check in and out on their own account instead.

- **"Account-less" means account absence, not age.** Eligibility is defined by
  `email === null` (no login credentials), explicitly **not** by
  `userType == "kind"`. An account-less adult is rosterable; a child who has
  been given an account is not. `userType` plays no role in the rule.
- **Account-holders always act on their own behalf.** Two account-holding
  family members visiting together each start their own checkout and check out
  separately. There is no value in batching them onto one roster, and allowing
  it is what created the concurrency problem in the first place.
- **Guests-by-name are unaffected.** A walk-in guest added by typing a name has
  no `userRef` at all (`personLocalToDoc` in `wizard-context.tsx` only sets
  `userRef` when a `userId` is present) and is outside this rule. "Add a person
  who doesn't have an account" remains fully supported — that is the common
  case.

### Why this dissolves the hard problem

The original failure modes 2 and 3 ("rostered user starts their own checkout"
and "owner adds an already-active user") both reduce to "a rostered person can
independently act elsewhere." Under the adopted rule they become **impossible
by construction** rather than detected-and-blocked:

- An account-less person has no login → cannot start or own a checkout → can
  never be active on a second checkout as owner.
- An account-holder can never appear as a roster `userRef` → can never be
  "rostered here and active there."

No cross-user query is ever needed to validate a roster.

### Rules

- **R1 — Rostered `userRef`s must be account-less (server-authoritative,
  local check).** At checkout create/close
  (`functions/src/invoice/close_checkout_and_get_payment.ts` path), reject any
  `persons[].userRef` that resolves to a user with an account
  (`email !== null`). This is a single-document lookup per rostered user — no
  cross-user query, no new callable, no index — and stays entirely inside the
  owner-scoped-rules invariant.

- **R2 — Independent badge usage by a rostered person: resolved by
  construction.** Badge/token holders MUST have an account
  (`TokenEntity.userId` non-optional; tokens admin-created only), and rostered
  members are account-less. Therefore a rostered member can never tap their own
  badge and produce independently-attributed usage — the attribution question
  the first draft left open does not arise. The invariant **"token holders are
  account-holders"** is load-bearing for this and must be preserved by any
  future token-issuance change.

- **R3 — Closed checkouts never block (unchanged).** Same-day return (a new
  checkout after the prior one closed) remains fully supported and continues to
  rely on `entryFeeWaivedToday` for fee correctness. R1 is about *who may be
  rostered*, not about prior visits.

### Enforcement placement

- **Authoritative guard (server):** the local account-less validation (R1) in
  the checkout create/close path under `functions/src/invoice/`. Single-doc
  reads of `/users/{userId}` for each rostered `userRef`.
- **Client UX (advisory):**
  - Filter the family quick-add candidates (`familyCandidates` in
    `web/apps/checkout/src/components/checkout/wizard-context.tsx`) to
    account-less members; show account-holding members **disabled** with a
    hint that they check in on their own account, so the restriction is
    discoverable rather than surprising.
  - An advisory guard in
    `web/apps/checkout/src/components/checkout/validation.ts` rejecting a
    roster person whose `userRef` points at an account-holder — fast feedback
    only, not the source of truth.

## Consequences

**Pros:**
- Failure modes 2–3 are impossible by construction instead of
  detected-and-blocked — no cross-user state to query, denormalize, or keep
  consistent.
- No new admin-privileged read surface: everything stays inside owner-scoped
  rules, so the B2 cross-user-read regression net
  (`web/modules/test/cross-user-rules.integration.test.ts`) needs no changes.
- R2 is *resolved*, not deferred: the open product decision from the first
  draft (usage attribution for rostered badge-holders) evaporates.
- The same-day-return flow (`entryFeeWaivedToday`) is explicitly untouched.
- Names two load-bearing invariants for future code: "rostered `userRef`s are
  account-less" and "token holders are account-holders."

**Cons / accepted cost:**
- Account-holding family members visiting together each run their own checkout
  and receive their own bill — group billing across account-holders is given
  up. Entry-fee dedup for such visits is already handled independently by
  `entryFeeWaivedToday`, so the practical loss is "two adults, one bill," which
  review judged to have no practical value.
- Promoting an account-less family member to a full account (giving them an
  email/login) silently changes their roster eligibility; the disabled-with-hint
  UI mitigates the surprise.

**Tradeoffs:**
- **Adopted: restrict rostering vs. rejected: detect-and-block active
  participation.** The first draft defined "active participation" (owner or
  roster member of any open checkout) and enforced it with a cross-user,
  server-authoritative callable guard, a denormalization
  (`activeParticipantRefs: DocumentReference[]` or a per-user open-checkout
  pointer), and a new Firestore index for "open checkouts containing
  `userRef`." That design was rejected because it added a new cross-user
  admin-read surface that must be kept consistent with the B2 regression net,
  write amplification and staleness bookkeeping on every roster change, a new
  index, and an extra round-trip / cold-start on the add-person and
  start-checkout paths — all to guard a situation the adopted rule makes
  impossible with one local single-document check.
- **Account absence vs. `userType == "kind"` as the eligibility criterion.**
  Keying on `email === null` rather than the child user type keeps the rule
  honest: an account-less adult is rosterable, and a child with an account is
  not. `userType` describes pricing/fee category, not authentication
  capability.
- **Hard-block vs. auto-merge (retained from the first draft).** Even in the
  rejected design, merging two independently-started checkouts after the fact
  was ruled out as error-prone; the issue body asks to *prevent* the
  situation, not merge it. The adopted rule prevents it earlier still — at
  roster-eligibility time.

### Phasing

This ADR (phase 1) is design-only and ships on its own. Phase 2 — tracked as
follow-up issues, **not** part of this PR — consists of:

- Candidate filtering in `wizard-context.tsx` (account-less only;
  account-holders shown disabled with a "checks in on their own account" hint).
- The advisory client guard in `validation.ts`, with Vitest unit tests beside
  it.
- The local server-side R1 check at checkout create/close, with a Mocha
  integration test under `functions/test/integration/`.

No changes to owner-scoped Firestore rules are needed, so no additions to
`web/modules/test/cross-user-rules.integration.test.ts` are required.
