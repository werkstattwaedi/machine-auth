---
description: Check the current branch against the product spec (docs/spec/) — contradictions, behaviour that should become a rule, stale rules, an as-is commit the base code doesn't bear out. Same check as the PR workflow, run by the spec-expert agent.
---

# /spec-check

Spawn the `spec-expert` agent (Agent tool, `subagent_type: "spec-expert"`)
with task **check**: it follows `.claude/spec-check.md`.

**Arguments:** $ARGUMENTS — optional: a base ref (default `origin/main`),
or a PR number (then use its base branch, and write its body to a scratch
file via `gh pr view <N> --json body --jq .body` as the PR description).

Run `git fetch origin` first so the base is current, then pass the base, the
PR description file if any, and no report file. Print the report it returns.
When run by the workqueue before pushing, fix every *Contradicts*,
*Inconsistent*, *Rubric* and *As is* finding (code or rule, whichever the
issue intends), add the *Missing* rules that hold up under the README's
writing rules to `docs/spec/`, and mention the rest in the PR body.
