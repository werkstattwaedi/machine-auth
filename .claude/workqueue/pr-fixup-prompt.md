# Workqueue PR-fixup prompt recipe

This is the recipe the `/workqueue` orchestrator follows when constructing a
prompt for a sub-Agent that addresses review feedback on an open workqueue
PR. Unlike `worker-prompt.md`, this is NOT a fixed template — the
orchestrator builds a **focused** prompt for each PR by reading the review
comments and current code itself first, then naming exact files and fix
approaches in the agent's prompt. Focused prompts beat generic templates.

## Recipe (what the orchestrator does)

1. **Pre-analyze** before spawning:
   ```bash
   .claude/scripts/wq-gh.sh api repos/werkstattwaedi/machine-auth/pulls/<PR>/comments --jq '.[] | "File: \(.path):\(.line // .original_line)\n\(.body)\n---"'
   .claude/scripts/wq-gh.sh pr view <PR> --repo werkstattwaedi/machine-auth --json comments,headRefName,title
   ```
   Read the relevant source files on the PR branch yourself.
2. **Build a focused prompt** from the skeleton below, filling in:
   - The PR number, branch name, and title.
   - The exact review comments verbatim (file:line + body), as a numbered list.
   - The specific fix approach you've decided on per comment.
   - Whether regression coverage is needed (yes for behavior gaps; no for cosmetic/wording).
3. **Spawn the Agent** with no isolation, in background.

## Skeleton (substitute fields then pass to Agent)

```
You are a workqueue PR-fixup worker for PR #<PR> ("<TITLE>"), branch <BRANCH>.

CRITICAL RULES:
- You are working in the primary checkout — do NOT create or use git worktrees.
- Do NOT start a separate emulator — test scripts start their own.
- Do NOT force-push. Stay on the PR's branch.
- The baseline (`npm run test:precommit` + `npm run test:web:e2e`) was green
  before review comments arrived. Any test failure after your fixes is caused
  by your changes — you may NOT dismiss failures as pre-existing.

## Step 1: Sync the branch

git fetch origin
git checkout <BRANCH>
git pull --ff-only origin <BRANCH>

## Step 2: Address the review comments

Each comment below has a specific fix the orchestrator already worked out.
Follow them. If you disagree with one, STOP and output:
WORKQUEUE_RESULT: error | disagreed with fix approach on comment N — <why>

<numbered list of review comments + fix approaches, e.g.:>

1. **`web/apps/checkout/src/foo.tsx:42`** — Reviewer asked why we mutate
   `props.children`. Fix: replace the mutation with a fresh array; the
   render path doesn't depend on identity. After the fix, the rendered
   output is unchanged — see existing snapshot.

2. **`functions/src/bar.ts:88`** — Reviewer flagged missing null check
   on `userDoc.data()`. Fix: early-return with `console.warn` when
   data is undefined; add a unit test in `bar.test.ts` that passes a
   missing-doc fixture and asserts no throw.

## Step 3: Regression tests

<one of:>
- **REQUIRED:** add/update <file> to assert <behavior>. <Reason: review
  surfaced a behavior gap.>
- **NOT REQUIRED:** review comments were cosmetic (wording/naming). No
  test changes.

## Step 4: Run tests

Run with `timeout: 600000`:
npm run test:precommit

If any file under `web/` changed, also run with `timeout: 600000`:
npm run test:web:e2e

If screenshot tests fail and the new UI is intentional, update snapshots:
firebase emulators:exec --config firebase.e2e.json \
  --only firestore,auth,functions \
  'cd web/apps/checkout && npx playwright test --update-snapshots'
Re-run to confirm green; include updated snapshots in the commit.

## Step 5: Commit and push

Stage only the files you changed. Never `git add -A`.

git add <specific files>
git commit -m "$(cat <<'EOF'
fixup: address review on PR #<PR>

<one-line summary of what changed>

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
git push origin <BRANCH>

## Step 6: Acknowledge each review comment

For each addressed review comment, reply on the PR review thread with:

.claude/scripts/wq-gh.sh api repos/werkstattwaedi/machine-auth/pulls/<PR>/comments/<COMMENT_ID>/replies -X POST -f body="$(cat <<'EOF'
<!-- claude-workqueue-ack -->
Fixed in <SHORT_SHA>: <one-line explanation>
EOF
)"

## Step 7: Report

Output EXACTLY:
WORKQUEUE_RESULT: pr-fixed | <one-line summary>

## Error handling

WORKQUEUE_RESULT: error | <what went wrong>

Always output a `WORKQUEUE_RESULT` line.
```
