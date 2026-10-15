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
which runs on the strongest model at high effort; the commands and prompts
that touch the spec hand that thinking to it instead of doing it inline. See
[ADR-0047](../adr/0047-product-spec.md).

## Files

| Prefix | File(s) | Covers |
|--------|---------|--------|
| `MEM` | [membership.md](membership.md) | buying, family, benefits, renewal, cancellation, expiry |
| `BIL` | [billing.md](billing.md) | payment methods, documents, numbering, monthly run, corrections, payment booking |
| `ACC` | [account.md](account.md) | ways to sign in and where each works, first sign-in |
| `CHK` | [checkout.md](checkout.md) | check-in, when a visit begins, usage types — on any device |
| `KIO` | [kiosk.md](kiosk.md) | what differs at the terminal: Besuch starten, second badge, idle reset |

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

These writing rules are the rubric: the spec check holds every rule a PR
adds or edits against them, by number, and checks it against the other rules
for consistency.

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
  membership and invites the others.
- **Invited member** — a person who joined a family membership through an
  invitation.
- **Admin** — a person with the `admin` claim; works in the admin app.
- **Guest** — a person who continues without signing in or tapping a
  badge; the app knows nothing about them.
- **Identified person** — a person who signed in or tapped their badge;
  the opposite of a guest.

**Places**
- **Own device** — the checkout app on the person's phone or computer.
- **Kiosk** — the shared terminal in the workshop (badge reader, printer).
- **Machine terminal** — the device on a machine that enables it after a
  badge tap.

**Screens**
- **Check-in, Kosten, Check Out** — the steps of the checkout app, in this
  order: who is there, what was used or bought, and paying.
- **Start screen** — the check-in before anyone is identified: sign in or
  continue as a guest; at the kiosk also the badge prompt.
- **Account** (*Konto*) — the signed-in person's own pages: Profil,
  Nutzungsverlauf and Mitgliedschaft (the membership page); at the kiosk
  reached only by an elevated session (MEM-30).

**Things**
- **Badge** — a person's NFC tag.
- **Visit** (*Besuch*) — one stay in the workshop, from check-in to checkout;
  it is *started* once its checkout exists (CHK-3).
- **Checkout** — what a visit, purchase or membership costs, and how it was
  paid.
- **Day** — a workshop day runs from 03:00 to 03:00 the next morning
  (Europe/Zurich); a visit at 02:00 still belongs to the day before.
  "Today" and "an earlier day" in the rules mean this day.
- **Complete profile** — first and last name, accepted terms and, for a
  company, its address (ACC-2).
- **Purchase-only checkout** — a checkout opened by buying a membership,
  renewal or badge without a visit; its usage type is *Nur Materialbezug*
  and it carries no usage fee (CHK-5, MEM-3).
- **Usage fee** (*Nutzungsgebühr*) — the per-visit fee for using the
  workshop.
- **Elevated session** — a kiosk session that entered a fresh e-mail or SMS
  code; the only kind that reaches the account at the kiosk (ADR-0041).

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
- **Confirm** — the person's act of choosing a payment method for a bill at
  the end of a checkout.
- **Commit** — the moment a bill's payment method becomes final: when the
  person confirms it, or when the overnight job does it for them (BIL-7).
  What a bill grants, it grants from this moment (BIL-34).
