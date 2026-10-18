# Product spec

What the product does, as short rules someone could check. ADRs say *why*
the system is built the way it is; this spec says *what* a visitor, member,
kiosk user or admin experiences. When the two overlap, the rule states the
behaviour and links the ADR for the reasoning.

The spec is checked by an agent, not by string-matching tests: `/spec-check`
locally and the Spec check workflow when a PR opens or is pushed to (both follow
[`.claude/spec-check.md`](../../.claude/spec-check.md)), and the staging
smoke run judges the deployed apps against it. Every judgement about the
spec — deriving rules from the code, deciding whether a behaviour is a rule
or an open question, checking rules against each other and against the code
— is the job of one agent, [`spec-expert`](../../.claude/agents/spec-expert.md),
which runs on Opus at high effort; the commands and prompts
that touch the spec hand that thinking to it instead of doing it inline. See
[ADR-0047](../adr/0047-product-spec.md).

## Files

| Prefix | File(s) | Covers |
|--------|---------|--------|
| `MEM` | [membership.md](membership.md) | buying, family, benefits, renewal, cancellation, expiry |
| `BIL` | [billing.md](billing.md) | payment methods, documents, numbering, monthly run, corrections, payment booking |
| `ACC` | [account.md](account.md) | ways to sign in and where each works, first sign-in, the restricted session at the kiosk, the Nutzungsverlauf |
| `CHK` | [checkout.md](checkout.md) | check-in, when a visit begins, the persons on it, usage types, usage fee, Check Out, Bezahlen — on any device |
| `KIO` | [kiosk.md](kiosk.md) | what differs at the terminal: Besuch starten, second badge, RaiseNow overlay, the Wallee terminal, idle reset |

A prefix is the domain; a file is a reading unit. Within a file, rules sit
where they read best, not in id order (MEM-35 follows MEM-25) — search for
an id to find it. Other domains get a file when an issue first touches them — planned prefixes:
`CAT` (catalog & materials), `MAC` (machine terminal), `ADM` (admin app).
Don't backfill a domain up front.

## Writing rules

1. **One rule, one sentence**, present tense: *"When …, …"*, *"While …, …"*,
   *"Only … receives …"*. No "should", no "the system shall".
2. **Behaviour, not wording.** Say what the person is told, not the text.
   German UI terms appear only as names of things (*Beleg*, *"Besuch
   starten"*). Exact copy belongs in the code.
3. **Only rules someone would notice if broken.** Skip the obvious ("saving
   saves"). If deleting the rule would change nothing, delete it. Migrations
   and other one-off transitions aren't the product — a rule about one
   exists only while it still matters to someone.
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
8. **Keep a file readable in a few minutes.** When a domain outgrows one
   file, split it by sub-domain into files that share the prefix
   (`membership-family.md` holding MEM-15…23); the ids stay as they are, so
   a file's numbers have gaps. An id is a handle, not a position — it says
   when the rule was created, not where it sits. Find a rule by searching
   for its id; never renumber to tidy a file (rule 7).
9. **A rule is something the system does on purpose.** A client-side rule
   with a decision behind it counts (it has a source). Behaviour that merely
   falls out of how a screen is built — nothing decided it, nothing refuses
   the other case — is an *Open questions* entry (or an issue), not a rule.
10. **A glossary entry defines a term** — what the thing is, never when it
    appears, where it leads, what it does or which rule governs it; that is
    a rule's job. A scope such as "(kiosk only)" is allowed only when it
    makes the term clearer, and an entry names a rule id only when it would
    otherwise be ambiguous.

These writing rules are the rubric: the spec check holds every rule and
every glossary entry a PR adds or edits against them, by number, and checks
it against the other rules for consistency.

Use the [glossary](#glossary) terms; if you need a new one, add it here.

## How a change flows

1. **Plan** (workqueue plan comment or `/design-session`): the *Spec*
   section has two parts. *As is*: the rules for what the code does today in
   the area the change touches, if they aren't written down yet — derived
   from the code by `spec-expert`, with undecided behaviour as *Open
   questions*. *Change*: the rules the change adds, changes or retires, with
   their exact new text — or *none* and why. Both are approved together with
   the plan.
2. **First commit: the spec as it is.** The branch starts with a commit that
   adds only the *As is* rules — no code. It says what holds before the
   change: a decided behaviour the issue is about to change goes in as it is
   today, a bug does not (writing rule 9). Every later commit then reads as
   a diff to the spec. When the area is already covered, there is no such
   commit. A change that touches no rule (`Spec: none`) needs none either.
3. **Implementation**: the code and its spec change land in the same PR,
   after that commit.
4. **PR description**: one line, checked by the `Spec line` workflow:
   - `Spec: MEM-3 (added), BIL-7 (changed), BIL-2 (retired)` — a new
     domain file may name a range, `CHK-1..12 (added)`. The *As is* rules
     count as added; a rule written down and then changed in the same PR is
     listed under both: `CHK-1..8 (added), CHK-3 (changed)` — or
   - `Spec: none — <why no rule is affected>`.
5. **Check**: `/spec-check` before pushing; the Spec check workflow comments
   on the PR — when it opens, on every push, and on a `/spec-check` comment —
   with contradictions, behaviour that should become a rule, rules this PR
   makes stale, added rules that clash with the rest or fail the writing
   rules, and *As is* rules the code before the PR doesn't bear out. It is
   advisory — a human decides.

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
  membership.
- **Invited member** — a person who joined a family membership through an
  invitation.
- **Admin** — a person with the `admin` claim.
- **Guest** — a person using the app without signing in or tapping a badge.
- **Identified person** — a person who signed in or tapped their badge.

**Places**
- **Own device** — the checkout app on the person's phone or computer.
- **Kiosk** — the shared terminal in the workshop (badge reader, printer).
- **Machine terminal** — the device on a machine that unlocks it.
- **Wallee terminal** — the Wallee payment terminal next to the kiosk, and
  the payment method paid there.

**Screens**
- **Check-in, Kosten, Check Out, Bezahlen** — the four steps of the checkout
  app: who is there, what was used or bought, the summary, paying.
- **Start screen** — the check-in while nobody is identified yet.
- **Account** (*Konto*) — the signed-in person's own pages: Profil,
  Nutzungsverlauf and Mitgliedschaft (the membership page).

**Things**
- **Badge** — a person's NFC tag.
- **Visit** (*Besuch*) — one stay in the workshop, from check-in to checkout;
  it belongs to the day it was opened, even when it is closed on a later day.
- **Checkout** — what a visit, purchase or membership costs, and how it was
  paid.
- **Awaiting payment** — the state of a checkout whose payment the Wallee
  terminal approved and Wallee has not confirmed yet: no longer open, not
  yet closed.
- **Day** (today, an earlier day) — the workshop day: 03:00 to 03:00 the
  next morning, Swiss time.
- **Complete profile** — a profile with first and last name, accepted terms
  and, for a company, its address.
- **Purchase-only checkout** — a checkout on which nobody works in the
  workshop: everyone on it is on *Begleitung / nur Materialbezug*.
- **Usage fee** (*Nutzungsgebühr*) — the per-visit fee for using the
  workshop.
- **User type** — whether a person is an adult, a child or a company.
- **Usage type** (*Nutzungsart*) — what a person's presence on a visit
  counts as, from *Reguläre Nutzung* to *Interne Nutzung*; the visit's type
  is the one derived from its persons.
- **Saved person** — a further person, by name and user type, that an
  account keeps from an earlier check-in.
- **Restricted session** — a kiosk session started by a badge tap.

**Billing documents**
- **Rechnung** — an invoice paid afterwards, with a QR slip.
- **Quittung** — a receipt for a payment made during checkout.
- **RaiseNow** — the payment method paid through RaiseNow's TWINT paylink, a
  promise to pay.
- **Beleg** — a per-checkout document that lists what was used or bought
  and asks for no payment itself.
- **Sammelrechnung** — the monthly invoice that collects the *Belege* of an
  account holder paying by Sammelrechnung.
- **Account holder** — the person a checkout is billed to (the payer).
- **Confirm** — the person's choice of a payment method for a bill.
- **Commit** — the moment a bill's payment method becomes final.
- **Verified payment** — a payment method whose payments the provider
  confirms to the server, unlike a promise to pay (QR-Rechnung,
  Sammelrechnung, RaiseNow).
