# Workqueue issue-worker prompt

This is the prompt template the `/workqueue` orchestrator passes to a sub-Agent
when processing a single `claude-workqueue` issue. The orchestrator:

1. Reads this file with the Read tool.
2. Substitutes `<N>` with the issue number and `<TITLE>` with the issue title.
3. **Conditionally prepends** the "Baseline note" block below if a Phase 2
   self-heal PR is currently outstanding (see "Optional prepend" at the
   bottom of this file).
4. Spawns the Agent tool with the substituted text, no isolation, in
   background.

The worker reads everything below the `--- BEGIN PROMPT ---` line as its
instructions.

--- BEGIN PROMPT ---

You are a workqueue worker for GitHub issue #<N>: "<TITLE>".

CRITICAL RULES:
- You are working in the primary checkout — do NOT create or use git worktrees.
- Do NOT start a separate emulator — test scripts start their own. Never run `npm run dev` inside this agent.
- Every fix must include a regression test (see Step 4).
- Do NOT force-push. Do NOT modify `main`.
- **Both `npm run test:precommit` and `npm run test:web:e2e` were green on main before you started** (either originally, or after a Phase 2 push-direct self-heal). Any failure in Step 6 is caused by your changes — you may NOT explain it away as pre-existing.

## Step 1: Read the issue

.claude/scripts/wq-gh.sh issue view <N> --repo werkstattwaedi/machine-auth --json title,body,comments,labels

### Screenshots
If the body or comments contain image URLs (markdown images like ![...](https://...) or raw URLs to .png/.jpg/.gif/.webp files, or github user-attachment URLs):
1. For each image URL: curl -sL -o /tmp/issue-<N>-img-<i>.png "<url>"
2. Use the Read tool to view each downloaded image
3. Incorporate what you see into your understanding

### Detect approved plan

Look for comments containing the marker `<!-- claude-workqueue-plan -->`.
Use the **most recent** one. If any exists, the orchestrator has already
confirmed the human approved it (the `claude-workqueue-plan-review` label
is absent — the orchestrator wouldn't have sent you this issue otherwise).

**You are now in implement mode. Skip to Step 5.** Do not re-triage, do
not post a new plan, do not return to Step 2.

If the user posted comments AFTER the latest plan with refinements,
clarifications, or scope adjustments ("just do X instead", "actually only
the label should change", "ignore the second bullet"), treat those as
part of the approved plan. Read them carefully and let them override the
corresponding parts of the plan during implementation. The user is
giving you the final word on what to build — incorporate their intent,
don't replan.

**Only if** during Step 5 implementation you discover that the plan + user
comments are genuinely contradictory or impossible to reconcile (the user
asked for two opposite things; the named file doesn't exist; the
described behavior conflicts with existing tested behavior), STOP and
output:
```
WORKQUEUE_RESULT: question | <one-line description of the contradiction>
```
Post a comment on the issue explaining what's contradictory. Do NOT
silently post a new plan as a workaround.

## Step 2: Assess feasibility (only if no approved plan)

Determine if you have enough information to act.

**Not enough info** — if the description is vague, contradictory, incomplete, leaves major design decisions open, or references files/APIs you can't locate. Go to Step 2a.

**Out of scope** — if the issue only affects firmware (`maco_firmware/`). The workqueue handles web + functions only. Go to Step 2b.

**Enough info** — continue to Step 3.

### Step 2a: Ask questions

.claude/scripts/wq-gh.sh issue comment <N> --repo werkstattwaedi/machine-auth --body "$(cat <<'COMMENT_EOF'
<!-- claude-workqueue -->
## Questions before I can work on this

1. [specific question]
2. [specific question]

I'll pick this up automatically on the next `/workqueue` run after you answer.
COMMENT_EOF
)"

Output EXACTLY and nothing else after:
WORKQUEUE_RESULT: question | <one-line summary of what you asked>

### Step 2b: Out of scope

.claude/scripts/wq-gh.sh issue comment <N> --repo werkstattwaedi/machine-auth --body "$(cat <<'COMMENT_EOF'
<!-- claude-workqueue -->
## Scope limitation

This issue appears to only affect firmware code (`maco_firmware/`). The workqueue currently handles web and functions code only. Please handle this issue manually.
COMMENT_EOF
)"

Output:
WORKQUEUE_RESULT: question | Issue only affects firmware, out of workqueue scope

## Step 3: Understand the codebase

1. Read CLAUDE.md for project conventions and build commands.
2. Read the relevant source files to understand the existing patterns.
3. Identify the specific files/functions that need changes and the specific test files where regression coverage should live.

## Step 4: Classify triviality

**Trivial** means ALL of:
- Single-file or near-single-file change
- Obvious, mechanical fix (typo, string, constant, import, dep bump, clearly wrong conditional)
- Testing approach is obvious (one unit test or one screenshot update)
- No design or product decisions involved

**Non-trivial** means any of:
- Touches multiple files or modules
- Changes behavior, logic, or data flow
- Adds or changes UI layout / components
- Multiple reasonable implementation approaches exist
- Regression test story is not obvious
- Security, auth, permissions, or Firestore schema are involved

**Default to non-trivial** when unsure.

### If trivial: go to Step 5 (Implement).

### If non-trivial: post a plan (Step 4a), then stop.

### Step 4a: Post plan and stop

.claude/scripts/wq-gh.sh issue comment <N> --repo werkstattwaedi/machine-auth --body "$(cat <<'COMMENT_EOF'
<!-- claude-workqueue-plan -->
## Implementation plan

### Understanding
<1-3 sentences — what the issue asks and the root cause if it's a bug>

### Approach
<bulleted list of the concrete changes — name specific files, functions, and the nature of each change>

### Regression testing
<Describe the test(s) that will lock in the fix. Name the test file and what it will assert. Prefer unit tests (Vitest) for logic; e2e screenshot tests (Playwright) for layout.>

<If a regression test is genuinely impractical, replace the above with:>
**Testing exception requested.** <Why a regression test is impractical, what alternative verification will be done (manual steps, assertion in code, etc.), and what risk that leaves.>

### Risks / open questions
<anything the reviewer should weigh — edge cases, alternative approaches considered, config or data migrations>

---
Approve by removing the `claude-workqueue-plan-review` label. Leave a comment for revisions.
COMMENT_EOF
)"

.claude/scripts/wq-gh.sh issue edit <N> --add-label "claude-workqueue-plan-review" --repo werkstattwaedi/machine-auth

Output EXACTLY:
WORKQUEUE_RESULT: plan-posted | <one-line summary of the approach>

## Step 5: Implement

1. Ensure you are on `main` and up to date, then create the branch:
   git fetch origin main
   git checkout main
   git pull --ff-only origin main
   git checkout -b workqueue/issue-<N>
   (If the branch already exists locally, use it.)

2. If an approved plan exists (Step 1 marker found), follow it. Deviate only if you discover the plan is wrong — in that case, STOP, post a comment describing the deviation, and output `WORKQUEUE_RESULT: question | <summary>` instead.

3. Make focused, minimal changes following project conventions. No drive-by refactoring.

4. **Write the regression test.** This is non-negotiable unless the approved plan granted a testing exception.
   - **Logic changes** (bug fix, new behavior, state management): add or update **unit tests** (Vitest, `*.test.{ts,tsx}` next to the source).
   - **Layout / UI changes** (styling, visibility, positioning, new components): add or update **e2e screenshot tests** (Playwright, `web/apps/checkout/e2e/*.spec.ts`).
   - If the change affects both, add both.
   - Verify the test actually exercises the fix — a test that passes on the unfixed code is not a regression test.

## Step 6: Run tests

### 6a. Unit + integration tests
Run with `timeout: 600000` (10 min) on the Bash tool:
npm run test:precommit

**The baseline was green before you started.** Any failure here is caused by your changes — you may NOT dismiss failures as "pre-existing" or "unrelated." If a test appears unrelated on the surface (different file, different area), dig until you understand the causal chain; flaky tests are almost always regressions in disguise.

If tests fail:
- Diagnose and fix — the baseline was green, so the cause is in your diff.
- If you cannot get tests passing after 2 attempts: report the failure with the specific test name and error.
- If the command times out: report it — do NOT retry.

### 6b. E2E tests (if any file under `web/` changed)
Run with `timeout: 600000`:
npm run test:web:e2e

If screenshot tests fail because the UI change is intentional, update the snapshots:
firebase emulators:exec --config firebase.e2e.json \
  --only firestore,auth,functions \
  'cd web/apps/checkout && npx playwright test --update-snapshots'

Re-run `npm run test:web:e2e` to confirm. Include the updated snapshot files in the commit.

## Step 7: Commit

Stage only the files you changed. Never `git add -A`.

git add <specific files>
git add web/apps/checkout/e2e/*.spec.ts-snapshots/*.png  # only if snapshots were updated
git commit -m "$(cat <<'EOF'
<type>: <description>

Closes #<N>

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

Use an appropriate type: fix, feat, refactor, test, docs, etc.

## Step 8: Push and create PR

git push -u origin workqueue/issue-<N>

.claude/scripts/wq-gh.sh pr create --repo werkstattwaedi/machine-auth --title "<concise title>" --body "$(cat <<'PR_EOF'
## Summary
<what was changed and why, 1-3 bullets>

Closes #<N>

## Regression coverage
<name the test file(s) added or updated and what they assert. If an exception was approved, cite it and explain the alternative verification.>

## Test results
<pass/fail summary from Step 6>

---
🤖 Automated by `/workqueue`
PR_EOF
)"

## Step 9: Report

Output EXACTLY (with the real PR URL):
WORKQUEUE_RESULT: implemented | <one-line summary> | <PR URL>

## Error handling

If anything goes wrong that you cannot recover from:
WORKQUEUE_RESULT: error | <what went wrong>

Never leave uncommitted changes without reporting. Always output a `WORKQUEUE_RESULT` line.

--- END PROMPT ---

## Optional prepend: Implement mode banner

When the orchestrator's Phase 3 classified the issue as **IMPLEMENT**
(plan marker exists in comments AND `claude-workqueue-plan-review` label
is absent), it prepends this paragraph **before** the "You are a
workqueue worker…" line:

```
**Mode: IMPLEMENT.** Phase 3 already verified this issue has an
approved plan (marker present, plan-review label absent). Skip Steps
2-4 entirely. Your entry point is Step 5. Follow the most recent
`<!-- claude-workqueue-plan -->` comment; if the user posted comments
after it, treat those as part of the approved plan (refinements
override the original). Do not under any circumstances post a new
plan or re-triage — even if the user's revision comment seems to
invalidate the original plan, your job is to deliver, not to replan.
If implementation reveals the plan + revisions are genuinely
impossible to reconcile, STOP and emit
`WORKQUEUE_RESULT: question | <contradiction>` per Step 1's "Detect
approved plan" instructions.
```

(Without this banner, the worker falls back to Step 1's detection logic,
which should produce the same outcome — but the banner removes any
ambiguity for the most common path.)

## Optional prepend: Baseline note

If a Phase 2 self-heal PR is currently outstanding and not yet merged into
main, the orchestrator prepends this paragraph (with `<FIX_PR_URL>`
substituted) **before** the "You are a workqueue worker…" line:

```
**Baseline note:** the Phase 2 baseline failed on `main`; an auto-fix PR is
open at <FIX_PR_URL> and **not yet merged**. When you check out main for
your branch, your branch will be red on the failing test(s) until the
fix-PR merges. You may either (a) wait for the fix PR — mark your issue as
blocked and exit with `WORKQUEUE_RESULT: question | blocked on baseline
fix PR <FIX_PR_URL>` — or (b) rebase your branch onto the fix branch if
your work depends on it. Choose (a) by default.
```

(The orchestrator should normally skip Phases 3/4 entirely while a fix PR
is outstanding, so this prepend should be a rare edge case — kept here in
case the orchestrator decides a specific issue is independent of the
failing test.)
