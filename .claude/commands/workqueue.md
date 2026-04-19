---
description: Process GitHub issues labeled "claude-workqueue" and address review comments on open workqueue PRs. Posts plans for non-trivial issues first, then implements after human approval. Writes regression tests for every fix.
---

# /workqueue

Process the `claude-workqueue` issue queue and open workqueue PRs with review feedback. Re-runnable — skips issues already handled or awaiting answers.

**Arguments:** $ARGUMENTS (optional issue number or PR number to process only that item)

## Core rules

1. **Never use git worktrees.** The operations repo setup requires working in the main checkout, and the Firebase emulators bind to fixed ports — parallel worktrees cause test hangs and port conflicts. Do NOT pass `isolation: "worktree"` to the Agent tool. Process issues sequentially on the primary working directory.
2. **Plan-first for non-trivial issues.** For anything beyond a clearly trivial fix, post a short plan as an issue comment and wait for human approval before implementing. The human approves by removing the `claude-workqueue-plan-review` label.
3. **Regression tests are mandatory.** Every fix must include a test that would have caught the bug or that locks in the new behavior. If a regression test is genuinely impractical, the plan must explicitly request an exception and explain why — the human decides during plan review.
4. **All `gh` calls go through `.claude/scripts/wq-gh.sh`**, which authenticates as the workqueue GitHub App so comments, PRs, and review acks are attributed to the bot rather than the local user. `git push` and other `git` commands keep using the user's credentials — commits remain the user's.

## Setup (one-time)

The workqueue authenticates as a GitHub App so issue comments don't look like you talking to yourself. Do these once per machine:

1. **Create a GitHub App** under your account:
   - https://github.com/settings/apps/new
   - Name: e.g. `werkstattwaedi-workqueue`
   - Homepage URL: repo URL
   - Webhook: **disable** (uncheck Active)
   - Repository permissions:
     - **Contents**: Read & write (push branches)
     - **Issues**: Read & write (comment, label)
     - **Pull requests**: Read & write (create, comment, review)
     - **Metadata**: Read (auto)
   - Where can this App be installed: *Only on this account*
   - Click **Create GitHub App**.
2. On the App's page, scroll to **Private keys** → **Generate a private key**. Save the downloaded `.pem`.
3. Note the numeric **App ID** (at the top of the App settings page).
4. **Install the App** on the repo: App page → left sidebar → *Install App* → pick `werkstattwaedi/machine-auth` (only). After installing, the URL contains the installation ID: `…/settings/installations/<INSTALLATION_ID>`. Note that number.
5. Store the credentials outside the repo:
   ```bash
   mkdir -p ~/.config/workqueue-app
   mv ~/Downloads/<your-app>.<date>.private-key.pem ~/.config/workqueue-app/private-key.pem
   chmod 600 ~/.config/workqueue-app/private-key.pem
   cat > ~/.config/workqueue-app/env <<'EOF'
   export WORKQUEUE_APP_ID=<APP_ID>
   export WORKQUEUE_APP_INSTALLATION_ID=<INSTALLATION_ID>
   export WORKQUEUE_APP_PRIVATE_KEY=$HOME/.config/workqueue-app/private-key.pem
   EOF
   chmod 600 ~/.config/workqueue-app/env
   ```
6. Verify — this should print `werkstattwaedi/machine-auth`:
   ```bash
   .claude/scripts/wq-gh.sh api /installation/repositories --jq '.repositories[].full_name'
   ```
   (Note: App installation tokens cannot call `/user` — that endpoint is user-scope. A 403 there means auth works but the wrong endpoint was used.)

## State machine (labels)

| Label | Meaning |
|-------|---------|
| `claude-workqueue` | In the queue, ready for processing |
| `claude-workqueue-wip` | Currently being worked by a `/workqueue` run |
| `claude-workqueue-question` | Waiting for a human to answer a clarifying question |
| `claude-workqueue-plan-review` | A plan has been posted; waiting for human to review and approve |

Ensure all four labels exist (idempotent):

```bash
.claude/scripts/wq-gh.sh label create "claude-workqueue-wip" --color "FFA500" --description "Workqueue: in progress" --repo werkstattwaedi/machine-auth 2>/dev/null || true
.claude/scripts/wq-gh.sh label create "claude-workqueue-question" --color "D93F0B" --description "Workqueue: needs human answer" --repo werkstattwaedi/machine-auth 2>/dev/null || true
.claude/scripts/wq-gh.sh label create "claude-workqueue-plan-review" --color "1D76DB" --description "Workqueue: plan posted, needs human approval" --repo werkstattwaedi/machine-auth 2>/dev/null || true
```

## Phase 0 — Baseline test run

Before fetching any issues, confirm the repo is in a clean, passing state. This makes it impossible for a worker agent to later blame "pre-existing test failures" for regressions it introduced.

1. Verify the working tree is clean and we're on a known branch:
   ```bash
   git status --porcelain
   git rev-parse --abbrev-ref HEAD
   ```
   If the tree is dirty, stop and report — do NOT stash or discard.

2. Run the full precommit suite with a 10-minute timeout (Bash `timeout: 600000`):
   ```bash
   npm run test:precommit
   ```

3. If any test fails:
   - **Abort the entire `/workqueue` run.**
   - Print the failing tests.
   - Tell the user to fix the baseline first, and do not proceed to Phase 1.

4. If everything passes, record "baseline: green" and continue. Worker agents will be told the baseline was green; they are not allowed to dismiss failures as pre-existing.

## Phase 1 — Fetch & Filter Issues

1. Fetch all open issues with the `claude-workqueue` label:

```bash
.claude/scripts/wq-gh.sh issue list --repo werkstattwaedi/machine-auth --label "claude-workqueue" --state open --json number,title,labels --limit 50
```

2. If `$ARGUMENTS` is a number, filter the list to only that issue. If the issue doesn't have the `claude-workqueue` label, warn and stop.

3. For each issue, classify its state:

   **Skip** if the issue has label `claude-workqueue-wip` (currently being worked on by another run).

   **Skip** if the issue has label `claude-workqueue-plan-review` (plan posted, waiting for human). Include it in the summary under "Plans awaiting review."

   **Skip** if a PR already exists for this issue:
   ```bash
   .claude/scripts/wq-gh.sh pr list --repo werkstattwaedi/machine-auth --search "head:workqueue/issue-<N>" --json number --jq 'length'
   ```

   **Re-check** if the issue has label `claude-workqueue-question` (waiting for human answer):
   - Fetch comments: `.claude/scripts/wq-gh.sh issue view <N> --repo werkstattwaedi/machine-auth --json comments`
   - Find the last comment containing `<!-- claude-workqueue -->` — that's the bot's question
   - If any human comment was posted AFTER that timestamp, remove the label and process
   - Otherwise skip

   **Process as IMPLEMENT** if an approved plan exists:
   - Comments contain one with marker `<!-- claude-workqueue-plan -->`
   - Label `claude-workqueue-plan-review` is absent (human removed it → approval)
   - The agent will read and follow that plan

   **Process as NEW** otherwise:
   - No plan yet and the issue is ready to triage (the agent decides: question / plan / trivial implement)

4. If no actionable issues remain, report it and continue to Phase 1b.

5. Print the classified list.

## Phase 1b — Fetch & Filter PRs with Review Feedback

1. Fetch all open PRs with `workqueue/issue-` branch prefix:

```bash
.claude/scripts/wq-gh.sh pr list --repo werkstattwaedi/machine-auth --search "head:workqueue/issue-" --state open --json number,title,headRefName,url --limit 50
```

2. For each PR, check for unaddressed review comments:

```bash
.claude/scripts/wq-gh.sh api repos/werkstattwaedi/machine-auth/pulls/<PR>/comments --jq '[.[] | select(.body | contains("<!-- claude-workqueue-ack -->") | not)] | length'
.claude/scripts/wq-gh.sh pr view <PR> --repo werkstattwaedi/machine-auth --json comments --jq '[.comments[] | select(.body | contains("<!-- claude-workqueue") | not)] | length'
```

   A PR needs attention if there are review comments without a `<!-- claude-workqueue-ack -->` reply, OR general comments that aren't from the bot.

3. Extract the issue number from the branch name (`workqueue/issue-<N>` → `N`).

4. Build a list of PRs needing review fixes. Print them.

**IMPORTANT — Pre-analyze before spawning agents:**

For each PR needing fixes, read the review comments and current code yourself first:

```bash
.claude/scripts/wq-gh.sh api repos/werkstattwaedi/machine-auth/pulls/<PR>/comments --jq '.[] | "File: \(.path):\(.line // .original_line)\n\(.body)\n---"'
```

Then read the relevant source files and craft a focused agent prompt that names the exact files, line numbers, and fix approach. Generic worker templates produce worse results than focused, specific prompts.

## Phase 2 — Process Each Issue (Sequential)

Process one issue at a time. Tests use emulators on fixed ports, so parallelism is unsafe.

Before processing any issue, verify the working tree is clean:

```bash
git status --porcelain
```

If dirty, stop and report — do NOT stash or discard the user's work.

### 2a. Mark as in-progress

```bash
.claude/scripts/wq-gh.sh issue edit <N> --add-label "claude-workqueue-wip" --repo werkstattwaedi/machine-auth
```

### 2b. Spawn the worker agent

Use the **Agent tool without `isolation`** (no worktree). The same agent handles both stages — triage/plan and implement — based on whether an approved plan already exists. Replace `<N>` and `<TITLE>`.

**Agent prompt template:**

```
You are a workqueue worker for GitHub issue #<N>: "<TITLE>".

CRITICAL RULES:
- You are working in the primary checkout — do NOT create or use git worktrees.
- Do NOT start a separate emulator — test scripts start their own. Never run `npm run dev` inside this agent.
- Every fix must include a regression test (see Step 4).
- Do NOT force-push. Do NOT modify `main`.
- **The full test suite (`npm run test:precommit`) was green before you started.** Any failure in Step 6 is caused by your changes — you may NOT explain it away as pre-existing.

## Step 1: Read the issue

.claude/scripts/wq-gh.sh issue view <N> --repo werkstattwaedi/machine-auth --json title,body,comments,labels

### Screenshots
If the body or comments contain image URLs (markdown images like ![...](https://...) or raw URLs to .png/.jpg/.gif/.webp files, or github user-attachment URLs):
1. For each image URL: curl -sL -o /tmp/issue-<N>-img-<i>.png "<url>"
2. Use the Read tool to view each downloaded image
3. Incorporate what you see into your understanding

### Detect approved plan
Look for a comment containing the marker `<!-- claude-workqueue-plan -->`. If one exists, that is the APPROVED plan — skip to Step 5 (Implement) and follow it. Do not re-triage.

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
```

### 2c. Handle the result

Parse the `WORKQUEUE_RESULT` line and update labels:

- **`implemented`** → remove `claude-workqueue-wip` and `claude-workqueue`. Record the PR URL.
- **`plan-posted`** → remove `claude-workqueue-wip` (the agent already added `claude-workqueue-plan-review`). Record under "Plans awaiting review."
- **`question`** → remove `claude-workqueue-wip`, add `claude-workqueue-question`.
- **`error`** → remove `claude-workqueue-wip`. Record the error. Do NOT remove `claude-workqueue`.

Also ensure the working tree is clean and the current branch is back on `main` (or the branch the user started on) before moving to the next issue:

```bash
git status --porcelain
git rev-parse --abbrev-ref HEAD
```

If the agent left the tree dirty or on a workqueue branch with uncommitted changes, stop and report — do NOT force-clean.

## Phase 2b — Process PRs with Review Feedback (Sequential)

For each PR with unaddressed review comments:

### 2b.1. Pre-analyze

Read the review comments, the current code on the PR branch, and the linked issue. Formulate a focused fix plan.

### 2b.2. Spawn fixup agent

Spawn an Agent (no worktree) with a focused prompt that includes:
- The PR number and branch name
- Instruction to `git fetch origin && git checkout <branch> && git pull --ff-only`
- The exact review comments verbatim, with file paths and line numbers
- The specific fix approach per comment
- **Regression test requirement:** if the review surfaced a behavior gap, add or update a regression test. If the review is cosmetic (wording, naming), a test may not be needed — say so explicitly.
- Run tests: `npm run test:precommit` (timeout 600000), and `npm run test:web:e2e` (timeout 600000) if UI files changed. If screenshot tests fail due to intentional changes, update snapshots.
- Commit and push to the same branch (no force-push).
- Reply to each addressed review comment with `<!-- claude-workqueue-ack -->` + a brief explanation of the fix.
- Output: `WORKQUEUE_RESULT: pr-fixed | <summary>` or `WORKQUEUE_RESULT: error | <what went wrong>`.

### 2b.3. Handle the result

- **`pr-fixed`** → record as fixed.
- **`error`** → record the error.

## Phase 3 — Summary

After all issues and PRs are processed, print:

```
## Workqueue Summary

### New Issues
| Issue | Title | Status | Details |
|-------|-------|--------|---------|
| #12   | Fix login bug | ✅ Implemented | PR #34 |
| #14   | Typo in nav | ✅ Implemented | PR #35 (trivial) |
| #15   | Add feature X | 📋 Plan posted | Awaiting review |
| #17   | Refactor Y | ❓ Question posted | Asked about scope |
| #18   | Widget redesign | ❌ Error | Test failure |
| #20   | Update Z | ⏭️ Skipped | PR already exists |

### PR Review Fixes
| PR | Title | Status | Details |
|----|-------|--------|---------|
| #73 | Fix nav buttons | ✅ Fixed | Addressed 1 review comment |
| #74 | Add feature | ❌ Error | Test failure |

### Plans awaiting review
Remove `claude-workqueue-plan-review` on each issue to approve:
- #15: [one-line summary]

### Pending questions
Re-run `/workqueue` after answering:
- #17: [question summary]
```

Omit sections with no entries.

## Reliability & Error Recovery

**The workqueue must run autonomously without manual intervention.**

### Running agents with monitoring

Run each worker agent in background (`run_in_background: true`). While waiting:

1. Record the start time.
2. Every ~5 minutes, spot-check progress:
   ```bash
   ps aux --sort=-pcpu | grep -E '(node|java|playwright|vitest|tsc|firebase)' | grep -v grep | head -10
   ```
   - Active processes (CPU > 0%): keep waiting.
   - Idle for 5+ minutes after last activity: agent may be stuck.
3. After 30 minutes with no result:
   - Remove `claude-workqueue-wip`.
   - Record as error: "Agent timed out after 30 minutes."
   - Move to the next issue.

### Agent failure handling

If an agent call returns an error (crash, rejection, timeout):
1. Always remove `claude-workqueue-wip`.
2. Record the failure in the summary.
3. Move to the next issue — never stop the queue for one failure.
4. **Never run `git worktree` commands** — since we don't create them, there is nothing to clean up. If you see a stray worktree, report it and leave it alone.

### Keep agents simple

- No sub-agents inside worker agents — don't spawn code-reviewer or other agents from within the worker.
- Minimal steps: read → plan OR implement → test → commit → push → PR.

## Agent Prompt Guidelines

**Pre-analyze before spawning agents.**

Before spawning an agent for any task:
1. Read the issue/PR comments yourself.
2. Read the relevant source files.
3. Write a focused prompt that names specific files, line numbers, and the expected `WORKQUEUE_RESULT` line.
