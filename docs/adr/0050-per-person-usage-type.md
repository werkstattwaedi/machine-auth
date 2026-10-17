# ADR-0050: Usage Type per Person, Saved Persons

**Status:** Accepted (amends the #570 usage-type design; resolves the companion cons of [ADR-0048](0048-family-membership-account-holders-only.md))

**Date:** 2026-10-16

**Applies to:** `shared/src/pricing.ts` (`deriveVisitUsageType`, `personUsageOptions`, `machineUsageBlocked`), `shared/src/checkout-summary.ts`, `shared/src/checkout-kind.ts` (`isPurchaseOnly`), `functions/src/invoice/close_checkout_and_get_payment.ts`, `functions/src/session/handle_upload_usage.ts` (`ownerSwitchForMachineTime`), the bill/PDF/stats readers of `persons[]`, the check-in and check-out steps of the checkout wizard, the admin visit correction editor, and `users/{uid}/savedPersons`

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
- **Machine time switches the owner to Reguläre Nutzung.** When a terminal
  adds a machine session to an open checkout whose owner line is on
  Begleitung, the server moves that line to Reguläre Nutzung and re-derives
  the visit type (`ownerSwitchForMachineTime`, CHK-40): someone who ran a
  machine worked in the workshop. Owner-only types and the other persons stay
  as they are.

**Purchase-only is derived from the persons.** A checkout on which nobody
works in the workshop — every person on Begleitung / nur Materialbezug, i.e.
the derived `usageType === "materialbezug"` — is purchase-only (CHK-9,
`isPurchaseOnly`); anyone on another type makes it a visit. The server's
badge, membership and renewal checkouts put their buyer on Begleitung and are
purchase-only by that rule. "Besuch starten" (KIO-18) puts the owner on
Reguläre Nutzung, which by itself makes the checkout a visit. The check-in
keeps the derived type on the open checkout current, so it reads as a visit
or a purchase before the close. On the bill, the buyer of a purchase-only
checkout reads "Nur Materialbezug" rather than "Begleitung".

**Saved persons.** An identified person (signed in or by badge tap) can tick
"Für nächstes Mal speichern" on a typed-in companion. The companion's name and
user type — not the usage type — are saved on continuing, in
`users/{uid}/savedPersons/{id}`, never twice with the same name and type.
"Person hinzufügen" then offers them as a menu, each with a way to remove it.
Saved persons belong to the account, whatever its membership, and are deleted
with it. A checkout line added from one carries its `savedPersonId`, which
gives the same-day waiver a stable key (`saved:<id>`). An admin correction
carries it over to the replacement, but only ids the original checkout carried.

**Old documents are read, not migrated**: every fee reader uses
`person.usageType ?? checkout.usageType`. Writes have no such fallback: the close
and the admin correction refuse (`invalid-argument`) any person without a
usage type of their own, and take no visit-wide type from the client.

## Consequences

**Pros:**
- An accompanying parent pays nothing; the child pays the child's fee (#605).
- The usage type is decided where the people are entered, and the Check Out
  step becomes a summary to confirm.
- Companions are one click again, without putting them on a membership.
- A saved companion returning the same day no longer pays twice.
- Freiwilligengruppe / Interne Nutzung are refused by the server, not just
  hidden by the app.
- Purchase-only needs no field of its own: one derived type answers both
  "what does the visit cost" and "was it a visit".

**Cons:**
- Every reader of `persons[]` that prices the entry fee (bill trigger, PDF,
  stats, correction editor) has to know the per-person type and its fallback.
- A companion typed in without ticking "speichern" still pays again the same
  day — the waiver needs a stable key, and a name is not one.
- A visit with an owner-only type cannot include anyone else; a volunteer
  bringing a child checks in twice.
- A group that only accompanies and buys material reads as a purchase, not a
  visit ("Danke für deinen Einkauf"), although they came in.

**Tradeoffs:**
- **A separate `checkouts.purchaseOnly` flag** (true on the server's
  purchase checkouts, false on every client-created one, cleared by "Besuch
  starten") — first shipped in this PR, then rejected: nobody working in the
  workshop means no visit is the honest reading; the flag left a purchase
  checkout whose owner switched to Reguläre Nutzung on the web stuck as a
  purchase (only the kiosk's "Besuch starten" cleared it), and turned print
  pickups into visits because the client created them.
- **Derive Reguläre Nutzung for an all-Begleitung visit** — rejected: it makes
  the derived type lie about what the visit costs.
- **Owner-only types next to other persons, waived only on the owner's line** —
  rejected: machines and material are not per person, so the visit would be
  waived for paying companions too.
- **Remember the last usage type per saved person** — rejected for now: the
  type is a per-visit declaration (KulturLegi, Begleitung) and should be chosen
  each time.
- **Match a returning companion by name** for the same-day waiver — rejected:
  names are not unique; the saved person's id is.
