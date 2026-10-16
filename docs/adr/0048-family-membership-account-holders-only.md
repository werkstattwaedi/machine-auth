# ADR-0048: Family Memberships Hold Account Holders Only

**Status:** Accepted (supersedes [ADR-0029](0029-concurrent-family-member-checkouts.md))

**Date:** 2026-10-15

**Applies to:** `functions/src/invoice/close_checkout_and_get_payment.ts` (`resolveClosePersons`), `functions/src/membership/admin.ts` (`adminAddFamilyMember`), the check-in step of the checkout wizard, the family section of `/account/membership`, and the admin person membership tab

## Context

ADR-0029 let a family owner create **login-less members**: a `users/{uid}` doc
with `email: null` and a disabled Auth record, put on `memberships.members[]`.
Their one purpose was the check-in quick-add chips — the owner picked them with
one click instead of typing a name, and the visit linked to their account.

That model confused more than it helped:

- A login-less member gets nothing out of the membership. The member discount
  is a checkout-level tier taken from the checkout **owner**'s membership; a
  child on a parent's checkout pays member prices whether or not the child is
  on the roster. The only thing that differs per person is the entry fee, which
  never depended on membership.
- Someone who uses a machine on their own needs a badge or a login anyway, and
  a badge belongs to an account holder.
- The roster mixed two kinds of people — co-members who check in on their own
  account (shown as disabled chips) and login-less ones (addable chips) — and
  the owner could neither edit a login-less member's profile nor give them an
  e-mail (only an admin could, via `updateUserEmail`).

Production had 6 login-less members in 3 families, none of whom had ever
appeared on a closed checkout.

The mental model we want is a streaming family plan: you add the people who use
the service on their own, not the kids who happen to watch along.

## Decision

**A family membership contains only people with their own login.** Anyone who
merely accompanies a member is a guest by name on the member's checkout.

- **No new login-less members.** The `createManagedMember` callable is gone, as
  are the "Ohne Login" add paths in the checkout account page and the admin
  person tab. `adminAddFamilyMember` rejects a target without a login
  (`failed-precondition`); invites already produce account holders only.
- **No family quick-add at check-in.** The wizard no longer reads the family
  roster. Companions are added with "Person hinzufügen" and typed in. A way to
  remember them across visits (saved persons, owned by the account that saves
  them, not tied to the membership) is a separate design.
- **A roster line carries an identity only for the checkout owner.**
  `resolveClosePersons` turns a wire `userId` into a `userRef` only when it is
  the owner's; every other line is persisted as a guest. The ADR-0029 roster
  guard (`assertRosterAccountless`) and its client mirror
  (`rosterAccountError`) are removed — with no non-owner identity on a roster,
  there is nothing left for them to check.
- **The owner always stays on their own visit.** The check-in X is withheld
  from the owner's line (ADR-0029 let them drop out once a family member was
  added). A parent who only accompanies a child pays the entry fee until a
  per-person usage type with a "Begleitung" option exists (#605).

Existing login-less members are left in place and handled by talking to their
owners; no migration script. Their `users` docs keep working for the code that
still understands them (`updateUserEmail` promotion, the identity audit), and
`MemberRow` still labels them "Kein Login".

## Consequences

**Pros:**
- A family is one kind of person: someone who can check in, carry a badge and
  get member pricing on their own visits.
- The invariants ADR-0029 needed — "non-owner rostered `userRef`s are
  account-less", and "token holders are account holders" to keep a rostered
  person from also tapping a badge — collapse into "only the owner's line
  carries a `userRef`", which needs no user-doc reads at close.
- No more `users`/Auth records that nobody can sign in to, edit or clean up
  (removing a login-less member used to orphan both).

**Cons:**
- The same-day entry-fee waiver (#268) keys on `userRef`, so it now applies to
  the owner only; a companion returning the same day pays the entry fee again.
  Saved persons could restore it with a stable id per companion.
- Companions are retyped on every visit until saved persons exist.
- Until #605, an accompanying parent cannot remove themselves from the visit.

**Tradeoffs:**
- **Keep login-less members, fix their UX** (owner-editable profiles, a way to
  add an e-mail) — rejected: it polishes records that buy their holder nothing.
- **Migrate login-less members into saved persons** — rejected for now: three
  families, none of whose login-less members was ever used; a conversation is
  cheaper than a migration.
