---
description: Check the current branch against the product spec (docs/spec/) — contradictions, behaviour that should become a rule, stale rules. Same check as the PR workflow.
---

# /spec-check

Follow `.claude/spec-check.md`.

**Arguments:** $ARGUMENTS — optional: a base ref (default `origin/main`),
or a PR number (then use its base branch, and write its body to a scratch
file via `gh pr view <N> --json body --jq .body` as the PR description).

Run `git fetch origin` first so the base is current. Print the report.
When run by the workqueue before pushing, fix every *Contradicts* finding
(code or rule, whichever the issue intends), add the *Missing* rules you
agree with to `docs/spec/`, and mention the rest in the PR body.
