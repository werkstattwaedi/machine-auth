# ADR-0053: Freiwilligengruppe and Interne Nutzung Gated by Google Workspace Groups

**Status:** Accepted (amends [ADR-0050](0050-per-person-usage-type.md): the owner-only types)

**Date:** 2026-11-04

**Applies to:** `functions/src/usage_groups/` (`syncUsageGroups`, the
`authCall.syncUsageGroups` handler), `users/{uid}.usageGroups`,
`shared/src/pricing.ts` (`personUsageOptions`, `isAloneOnlyUsage`,
`defaultOwnerUsageType`, `usageGroupsOf`),
`functions/src/invoice/close_checkout_and_get_payment.ts`
(`resolvePersonUsageTypes`, `loadOwnerUsageGroups`),
`functions/src/session/handle_upload_usage.ts`, the kiosk user payload, the
check-in, the admin correction editor, admin → Personen → Gruppen

## Context

Until now anyone signed in could pick *Freiwilligengruppe* or *Interne
Nutzung* on their own line, as long as they were alone on the visit
(ADR-0050). The types were self-declared and confirmed with a sentence on
Check Out.

The club changed the model: whoever helps in the Freiwilligengruppe uses
the machines for free, always. It is expected, but not enforced, that they
are members. So belonging to the group, not a declaration per visit, is what
grants the waiver. A volunteer is never on *Reguläre Nutzung* any more, and
they bring visitors (a child, a friend), so their type can't stay
alone-only. *Interne Nutzung* should be just as limited, to the people who
work on the club's own projects.

The team already keeps both lists as Google Workspace groups, with members'
private addresses as external members.

## Decision

**Workspace is the source of truth, and a sync copies it onto the account.**
`syncUsageGroups` runs every hour, and the admin page *Gruppen* runs it on
demand. It reads both groups through the Cloud Identity Groups API, nested
groups included, and matches each address to `users.email` (normalised, as
ADR-0043 keeps it). It writes `users/{uid}.usageGroups` (`volunteering`,
`intern`) only where it changed. Nothing else writes the field: the rules
pin it for every client, admins included (ADM-12). A group whose address
param is empty isn't synced, so its holders stay as they are rather than
losing it to a missing config value.

**The functions read the groups as themselves.** The runtime service
account is an owner of both groups (or holds the *Groups Reader* admin
role). That needs no domain-wide delegation and no key. The group addresses
are `defineString` params (`USAGE_GROUP_VOLUNTEERING_EMAIL`,
`USAGE_GROUP_INTERN_EMAIL`).

**The check-in offers the types by group (CHK-51).** A volunteer's own line
offers *Freiwilligengruppe* (preselected), plus *Interne Nutzung* if they
are in that group too, and nothing else. Everyone else sees the usual
types, plus *Interne Nutzung* when in that group. A type someone may not
choose is not shown at all. A badge or kiosk code session gets the groups
from the server's kiosk payload, like `activeMembership`, because it never
loads the users doc.

**Freiwilligengruppe can have visitors, Interne Nutzung can't (CHK-52).**
The visit's type is still the owner's group type (CHK-29). Next to a
volunteer, visitors pay their own usage fee, machine time stays free (the
badge identifies the account, CHK-46) and material is billed in full.
*Interne Nutzung* waives material too, which is not billed per person, so it
stays alone-only.

**The server refuses a group type for an account outside its group
(CHK-53).** The close and the admin correction both read the owner's
`usageGroups` at that moment, so a correction goes by the groups at the
correction, not at the visit.

**The machine terminal follows the group.** A checkout it opens for a
volunteer starts on *Freiwilligengruppe* (CHK-44). The owner switch for
machine time (CHK-40) moves a volunteer off Begleitung to
*Freiwilligengruppe*, not *Reguläre Nutzung*. A membership or badge bought
without a visit still puts the buyer on Begleitung (CHK-5), and the check-in
leaves a volunteer's purchase-only checkout there.

**No confirmation sentence for Freiwilligengruppe (CHK-30).** The group says
who the person is. *Interne Nutzung* keeps its sentence, because it is
declared per project.

**Membership is surfaced, not enforced (ADM-14).** The sync report and the
admin user page warn about a volunteer without an active membership.

## Consequences

**Pros:**
- The team maintains one list, in the tool they already use; the checkout
  follows within the hour.
- A volunteer no longer has to remember to pick a type or confirm a
  sentence, and the machine terminal bills them right on its own.
- The waiver can't be self-granted any more: the server checks the group.
- No change to the hot path: check-in and close read a field on the users
  doc they already read; a Workspace outage only delays membership changes.

**Cons:**
- A group member is matched by e-mail only. Someone whose account uses a
  different address than the group doesn't get the type until the two
  agree. The sync report lists such addresses.
- Changes take up to an hour unless an admin opens *Gruppen*.
- One more external dependency and console setup per environment (Cloud
  Identity API, the service account in both groups; `docs/deploy/`).
- The gate is only as closed as the groups: they must not allow anyone to
  join on their own.
- Each hourly run reads every account in a group, which is a few hundred
  reads a day for a group of ~50.

**Tradeoffs:**
- **Custom claim instead of a users field** — rejected. Badge taps at the
  kiosk sign in as a synthetic `actsAs` principal (ADR-0041) that never
  carries the member's claims, and claims are stale until the token
  refreshes. The server reads the users doc anyway.
- **Read the groups live at check-in or close** — rejected. It puts the
  Workspace API and its latency in every check-in and close, kiosk
  included, for data that changes a few times a year.
- **Keep the field in `roles[]`** — rejected. `roles` is edited by admins,
  and a sync that owns part of it would undo their edits, or theirs would
  undo it.
- **Domain-wide delegation impersonating an admin** — rejected. The service
  account as a group owner is narrower and needs no key.
- **Allow visitors next to Interne Nutzung too** — rejected. Their material
  would be waived along with the project's.
