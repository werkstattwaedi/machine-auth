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
   conventions are in `docs/spec/README.md`. A domain that outgrows one
   file is split into files that share its prefix; ids never move, so a
   split can't renumber — an id is a handle, found by search, not a
   position.
2. **The spec grows with the work.** A domain file is created when an issue
   first touches the domain. Membership and billing were seeded from the
   existing ADRs, the runbook's known facts and the code.
3. **The spec changes in the same PR as the behaviour.** Plans name the rules
   they add, change or retire, so rule wording is approved together with the
   plan. Every PR carries a `Spec:` line (`Spec: MEM-3 (added)` or
   `Spec: none — <reason>`).
4. **Two checks, split by what they can be trusted with:**
   - `spec-line.yml` / `scripts/check-spec-line.ts` is deterministic: the
     line exists and parses, each named rule exists (or is listed under
     *Retired*) in a spec file this PR changes, and no rule id is defined
     twice. It is cheap and stable, so it can be a required check.
   - `spec-check.yml` is an agent following `.claude/spec-check.md`. It
     reports contradictions, behaviour that should become a rule (with a
     ready-to-paste proposal), stale rules, added rules that are
     inconsistent with the rest of the spec or fail the README's writing
     rules — those rules are the rubric, there is no proposal quota — and
     whether the `Spec:` line is honest. It is **advisory**: a run can vary,
     and a gate that fails at random teaches people to ignore it. It runs
     when a PR opens, on every push to it, and when someone comments
     `/spec-check`; a newer push cancels a run still going. The same prompt
     runs locally as `/spec-check`; the workqueue runs it before pushing.
5. **No string-matching tests on UI copy.** Tests cover logic (unit) and
   layout (screenshots). A rule about what a person is told is covered by the
   spec rule and, where it matters, a smoke-runbook scenario. The staging
   smoke agent judges the deployed apps against `docs/spec/`.
6. **The agent runs with the repo's secrets, so only on heads of this
   repository.** Fork PRs are skipped on both triggers, project settings are
   not loaded from the checked-out tree, and the agent's shell is limited to
   read-only git commands (no `git fetch`: its `--upload-pack` runs arbitrary
   commands). The prompt and the tool allowlist still come from the PR head —
   anyone who can push here can change them, as they can change any
   workflow. Accepted for a project of this size.
7. **The spec is written down before it is changed.** When a change touches
   an area the spec doesn't cover yet, the branch's first commit adds the
   rules for what the code does today there — only `docs/spec/`, no code. A
   decided behaviour the issue is about to change goes in as it is; a bug
   does not (it is not a rule). The plan carries both parts, *As is* and
   *Change*, so both are approved together, and every later commit reads as
   a diff to the spec. The PR's `Spec:` line lists the as-is rules as added
   and a rule written down and then changed under both.
8. **One agent does the spec's thinking.** `.claude/agents/spec-expert.md`
   derives rules from code, words the rules of a change, assesses behaviour,
   runs the check and audits a file — on Opus at high effort (`model: opus`,
   `effort: high`; amended 2026-10-17 from Fable at xhigh, which was too
   slow to wait for interactively). It delegates
   discovery to Explore agents and keeps the judgement. The commands and
   prompts that touch the spec call it instead of judging inline; the
   workqueue's "no sub-agents inside workers" rule has this one exception.
   The PR workflow can't load project agents (its settings sources are
   restricted to `user`, decision 6); its top-level agent runs on the
   strongest model, Fable at high effort, since nobody waits on it.

## Consequences

**Pros:**
- Product rules have one home that is short enough to read, and that both
  humans and agents can check against.
- Copy can be reworded freely; the rule behind it survives.
- Plan review becomes the place where product behaviour is decided in
  writing.
- A behaviour change is reviewable as a spec diff: the as-is commit is "is
  this what it does today?", the rest is "is this what we want?".
- An area's rules are derived once, when it is first touched, by the model
  best at it; a wrong rule misleads every check downstream, so that is
  where model strength pays.

**Cons:**
- Every first touch of an area costs a derivation on the strongest model,
  and the plan comment grows by the as-is rules.
- The as-is commit can be wrong. The check compares it with the code at the
  base, but stays advisory.
- The agent check uses subscription quota on every opened PR, every push to
  it and every `/spec-check`.
- The spec stays honest only through review discipline: the deterministic
  check can't tell whether `Spec: none` is true; the advisory agent can only
  point it out.
- Domains not yet written down are invisible to the check until an issue
  touches them.
- Both checks look at a PR's diff. Whether the whole spec still matches the
  code — and itself — is a periodic audit, not part of this ADR (backlog:
  *Periodic spec and conformance audit*).
- Two PRs that both take the next free id merge cleanly when they touch
  different sections; afterwards the deterministic check fails every PR until
  one id is changed. There is no branch protection to force a rebase first
  (deliberately, for a project of this size); the workqueue rebases before it
  merges, which covers its PRs.

**Tradeoffs:**
- *A self-attested "checked locally" tag* in the PR description was rejected:
  the workqueue agent would always write it, so it proves nothing.
- *Making the agent check required* was deferred until a few weeks of PRs
  show its false-positive rate.
- *A full spec up front, or adopting Spec Kit's per-feature specs*, was
  rejected for the cost and staleness reasons above.
- *Letting each worker derive and judge spec rules on its own model* was
  rejected: a spot-check of the seed found 5 of 22 rules overstated — the
  kind of error that then passes as "the rule" in every check. Spec
  judgement is a small, high-leverage share of the work and gets the
  strongest model; discovery can still be delegated.
