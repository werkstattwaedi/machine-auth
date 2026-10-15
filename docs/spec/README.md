# Product spec

What the product does, as short rules someone could check. ADRs say *why*
the system is built the way it is; this spec says *what* a visitor, member,
kiosk user or admin experiences. When the two overlap, the rule states the
behaviour and links the ADR for the reasoning.

The spec is checked by an agent, not by string-matching tests: `/spec-check`
locally and the Spec check workflow when a PR opens or is pushed to (both follow
[`.claude/spec-check.md`](../../.claude/spec-check.md)), and the staging
smoke run judges the deployed apps against it. See
[ADR-0047](../adr/0047-product-spec.md).

## Files

| Prefix | File | Covers |
|--------|------|--------|
| `MEM` | [membership.md](membership.md) | buying, family, benefits, renewal, cancellation, expiry |
| `BIL` | [billing.md](billing.md) | payment methods, documents, numbering, monthly run, corrections, payment booking |

Other domains get a file when an issue first touches them — planned prefixes:
`CHK` (visit & checkout), `KIO` (kiosk), `ACC` (account & sign-in), `CAT`
(catalog & materials), `MAC` (machine terminal), `ADM` (admin app). Don't
backfill a domain up front.

## Writing rules

1. **One rule, one sentence**, present tense: *"When …, …"*, *"While …, …"*,
   *"Only … receives …"*. No "should", no "the system shall".
2. **Behaviour, not wording.** Say what the person is told, not the text.
   German UI terms appear only as names of things (*Beleg*, *"Besuch
   starten"*). Exact copy belongs in the code.
3. **Only rules someone would notice if broken.** Skip the obvious ("saving
   saves"). If deleting the rule would change nothing, delete it.
4. **No rationale in the rule.** End it with its source — ADR, issue or PR —
   after an em dash: `— ADR-0042, #730`. The source is where the *why* lives.
   A rule with no recorded decision behind it carries no source; give it one
   when an issue or ADR next touches it.
5. **Combinations go in a table** under the rule, one row per case, instead
   of a longer sentence.
6. **Undecided behaviour is a question, not a rule.** Put it under *Open
   questions* with `[NEEDS CLARIFICATION]`; when someone decides, it becomes
   a rule (or is dropped).
7. **Ids are permanent.** `PREFIX-<n>`, numbered in order of creation (next
   free number, regardless of section), never renumbered, never reused. A
   rule that no longer holds is deleted and its id listed under *Retired*
   with the PR that retired it. A rule whose meaning changes keeps its id
   only if a reader of the old rule would not be misled — otherwise retire it
   and add a new one.
8. **Keep a file readable in a few minutes.** Split it by sub-domain before
   it grows past ~60 rules.
9. **A rule is something the system does on purpose.** A client-side rule
   with a decision behind it counts (it has a source). Behaviour that merely
   falls out of how a screen is built — nothing decided it, nothing refuses
   the other case — is an *Open questions* entry (or an issue), not a rule.

These writing rules are the rubric: the spec check holds every rule a PR
adds or edits against them, by number, and checks it against the other rules
for consistency.

Use the [glossary](#glossary) terms; if you need a new one, add it here.

## How a change flows

1. **Plan** (workqueue plan comment or `/design-session`): a *Spec* section
   names the rules added, changed or retired, with their exact new text — or
   says *none* and why. Rule wording is approved together with the plan.
2. **Implementation**: the spec change lands in the same PR as the code.
3. **PR description**: one line, checked by the `Spec line` workflow:
   - `Spec: MEM-3 (added), BIL-7 (changed), BIL-2 (retired)` — a new
     domain file may name a range, `CHK-1..12 (added)` — or
   - `Spec: none — <why no rule is affected>`.
4. **Check**: `/spec-check` before pushing; the Spec check workflow comments
   on the PR — when it opens, on every push, and on a `/spec-check` comment —
   with contradictions, behaviour that should become a rule, rules this PR
   makes stale, and added rules that clash with the rest or fail the writing
   rules. It is advisory — a human decides.

Code may cite a rule id in a comment where the reason for a branch isn't
obvious (`// MEM-3`); that keeps the link greppable.

## Tests and the spec

Tests cover logic and layout: unit tests for who-gets-what decisions, e2e
screenshots for screens. A rule about *what a person is told* is covered by
the spec rule itself (plus, where it matters, a smoke-runbook scenario) —
don't assert UI copy by string matching; it breaks on every rewording and
still passes a different wrong promise.

## Glossary

**People**
- **Visitor** — anyone using the workshop without an active membership.
- **Member** — a person with an active membership (single, or as part of a
  family).
- **Family owner** (*Inhaber:in*) — the member who bought a family
  membership and invites the others.
- **Invited member** — a person who joined a family membership through an
  invitation.
- **Admin** — a person with the `admin` claim; works in the admin app.

**Places**
- **Own device** — the checkout app on the person's phone or computer.
- **Kiosk** — the shared terminal in the workshop (badge reader, printer).
- **Machine terminal** — the device on a machine that enables it after a
  badge tap.

**Things**
- **Badge** — a person's NFC tag.
- **Visit** (*Besuch*) — one stay in the workshop, from check-in to checkout.
- **Checkout** — what a visit, purchase or membership costs, and how it was
  paid.
- **Usage fee** (*Nutzungsgebühr*) — the per-visit fee for using the
  workshop.

**Billing documents**
- **Rechnung** — an invoice paid afterwards, with a QR slip.
- **Quittung** — a receipt for a method paid during checkout (TWINT); no QR
  slip.
- **Beleg** — the per-checkout document of a member paying by Sammelrechnung;
  billed later.
- **Sammelrechnung** — the monthly invoice that collects an account holder's
  *Belege*.
- **Account holder** — the person a checkout is billed to (the payer); other
  people on the same visit are not billed.
