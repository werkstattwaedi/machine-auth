# ADR-0047: A Product Spec of Checkable Rules, Checked by an Agent

**Status:** Accepted

**Date:** 2026-10-15

**Applies to:** `docs/spec/`, `.claude/spec-check.md`, `.claude/commands/spec-check.md`, `.github/workflows/spec-check.yml`, `.github/workflows/spec-line.yml`, `scripts/check-spec-line.ts`, `.github/pull_request_template.md`, the workqueue worker prompt and `/design-session`

## Context

The project documents *why* (ADRs) but nowhere states *what* the product does
as a whole. Product rules were scattered: inside ADRs, CLAUDE.md, the smoke
runbook's "Known facts", issue threads, and code comments.

Because "every fix needs a regression test", the workqueue locked product
rules in with tests that string-match UI copy. An example is
`membership-copy.test.tsx` (#665, #730), which asserted the literal sentence
telling a family member who receives the renewal bill. Such a test breaks on
every rewording, and still passes when a *different* wrong promise is shown.
The rule it was meant to protect ("only the family owner is billed for
renewal, and invited members are never told otherwise") had no home.

Spec-driven tooling (GitHub Spec Kit, Kiro, Tessl) generates one spec per new
feature as the entry point of work. That doesn't fit a large existing system,
and backfilling a complete spec up front would cost weeks and go stale.

## Decision

1. **`docs/spec/`: one file per domain, one sentence per rule**, with a
   permanent id (`MEM-3`) and a source link (ADR, issue, PR). The format
   follows ISO/IEC/IEEE 29148's characteristics (singular, unambiguous,
   verifiable, necessary) and borrows from EARS ("When …, …") and example
   mapping (a table for combinations, *Open questions* for undecided
   behaviour). Rationale stays in ADRs; wording stays in code. The
   conventions are in `docs/spec/README.md`.
2. **The spec grows with the work.** A domain file is created when an issue
   first touches the domain. Membership and billing were seeded from the
   existing ADRs, the runbook's known facts and the code.
3. **The spec changes in the same PR as the behaviour.** Plans name the rules
   they add, change or retire, so rule wording is approved together with the
   plan. Every PR carries a `Spec:` line (`Spec: MEM-3 (added)` or
   `Spec: none — <reason>`).
4. **Two checks, split by what they can be trusted with:**
   - `spec-line.yml` / `scripts/check-spec-line.ts` is deterministic: the
     line exists and parses, the named rules exist (or are retired), the PR
     touches `docs/spec/` when it names rules, and no rule id is defined
     twice. It is cheap and stable, so it can be a required check.
   - `spec-check.yml` is an agent following `.claude/spec-check.md`. It
     reports contradictions, behaviour that should become a rule (with a
     ready-to-paste proposal) and stale rules, and whether the `Spec:` line
     is honest. It is **advisory**: a run can vary, and a gate that fails at
     random teaches people to ignore it. It runs when a PR opens and again
     when someone comments `/spec-check`, not on every push. The same prompt
     runs locally as `/spec-check`; the workqueue runs it before pushing.
5. **No string-matching tests on UI copy.** Tests cover logic (unit) and
   layout (screenshots). A rule about what a person is told is covered by the
   spec rule and, where it matters, a smoke-runbook scenario. The staging
   smoke agent judges the deployed apps against `docs/spec/`.

## Consequences

**Pros:**
- Product rules have one home that is short enough to read, and that both
  humans and agents can check against.
- Copy can be reworded freely; the rule behind it survives.
- Plan review becomes the place where product behaviour is decided in
  writing.

**Cons:**
- The agent check uses subscription quota on every opened PR and every
  `/spec-check`.
- The spec stays honest only through review discipline: the deterministic
  check can't tell whether `Spec: none` is true; the advisory agent can only
  point it out.
- Domains not yet written down are invisible to the check until an issue
  touches them.

**Tradeoffs:**
- *A self-attested "checked locally" tag* in the PR description was rejected:
  the workqueue agent would always write it, so it proves nothing.
- *Making the agent check required* was deferred until a few weeks of PRs
  show its false-positive rate.
- *A full spec up front, or adopting Spec Kit's per-feature specs*, was
  rejected for the cost and staleness reasons above.
