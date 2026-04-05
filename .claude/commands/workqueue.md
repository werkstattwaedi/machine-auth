---
description: Process GitHub issues labeled "claude-workqueue". Fetches issues, spawns isolated sub-agents to implement fixes or ask clarifying questions, then summarizes results.
---

# /workqueue

Process the `claude-workqueue` issue queue. Re-runnable — skips issues already handled or awaiting answers.

**Arguments:** $ARGUMENTS (optional issue number to process only that issue)

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
3. Add tests if the change warrants them
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

## Step 6: Code Review

Invoke the code-reviewer agent to review your changes:
Use the Agent tool with subagent_type="code-reviewer" and prompt="Review the current uncommitted changes for quality and consistency."

Address any serious issues flagged. Minor suggestions can be noted but don't need to block.

## Step 7: Commit

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

## Phase 3 — Summary

After all issues are processed, print a summary:

```
## Workqueue Summary

| Issue | Title | Status | Details |
|-------|-------|--------|---------|
| #12   | Fix login bug | ✅ Implemented | PR #34 |
| #15   | Add feature X | ❓ Question posted | Asked about scope |
| #18   | Refactor Y | ❌ Error | Build failed |
| #20   | Update Z | ⏭️ Skipped | PR already exists |

### Pending Questions

Issues waiting for human answers (re-run `/workqueue` after answering):
- #15: [question summary]
```

If there are no pending questions, omit that section.

## Important Constraints

- Process issues **sequentially** (tests use emulators on fixed ports)
- Each issue runs in an **isolated worktree** via the Agent tool's `isolation: "worktree"` parameter
- **Never** force-push or modify the main branch
- Ensure labels are always cleaned up, even on errors
- Create the `claude-workqueue-wip` and `claude-workqueue-question` labels if they don't exist (idempotent)
