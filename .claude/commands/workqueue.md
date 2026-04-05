---
description: Process GitHub issues labeled "claude-workqueue" and address review comments on open workqueue PRs. Fetches issues, spawns sub-agents to implement fixes or ask clarifying questions, then summarizes results.
---

# /workqueue

Process the `claude-workqueue` issue queue and open workqueue PRs with review feedback. Re-runnable — skips issues already handled or awaiting answers.

**Arguments:** $ARGUMENTS (optional issue number or PR number to process only that item)

## Phase 1 — Fetch & Filter Issues

1. Fetch all open issues with the `claude-workqueue` label:

```bash
gh issue list --repo werkstattwaedi/machine-auth --label "claude-workqueue" --state open --json number,title,labels --limit 50
```

2. If `$ARGUMENTS` is a number, filter the list to only that issue. If the issue doesn't have the `claude-workqueue` label, warn and stop.

3. For each issue, determine if it should be processed or skipped:

   **Skip if** the issue has label `claude-workqueue-wip` (currently being worked on by another run).

   **Skip if** a PR already exists for this issue:
   ```bash
   gh pr list --repo werkstattwaedi/machine-auth --search "head:workqueue/issue-<N>" --json number --jq 'length'
   ```
   If result > 0, skip.

   **Re-check if** the issue has label `claude-workqueue-question` (waiting for human answer):
   - Fetch comments: `gh issue view <N> --repo werkstattwaedi/machine-auth --json comments`
   - Find the last comment containing `<!-- claude-workqueue -->` — that's the bot's question
   - Check if any human comment was posted AFTER the bot's question (by comparing timestamps)
   - If a human replied: remove the `claude-workqueue-question` label and process the issue
   - If no human reply: skip

4. If no actionable issues remain, report "No issues to process in the workqueue." and stop.

5. Print the list of issues to be processed.

## Phase 1b — Fetch & Filter PRs with Review Feedback

1. Fetch all open PRs with `workqueue/issue-` branch prefix:

```bash
gh pr list --repo werkstattwaedi/machine-auth --search "head:workqueue/issue-" --state open --json number,title,headRefName,url --limit 50
```

2. For each PR, check for unaddressed review comments:

```bash
# Get review comments (inline code comments)
gh api repos/werkstattwaedi/machine-auth/pulls/<PR>/comments --jq '[.[] | select(.body | contains("<!-- claude-workqueue-ack -->") | not)] | length'
# Get general PR comments (not from bot)
gh pr view <PR> --repo werkstattwaedi/machine-auth --json comments --jq '[.comments[] | select(.body | contains("<!-- claude-workqueue") | not)] | length'
```

   A PR needs attention if there are review comments without a `<!-- claude-workqueue-ack -->` reply, OR general comments that aren't from the bot.

3. Extract the issue number from the branch name (`workqueue/issue-<N>` → `N`).

4. Build a list of PRs needing review fixes. Print them.

**IMPORTANT — Pre-analyze before spawning agents:**

For each PR needing fixes, **read the review comments yourself first** using:
```bash
gh api repos/werkstattwaedi/machine-auth/pulls/<PR>/comments --jq '.[] | "File: \(.path):\(.line // .original_line)\n\(.body)\n---"'
```

Then read the relevant source files to understand the current state. Use this understanding to write a **focused, specific agent prompt** that includes:
- The exact files and line numbers to modify
- What the reviewer asked for
- The specific fix approach

Do NOT send the generic worker template for PR fixes. Short, focused prompts work much better.

## Phase 2 — Process Each Issue (Sequential)

For each actionable issue, one at a time:

### 2a. Mark as in-progress

```bash
gh issue edit <N> --add-label "claude-workqueue-wip" --repo werkstattwaedi/machine-auth
```

### 2b. Spawn worker agent

Use the **Agent tool** with `isolation: "worktree"` to process the issue in a clean copy of the repo. Use the prompt template below, replacing `<N>` with the issue number and `<TITLE>` with the issue title:

---

**Agent prompt template:**

```
You are a workqueue worker processing GitHub issue #<N>: "<TITLE>".

## Step 1: Read the Issue

Fetch the full issue:
gh issue view <N> --repo werkstattwaedi/machine-auth --json title,body,comments,labels

Read the title, body, and all comments carefully.

### Screenshots
If the body or comments contain image URLs (markdown images like ![...](https://...) or raw URLs to .png/.jpg/.gif/.webp files, or github user-attachment URLs):
1. For each image URL, download it: curl -sL -o /tmp/issue-<N>-img-<i>.png "<url>"
2. Use the Read tool to view each downloaded image
3. Incorporate what you see into your understanding

## Step 2: Assess Feasibility

Determine if you have enough information to implement a fix.

**Enough info means ALL of:**
- The problem or desired change is clearly described
- You can identify which files/modules are affected
- The expected behavior is unambiguous
- No major design decisions need human input

**Not enough info means ANY of:**
- The description is vague, contradictory, or incomplete
- Multiple valid approaches exist and the issue doesn't indicate a preference
- You need clarification on acceptance criteria
- Referenced files/APIs don't exist or you can't find them

### If NOT enough info:

Post a comment asking specific questions:

gh issue comment <N> --repo werkstattwaedi/machine-auth --body "$(cat <<'COMMENT_EOF'
<!-- claude-workqueue -->
## Questions before I can work on this

I'd like to implement this but need clarification:

1. [specific question]
2. [specific question]

I'll pick this up automatically on the next `/workqueue` run after you answer.
COMMENT_EOF
)"

Then output EXACTLY this (and nothing else after):
WORKQUEUE_RESULT: question | <one-line summary of what you asked>

### If enough info:

Continue to Step 3.

## Step 3: Understand the Codebase

1. Read CLAUDE.md for project conventions and build commands
2. Explore the relevant code areas — understand existing patterns before changing anything
3. This project is web + functions only for workqueue scope (skip issues that only affect maco_firmware/)

If the issue only affects firmware (maco_firmware/), post a comment:

gh issue comment <N> --repo werkstattwaedi/machine-auth --body "$(cat <<'COMMENT_EOF'
<!-- claude-workqueue -->
## Scope limitation

This issue appears to only affect firmware code (maco_firmware/). The workqueue currently handles web and functions code only. Please handle this issue manually or adjust the scope.
COMMENT_EOF
)"

Then output: WORKQUEUE_RESULT: question | Issue only affects firmware, out of workqueue scope

## Step 4: Implement the Fix

1. Create a branch: git checkout -b workqueue/issue-<N>
2. Make focused, minimal changes following project conventions
3. **Every change must be covered by tests:**
   - **Logic changes** (bug fixes, new behavior, state management): add or update **unit tests** (Vitest, in `*.test.{ts,tsx}` next to the source file)
   - **Layout/UI changes** (styling, visibility, positioning, new components): add or update **e2e screenshot tests** (Playwright, in `web/apps/checkout/e2e/*.spec.ts`) to capture the visual state
   - If a change affects both logic and layout, add both
4. Keep changes scoped to what the issue asks for — no drive-by refactoring

## Step 5: Run Tests

### 5a. Unit + integration tests
Run with a 10-minute timeout (use the Bash tool's `timeout` parameter set to 600000):
```bash
npm run test:precommit
```

If tests fail:
- Analyze the failure
- If related to your changes: fix and re-run
- If unrelated: note it but continue
- If you cannot get tests passing after 2 attempts, report the failure
- If the command times out, report it as an error — do NOT retry

### 5b. E2E tests (if UI changed)
If your changes touch any files under `web/` (components, pages, styles, layouts), also run the e2e tests with a 10-minute timeout (use the Bash tool's `timeout` parameter set to 600000):

```bash
npm run test:web:e2e
```

If screenshot tests fail because your UI changes are intentional, update the snapshots:
```bash
firebase emulators:exec --config firebase.e2e.json \
  --only firestore,auth,functions \
  'cd web/apps/checkout && npx playwright test --update-snapshots'
```

Then re-run `npm run test:web:e2e` to confirm they pass. Include the updated snapshot files in your commit.

If any test command times out, do NOT retry — report the timeout and continue to commit what you have.

## Step 6: Commit

Stage only the files you changed (never git add -A). Include updated screenshot snapshots if any:
git add <specific files>
git add web/apps/checkout/e2e/*.spec.ts-snapshots/*.png  # only if snapshots were updated
git commit -m "$(cat <<'EOF'
<type>: <description>

Closes #<N>

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

Use appropriate type: fix, feat, refactor, test, docs, etc.

## Step 8: Push and Create PR

git push -u origin workqueue/issue-<N>

gh pr create --repo werkstattwaedi/machine-auth --title "<concise title>" --body "$(cat <<'PR_EOF'
## Summary

<what was changed and why, 1-3 bullets>

Closes #<N>

## Test Results

<pass/fail summary from Step 5>

---
🤖 Automated by `/workqueue`
PR_EOF
)"

## Step 9: Report Result

Output EXACTLY (with the actual PR URL):
WORKQUEUE_RESULT: implemented | <one-line summary> | <PR URL>

## Error Handling

If anything goes wrong that you cannot recover from, output:
WORKQUEUE_RESULT: error | <what went wrong>

Never leave uncommitted changes without reporting. Always provide a WORKQUEUE_RESULT line.
```

---

### 2c. Handle the result

Parse the `WORKQUEUE_RESULT` line from the agent's output:

- **`implemented`**: Remove `claude-workqueue-wip` and `claude-workqueue` labels. Record the PR URL.
- **`question`**: Remove `claude-workqueue-wip` label, add `claude-workqueue-question` label.
- **`error`**: Remove `claude-workqueue-wip` label. Record the error.

```bash
# Example label management:
gh issue edit <N> --remove-label "claude-workqueue-wip" --repo werkstattwaedi/machine-auth
gh issue edit <N> --remove-label "claude-workqueue" --repo werkstattwaedi/machine-auth  # only on success
gh issue edit <N> --add-label "claude-workqueue-question" --repo werkstattwaedi/machine-auth  # only on question
```

If label doesn't exist yet, create it first:
```bash
gh label create "claude-workqueue-wip" --color "FFA500" --description "Workqueue: in progress" --repo werkstattwaedi/machine-auth 2>/dev/null || true
gh label create "claude-workqueue-question" --color "D93F0B" --description "Workqueue: needs human answer" --repo werkstattwaedi/machine-auth 2>/dev/null || true
```

## Phase 2b — Process PRs with Review Feedback (Sequential)

For each PR with unaddressed review comments, one at a time:

### 2b.1. Pre-analyze

Read the review comments, the current code on the PR branch, and the linked issue to understand what's being asked. Formulate a focused fix plan.

### 2b.2. Spawn fixup agent

Spawn an Agent (no worktree — work directly on the PR branch) with a **focused prompt** containing:
- The PR number and branch name
- Instruction to `git checkout <branch>` and `git pull`
- The exact review comments and what needs to change
- Specific files and line numbers
- The fix approach
- Instruction to run tests (`npm run test:precommit` with timeout 600000, and `npm run test:web:e2e` with timeout 600000 if UI files changed)
- If screenshot tests fail due to intentional changes, update snapshots
- Commit, push to the same branch (no force push)
- Reply to each addressed review comment with `<!-- claude-workqueue-ack -->` + a brief explanation of the fix
- Output: `WORKQUEUE_RESULT: pr-fixed | <summary>` or `WORKQUEUE_RESULT: error | <what went wrong>`

### 2b.3. Handle the result

- **`pr-fixed`**: Record as fixed in summary.
- **`error`**: Record the error in summary.

## Phase 3 — Summary

After all issues and PRs are processed, print a summary:

```
## Workqueue Summary

### New Issues
| Issue | Title | Status | Details |
|-------|-------|--------|---------|
| #12   | Fix login bug | ✅ Implemented | PR #34 |
| #15   | Add feature X | ❓ Question posted | Asked about scope |
| #18   | Refactor Y | ❌ Error | Build failed |
| #20   | Update Z | ⏭️ Skipped | PR already exists |

### PR Review Fixes
| PR | Title | Status | Details |
|----|-------|--------|---------|
| #73 | Fix nav buttons | ✅ Fixed | Addressed 1 review comment |
| #74 | Add feature | ❌ Error | Test failure |

### Pending Questions
Issues waiting for human answers (re-run `/workqueue` after answering):
- #15: [question summary]
```

Omit any section that has no entries.

## Important Constraints

- Process issues **sequentially** (tests use emulators on fixed ports)
- **Never** force-push or modify the main branch
- Ensure labels are always cleaned up, even on errors
- Create the `claude-workqueue-wip` and `claude-workqueue-question` labels if they don't exist (idempotent)

## Reliability & Error Recovery

**The workqueue must run autonomously without manual intervention.**

### Running agents with monitoring

**Run each worker agent in background** (`run_in_background: true`). While waiting for the notification:

1. **Record the start time** (note the current time before spawning).
2. **Every 5 minutes**, check that the agent is still making progress:
   ```bash
   # Check CPU activity of child processes (node, java, playwright, etc.)
   ps aux --sort=-pcpu | grep -E '(node|java|playwright|vitest|tsc|firebase)' | grep -v grep | head -10
   ```
   - If processes are active (CPU > 0%), the agent is working — continue waiting.
   - If no relevant processes are running and 5+ minutes have passed since the last check, the agent may be stuck.
3. **After 30 minutes**, if no result has been returned, treat it as a timeout:
   - Clean up: remove `claude-workqueue-wip` label, clean worktrees
   - Record as error: "Agent timed out after 30 minutes"
   - Move to the next issue

### Agent failure handling

If an agent call returns an error (crash, rejection, timeout):
1. **Always clean up**: remove `claude-workqueue-wip` label
2. **Record the failure** with the error message in the summary
3. **Move to the next issue** — never stop the entire queue for one failure
4. **Clean up worktrees**: `git worktree list` and remove any stale worktrees from failed agents

### Keep agents simple

- **No sub-agents inside worker agents** — don't spawn code-reviewer or other agents from within the worker. This adds fragility.
- **Minimal steps**: implement → test → commit → push → create PR. That's it.

## Agent Prompt Guidelines

**Pre-analyze issues before spawning agents** to reduce agent work time.

Before spawning an agent for any task (new issue or PR fix):
1. **Read the issue/comments yourself first** — understand what needs to happen
2. **Read the relevant source files** — identify exact files and line numbers
3. **Write a focused prompt** with:
   - Specific files to modify and what to change
   - The branch to use (`workqueue/issue-<N>`)
   - Concrete test/commit/push/PR instructions
   - Expected output format (`WORKQUEUE_RESULT: ...`)
