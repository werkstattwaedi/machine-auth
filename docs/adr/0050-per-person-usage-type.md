# ADR-0050: Usage Type per Person, Saved Persons

**Status:** Accepted (amends the #570 usage-type design; resolves the companion cons of [ADR-0048](0048-family-membership-account-holders-only.md))

**Date:** 2026-10-16

**Applies to:** `shared/src/pricing.ts` (`deriveVisitUsageType`, `personUsageOptions`, `machineUsageBlocked`), `shared/src/checkout-summary.ts`, `shared/src/checkout-kind.ts` (`isPurchaseOnly`), `functions/src/invoice/close_checkout_and_get_payment.ts`, the bill/PDF/stats readers of `persons[]`, the check-in and check-out steps of the checkout wizard, the admin visit correction editor, and `users/{uid}/savedPersons`

## Context

A checkout had **one** `usageType`, chosen on the Check Out step. It
discounted every person's entry fee the same way and, for `materialbezug` /
`volunteering` / `intern`, machines and material too. Issue #605 (from the
workshop) asks for different types per person: an adult who only accompanies
a child should pay nothing while the child pays the child's fee. A single
visit-wide type cannot say that.

ADR-0048 removed login-less family members and the family quick-add chips, so
companions are retyped on every visit, and a companion returning the same day
pays the entry fee again — the same-day waiver (#268) keys on an account link
only the owner still has.

The top-level `usageType` also carried a second meaning: `materialbezug` on an
open checkout marked a **purchase-only** checkout (a badge, membership or
renewal the server bought on its own; CHK-9), which the kiosk and the bill
wording (#660) read as "no visit".

The design was agreed in a design session (mockup *Gespeicherte Personen &
Nutzungsart*, v10; screens in `.wq-capture/issue-605/`).

## Decision

**Each person has their own usage type, chosen on the check-in.**

- `checkouts.persons[].usageType` decides that person's entry fee. The Check
  Out step only shows a read-only summary, with one confirmation sentence per
  discounted person.
- *Nur Materialbezug* becomes **Begleitung / nur Materialbezug** — the same id
  (`materialbezug`), now also for someone who only accompanies.
- **Freiwilligengruppe / Interne Nutzung are owner-only**: only on the
  identified person's own line and only while they are alone on the visit;
  while one is chosen no further person can be added. They waive machines (and
  material) for the whole visit, so they cannot sit next to a paying person.
  The server refuses them anywhere else (`invalid-argument`) — until now only
  the app withheld them.
- **The visit's type is derived** on the server (`deriveVisitUsageType`): the
  owner's Freiwilligengruppe / Interne Nutzung; else Begleitung when every
  person has it; else Reguläre Nutzung. It is still written to
  `checkouts.usageType` and drives what the single type always drove for
  machines and material, the stats `usage_type`, and the intern / membership /
  badge guards.
- Machine usage while every person is on Begleitung is refused
  (`machineUsageBlocked`); Check Out shows the error and the person changes the
  type on the check-in.

**Purchase-only gets its own marker.** Once the visit type is derived, a
visit where everyone accompanies is `materialbezug` too, so the two meanings
split: `checkouts.purchaseOnly` is `true` on server-created purchase checkouts
and `false` on every checkout a client creates; "Besuch starten" on a
purchase-only checkout (KIO-18) clears it. `isPurchaseOnly` falls back to
`usageType === "materialbezug"` for docs without the flag.

**Saved persons.** An identified person (signed in or by badge tap) can tick
"Für nächstes Mal speichern" on a typed-in companion. The companion's name and
user type — not the usage type — are saved on continuing, in
`users/{uid}/savedPersons/{id}`, never twice with the same name and type.
"Person hinzufügen" then offers them as a menu, each with a way to remove it.
Saved persons belong to the account, whatever its membership, and are deleted
with it. A checkout line added from one carries its `savedPersonId`, which
gives the same-day waiver a stable key (`saved:<id>`).

**Old documents are read, not migrated**: every fee reader uses
`person.usageType ?? checkout.usageType`.

## Consequences

**Pros:**
- An accompanying parent pays nothing; the child pays the child's fee (#605).
- The usage type is decided where the people are entered, and the Check Out
  step becomes a summary to confirm.
- Companions are one click again, without putting them on a membership.
- A saved companion returning the same day no longer pays twice.
- Freiwilligengruppe / Interne Nutzung are refused by the server, not just
  hidden by the app.

**Cons:**
- Every reader of `persons[]` that prices the entry fee (bill trigger, PDF,
  stats, correction editor) has to know the per-person type and its fallback.
- A companion typed in without ticking "speichern" still pays again the same
  day — the waiver needs a stable key, and a name is not one.
- A visit with an owner-only type cannot include anyone else; a volunteer
  bringing a child checks in twice.

**Tradeoffs:**
- **Keep `materialbezug` as the purchase-only marker and derive Reguläre
  Nutzung for an all-Begleitung visit** — rejected: it keeps one field with two
  meanings and makes the derived type lie about the visit.
- **Owner-only types next to other persons, waived only on the owner's line** —
  rejected: machines and material are not per person, so the visit would be
  waived for paying companions too.
- **Remember the last usage type per saved person** — rejected for now: the
  type is a per-visit declaration (KulturLegi, Begleitung) and should be chosen
  each time.
- **Match a returning companion by name** for the same-day waiver — rejected:
  names are not unique; the saved person's id is.
