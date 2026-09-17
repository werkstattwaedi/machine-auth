# ADR-0043: The users doc is the canonical identity — Firebase Auth follows it

**Status:** Accepted (amends [ADR-0031](0031-embedded-checkin-signin-and-sms-codes.md): the "verified phone" rule becomes an enforced invariant against `users.phone`; amends [ADR-0029](0029-concurrent-family-member-checkouts.md): a managed member is promoted to a login account through `updateUserEmail`)

**Date:** 2026-09-17

## Context

A member is two records that must agree: `users/{uid}` (profile, roles,
membership, badges, history) and the Firebase Auth account with the same uid
(login identity). Nothing kept their e-mail and phone in sync, and every login
flow resolved by the **Auth** side: `getUserByEmail`, else
`createUser({ email })`. Whenever the two drifted, the next code sign-in minted
a **new uid with no users doc** and the member was split in two — roles,
membership and history on the old uid, the session on the new one.

It happened at least three ways (issue #633):

- an admin edited `users.email` in the profile tab (a plain Firestore write),
- the Auth record disappeared while the doc stayed — the 2026-09
  `cleanupAbandonedCheckouts` incident deleted three members' Auth accounts,
  repaired by hand under the original uid,
- a managed member (ADR-0029: Auth `disabled`, no e-mail) was "promoted" by
  typing an e-mail into the doc; Auth never learned about it.

Phone had the mirror problem. SMS login keys on the number *linked to the Auth
record*; `users.phone` was free text nobody reconciled, so a number changed on
one side either kept routing codes to the old number or reported "no account".

Two facts made a simple design possible. `syncCustomClaims` stamps
`{ admin }` on the first write of every users doc, so an Auth record with **no
custom claims never had a users doc**. And prod data was already clean: a
read-only scan (`scripts/check-user-identity-fields.ts`, 2026-09-17) found all
360 docs with a null-or-E.164 phone, a null-or-normalised e-mail, and no e-mail
shared by two docs — every write path already normalises.

## Decision

1. **`users/{uid}` is the canonical identity.** `users.email` (trim +
   lowercase) is the login e-mail; Auth follows the doc, never the reverse.

2. **Phone invariant.** `users.phone` is the canonical contact number. The Auth
   `phoneNumber` is the *verified login* number and must be `null` or equal to
   `users.phone`. Only the member re-verifying on `/account/profile` sets it;
   any divergence **unlinks** it, pausing SMS login until re-verified. A number
   therefore stops being a login the moment the profile number changes. (A
   number the member gave up but never replaced in their profile stays linked —
   that is inherent to SMS login and not addressed here.)

3. **Login resolves users-doc first** (`resolveLoginUid` in
   `functions/src/auth/identity.ts`): a users doc carrying the verified e-mail
   wins. Auth-by-e-mail is only a fallback for addresses no doc knows, and it
   never returns a uid whose doc names a *different* e-mail — that Auth record
   is stale, so it is moved onto its doc's e-mail and the login address is
   treated as new. `createUser` with a fresh uid only when neither side knows
   the e-mail. Two docs sharing one e-mail is a hard failure for every caller
   (`findUserDocByEmail`): picking one would log the member into an arbitrary
   half of themselves.

4. **Self-heal** at login and in the audit (`ensureAuthIdentity`): a missing
   Auth record is recreated **under the same uid**, including its `admin`
   claim (the claims trigger only fires on doc writes); a drifted Auth e-mail
   is corrected. A **bare** Auth record squatting on a member's address — no
   users doc, no provider, no phone, no custom claims, not a `tag:` principal
   — is deleted so the heal can proceed. That is the leftover of an abandoned
   code request. Anything not provably bare is a conflict for a human, never
   a deletion. The admin `createUser` callable *adopts* a bare record instead
   (creates the doc under its uid), which deletes nothing.

5. **Clients cannot set or change `users.email`.** Rules pin it on create to
   the session's own token e-mail and on update to its prior value. Without
   the create pin, doc-first resolution would let any signed-in session —
   anonymous included — register someone else's address and either pre-hijack
   that person's first login or lock an existing member out. Admin e-mail
   changes go through the `updateUserEmail` callable, which moves Auth first
   (a conflict aborts before the doc changes) and then the doc.

6. **A users trigger keeps Auth aligned** (`syncAuthIdentity` →
   `reconcileAuthIdentity`): doc e-mail → Auth, and the phone unlink of
   decision 2. It takes the uid only and **re-reads the doc** — trigger events
   arrive late or out of order, and acting on an event snapshot could revert a
   newer e-mail or unlink a freshly verified number. It never creates a record
   and never throws on a conflict.

7. **`disabled` is cleared only when promoting a managed member** — an Auth
   record *without* an e-mail gains one. Any other disabled record is a manual
   block: e-mail corrections leave it disabled, and the audit only reports it.

8. **Google sign-in guard.** Google sign-in is Auth-first by nature: when no
   Auth record holds the Google e-mail, the popup mints a fresh uid. If a users
   doc carries that e-mail anyway, the client deletes the doc-less record it is
   signed in as, signs out, and sends the member to the e-mail code (which
   heals). The guard keys on "no users doc for this uid + `hasProfile` for its
   e-mail", not on `isNewUser`, so a missed delete is caught — and cleaned up —
   on the next attempt. An unanswered check fails closed.

9. **`audit-identity`** in `privacy-cli` lists docs without an Auth record,
   Auth records without a doc, and e-mail/phone mismatches, with `--fix` for
   the mechanical ones.

## Consequences

**Pros:**
- A desync can no longer split a member: every login path converges on the
  doc's uid and repairs Auth on the way.
- Deleting an Auth record — by accident, by a restore that only covers
  Firestore — is recoverable by the member simply signing in.
- The admin profile tab can change a login e-mail safely; promoting a managed
  member is the same operation.
- The verified-phone rule is enforced, not just intended.

**Cons:**
- One more deletion path (bare-record reclaim). It is narrow, guarded by four
  independent terms, registered in `docs/disaster-recovery.md`, and pinned by
  one test per guard term.
- An admin e-mail change revokes the member's refresh tokens (Firebase does
  this on any Auth e-mail update): they are signed out everywhere within the
  hour and sign back in with the new address.
- An admin editing `users.phone` silently pauses that member's SMS login
  until they re-verify; the profile tab says so.
- A conflict at login (a non-bare record holds the member's e-mail) is a dead
  end until a human resolves it. It logs a warning and the audit lists it.

**Tradeoffs:**
- *Auth as the source of truth.* Rejected: Auth cannot hold the profile, and
  the failure we keep hitting is Auth records vanishing while docs survive.
  The doc is also what PITR and backups restore.
- *Normalising and tie-breaking at read time* (compare phones by parsed value,
  pick "the right" doc among duplicates). Rejected in favour of verifying the
  data once and gating the deploy on `check-user-identity-fields.ts`: stored
  values are already clean and every write path keeps them so.
- *Reclaiming a Google-only orphan at login* (a doc-less record with only a
  `google.com` provider). Not done: it needs a missing Auth record, a
  Google-first sign-in **and** a missed client-side cleanup; it is
  self-cleaning on the member's next Google attempt; and it would widen a
  deletion guard.
- *One trigger instead of two.* `syncAuthIdentity` is a sibling of
  `syncCustomClaims` rather than merged into it, so no deployed trigger has
  to be renamed (a rename is a delete + create at deploy time).
