---
description: Autonomous queue processor. Stays branches up-to-main, self-heals mechanical baseline failures, processes claude-workqueue issues and PR review feedback, scores each PR, and posts a daily digest. Runs as a long-running loop in tmux with Remote Control for push notifications when input is needed.
---

# /workqueue

Autonomous engineering loop. Designed to run from a long-running tmux pane
via `.claude/scripts/workqueue-loop.sh` (see "Loop setup" below); also safe
to invoke interactively for one-off runs.

**Arguments:** `$ARGUMENTS` (optional issue number or PR number to process only
that item; in that mode the idle-gate, baseline self-heal, and digest phases
are skipped — only that single item is handled.)

## Phase flow (state machine)

Phases run in order. Each phase's exit determines the next. `STOP` ends the
run.

```
Phase 0  idle gate
  ├─ no work                    → STOP (WORKQUEUE_RESULT: idle)
  └─ has work                   → Phase 1
Phase 1   stay up to main       → Phase 1b
Phase 1b auto-merge approved   → Phase 2
Phase 2   baseline + self-heal
  ├─ green / push-direct safe   → Phase 3
  ├─ fix-PR opened              → Phase 5 (score fix-PR) → Phase 6 → STOP
  ├─ escalated (issue filed)    → STOP
  └─ baseline-red (interactive) → STOP
Phase 3   fetch issues          → Phase 3b
Phase 3b  fetch PR feedback     → Phase 4
Phase 4   process each issue    → Phase 4b
Phase 4b  process PR feedback   → Phase 5
Phase 5   confidence scoring    → Phase 6
Phase 6   daily digest          → Phase 7
Phase 7   stdout summary        → STOP
```

**Interactive single-item mode** (`$ARGUMENTS` is a number):
- Phase 0, 1, 1.5, Phase 2 self-heal, and Phase 6 are skipped.
- Phase 2 still runs the baseline; red baseline → STOP.
- Phase 3 / 3b filters to just the requested item.
- Phase 5 runs against the one item if it produced a PR.

**Support files** (read by the orchestrator when needed; not slash commands):
- `.claude/workqueue/worker-prompt.md` — issue-worker prompt template (Phase 4b).
- `.claude/workqueue/pr-fixup-prompt.md` — PR-review-fixup prompt recipe (Phase 4b.2).

## Core rules

1. **Never use git worktrees.** The operations repo setup requires working in the main checkout, and the Firebase emulators bind to fixed ports — parallel worktrees cause test hangs and port conflicts. Do NOT pass `isolation: "worktree"` to the Agent tool. Process issues sequentially on the primary working directory.
2. **Plan-first for non-trivial issues.** For anything beyond a clearly trivial fix, post a short plan as an issue comment and wait for human approval before implementing. The human approves by removing the `claude-workqueue-plan-review` label.
3. **Regression tests are mandatory.** Every fix must include a test that would have caught the bug or that locks in the new behavior. If a regression test is genuinely impractical, the plan must explicitly request an exception and explain why — the human decides during plan review.
4. **All `gh` calls go through `.claude/scripts/wq-gh.sh`**, which authenticates as the workqueue GitHub App so comments, PRs, and review acks are attributed to the bot rather than the local user. `git push` and other `git` commands keep using the user's credentials — commits remain the user's.
5. **Human approval is the merge gate; the bot handles the mechanics.** The human signal is a GitHub PR review with `APPROVED` state. Once a PR is approved, the workqueue is responsible for getting it merged: rebase onto main if behind, resolve trivial conflicts (lockfiles, snapshots), enable GitHub's native auto-merge so it lands as soon as CI is green. This applies to *any* approved PR in the repo (workqueue-produced or otherwise) — if you reviewed it and clicked Approve, the bot finishes the job. Confidence scoring (Phase 5) still runs on workqueue PRs to make the review itself fast. The one carve-out for skipping the PR entirely is **Phase 2 push-direct**: regenerated test artifacts (Playwright/Vitest snapshots, npm lockfiles) may be pushed straight to `main` without a PR, because there is no reviewable judgment in a snapshot diff.
6. **Bounded self-heal only.** Baseline failures may be auto-fixed *only* when they are mechanical (snapshot drift, lockfile drift) or a clear test-side hermeticity issue with an obvious, small fix. Any prod-behavior change, ambiguity, or multi-file scope must be escalated as a `claude-workqueue` issue instead. Default to escalating.

## Termination signal (every exit path)

The `workqueue-loop.sh` wrapper runs `claude` interactively in a tmux pane
and watches for a signal file at `$WORKQUEUE_SIGNAL_FILE`. **Every** path
that ends the run — normal Phase 7 completion, idle gate, dirty tree,
baseline-red, baseline-fix-pr, baseline-escalated, or any error — MUST,
as its final tool call, touch that file:

```bash
if [[ -n "${WORKQUEUE_SIGNAL_FILE:-}" ]]; then
  touch "$WORKQUEUE_SIGNAL_FILE"
fi
```

When the wrapper sees the file, it sends `/exit` to the pane and claude
shuts down, letting the loop's next iteration fire. Without this, the
wrapper sits forever waiting at the prompt after an early-abort path.

If you're running `/workqueue` outside the loop wrapper (manual run, env
var unset), the snippet is a harmless no-op — claude returns to its
prompt and you type `/exit` yourself.

## Setup (one-time)

The workqueue authenticates as a GitHub App so issue comments don't look like you talking to yourself. Do these once per machine:

> **Keep in sync with [`docs/bootstrap.md` §13](../../docs/bootstrap.md#13-workqueue-github-app-optional--claude-code-only)** — the fresh-machine guide has the same steps. Update both when changing the setup.

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

## Loop setup (long-running in tmux)

`.claude/scripts/workqueue-loop.sh` is a foreground script you run in a
tmux pane you leave open. Each iteration: cheap GH pre-check → if work
exists, hand the pane to an interactive `claude` session running
`/workqueue` → claude self-exits via the Termination signal → wrapper
**re-checks immediately** (the pre-check is ~3 cheap `gh` calls, and the
real minimum iteration time is the baseline ~15min inside claude, so
this can't tight-loop). When the pre-check eventually returns "no work",
the wrapper sleeps `WORKQUEUE_IDLE_INTERVAL` (default 1h) and re-checks.

Why not cron? Cron requires `claude -p` non-interactive mode, which means
no Remote Control (no push notifications when a worker asks a question,
no remote permission approval). Running interactively in a tmux pane
you can detach gets you the same "fires every few hours" behavior plus
an open channel for the workqueue to ask you things mid-run.

Run it:

```bash
# In a tmux pane you can leave running (the script refuses to start
# outside tmux because Phase 7's self-exit depends on tmux send-keys):
cd ~/werkstattwaedi/machine-auth
./.claude/scripts/workqueue-loop.sh
```

Detach the tmux pane (`Ctrl-b d`) and it keeps running. `tmux attach -t
<session>` to peek. Ctrl-C in the wrapper stops the loop; an in-flight
claude session is not killed (it exits on its own via Phase 7).

Each iteration writes one line to `~/.claude/logs/workqueue/last-run.txt`
so you can `tail -f` it to see the loop's heartbeat. Logs older than
14d are auto-pruned.

### Remote Control

Permission prompts and worker `SendUserMessage` calls forward to whatever
device you've paired with the Claude Remote Control session named
`workqueue` (same name across iterations — bookmark the URL once). The
script passes:

- `--permission-mode auto` — forwards permission requests to Remote Control rather than auto-skipping. The harness's safety classifier stays active.
- `--remote-control workqueue` — stable session name.
- `--brief` — enables `SendUserMessage` so worker agents can ask you things via Remote Control.

This is materially safer than the unattended `-p --dangerously-skip-permissions`
pattern: the classifier and your phone are both in the loop.

### Trust model (read before leaving the loop running unattended)

Even with `--permission-mode auto` + Remote Control, a few environment
hardening steps are still worth doing for the WSL host that runs the
loop:

1. **Disable `/mnt/c` automount** in `/etc/wsl.conf`:
   ```ini
   [automount]
   enabled = false
   ```
   Then `wsl --shutdown` from Windows. The workqueue cannot reach
   Windows files at all. Highest-leverage 2-minute change.
2. **Branch protection on `main`** in GitHub: require PR review (and CI
   green) for merges. Phase 1b honors GitHub's auto-merge, so approved
   PRs still land — but a runaway worker can't push directly to main
   except via Phase 2's narrow safe-path push-direct carve-out.
3. **GitHub App scope is repo-only** (already configured in Setup §1).
   A leaked installation token compromises this repo, not your account.
4. **Working tree must be clean** between runs — the workqueue enforces
   this. Anything left dirty stops the next iteration with a report.

What is NOT mitigated: npm supply-chain attacks, prompt-injected issue
bodies trashing the local checkout *during* a run (only caught
*between* runs by the clean-tree check), or any side effect of code the
worker legitimately runs.

For stronger isolation (dedicated unprivileged user, `bwrap` sandbox per
run), the patterns are standard but not configured by this script.

### Environment overrides

Set in `~/.config/workqueue-app/env` or your shell rc:
- `WORKQUEUE_IDLE_INTERVAL` — sleep when the queue is empty, passed to `sleep(1)` (default `1h`). Accepts `30m`, `2h`, etc. There is no sleep between successive runs when work remains — the wrapper just re-checks and fires claude again.
- `CLAUDE_BIN` — path to the `claude` CLI (default `claude` on PATH).

## State machine (labels)

| Label | Meaning |
|-------|---------|
| `claude-workqueue` | In the queue, ready for processing |
| `claude-workqueue-wip` | Currently being worked by a `/workqueue` run |
| `claude-workqueue-question` | Waiting for a human to answer a clarifying question |
| `claude-workqueue-plan-review` | A plan has been posted; waiting for human to review and approve |
| `wq-baseline-fix` | PR that auto-heals a baseline failure (snapshot/lockfile/hermeticity) |
| `wq-low-risk` | PR scored ≥8 by the confidence rubric (Phase 5) |
| `wq-medium` | PR scored 5–7 |
| `wq-needs-review` | PR scored <5, or touches security/schema/auth |

Ensure all labels exist (idempotent):

```bash
.claude/scripts/wq-gh.sh label create "claude-workqueue-wip" --color "FFA500" --description "Workqueue: in progress" --repo werkstattwaedi/machine-auth 2>/dev/null || true
.claude/scripts/wq-gh.sh label create "claude-workqueue-question" --color "D93F0B" --description "Workqueue: needs human answer" --repo werkstattwaedi/machine-auth 2>/dev/null || true
.claude/scripts/wq-gh.sh label create "claude-workqueue-plan-review" --color "1D76DB" --description "Workqueue: plan posted, needs human approval" --repo werkstattwaedi/machine-auth 2>/dev/null || true
.claude/scripts/wq-gh.sh label create "wq-baseline-fix" --color "5319E7" --description "Workqueue: baseline auto-fix (snapshot/lockfile/hermeticity)" --repo werkstattwaedi/machine-auth 2>/dev/null || true
.claude/scripts/wq-gh.sh label create "wq-low-risk" --color "0E8A16" --description "Workqueue: confidence ≥8 (low risk)" --repo werkstattwaedi/machine-auth 2>/dev/null || true
.claude/scripts/wq-gh.sh label create "wq-medium" --color "FBCA04" --description "Workqueue: confidence 5–7" --repo werkstattwaedi/machine-auth 2>/dev/null || true
.claude/scripts/wq-gh.sh label create "wq-needs-review" --color "B60205" --description "Workqueue: confidence <5 or sensitive area" --repo werkstattwaedi/machine-auth 2>/dev/null || true
```

## Phase 0 — Idle gate

> Skip this phase when `$ARGUMENTS` is set (a targeted single-item run is
> always considered "has work").

The cron wrapper does a cheap pre-check before invoking Claude, but if you're
running this interactively without arguments, do the same gate here so you
don't waste the baseline run on nothing:

```bash
.claude/scripts/wq-gh.sh issue list --repo werkstattwaedi/machine-auth --label "claude-workqueue" --state open --json number,labels --limit 50
.claude/scripts/wq-gh.sh pr list   --repo werkstattwaedi/machine-auth --search "head:workqueue/issue-" --state open --json number,mergeStateStatus,reviewDecision --limit 50
```

Work exists if **any** of these is true:
- An open `claude-workqueue` issue does NOT have `claude-workqueue-wip` or `claude-workqueue-plan-review`.
- An open `claude-workqueue-question` issue has a human comment after the last `<!-- claude-workqueue -->` comment.
- An open `workqueue/issue-*` PR has review comments without `<!-- claude-workqueue-ack -->`.
- An open `workqueue/issue-*` PR has `mergeStateStatus` of `BEHIND` (needs rebase) or `DIRTY` (conflicts).
- **Any** open PR in the repo has `reviewDecision: APPROVED` (Phase 1b will try to land it).

If none of these match, stop here and output:
```
WORKQUEUE_RESULT: idle | no actionable work
```

## Phase 1 — Stay up to main

> Skip this phase when `$ARGUMENTS` is set.

Verify the working tree is clean and on a known branch first:

```bash
git status --porcelain
git rev-parse --abbrev-ref HEAD
```

If the tree is dirty, stop and report — do NOT stash or discard.

Fast-forward main:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
```

For each open `workqueue/issue-*` PR, rebase it onto the new main if it's
behind or has conflicts:

```bash
.claude/scripts/wq-gh.sh pr list --repo werkstattwaedi/machine-auth \
  --search "head:workqueue/issue-" --state open \
  --json number,headRefName,mergeStateStatus --limit 50
```

For each PR with `mergeStateStatus` in `{BEHIND, DIRTY}`:

1. `git fetch origin && git checkout <branch> && git pull --ff-only origin <branch>` (sync the local copy).
2. `git rebase origin/main`.
3. **If the rebase succeeds cleanly** → `git push --force-with-lease`. Move on.
   (`--force-with-lease` is the only acceptable force-push: it refuses if
   someone else pushed in the meantime. The branch is bot-owned, so this
   is safe.)
4. **If the rebase has conflicts**, try mechanical resolutions in order:
   - Lockfile conflicts (`package-lock.json`, `web/package-lock.json`, `functions/package-lock.json`): `git checkout --theirs <lockfile>` then `npm install` in the affected package dir to regenerate against rebased state. `git add <lockfile>` and continue.
   - Generated files (snapshots under `web/apps/checkout/e2e/*-snapshots/`): `git checkout --theirs <files>`, plan to regenerate in Phase 2.
   - If conflicts remain in handwritten source files: abort the rebase (`git rebase --abort`), post a PR comment explaining which files conflict and that human resolution is needed:
     ```bash
     .claude/scripts/wq-gh.sh pr comment <PR> --repo werkstattwaedi/machine-auth --body "$(cat <<'EOF'
     <!-- claude-workqueue -->
     ## Rebase conflict needs human attention
     
     Tried to rebase this branch onto the latest main but hit conflicts in
     handwritten source files I'm not confident resolving autonomously:
     
     - `path/to/file.ts`
     - `path/to/other.tsx`
     
     Please rebase manually. Subsequent `/workqueue` runs will skip the
     rebase step on this PR until the conflict is resolved.
     EOF
     )"
     ```
     Then return to main: `git rebase --abort; git checkout main`.

After processing all PRs, end on `main` with a clean tree.

## Phase 1b — Auto-merge approved PRs

> Skip this phase when `$ARGUMENTS` is set.

The human signal is `reviewDecision: APPROVED` on a PR. Once that's set,
the workqueue's job is to land the PR. This phase applies to **any open
PR in the repo**, not just workqueue-produced ones — if you reviewed it
and approved it, the bot finishes the job.

> **One-time setup:** the repo must have auto-merge enabled in GitHub
> settings (Settings → General → Pull Requests → "Allow auto-merge").
> If it's not enabled, `gh pr merge --auto` will error out and we'll
> fall back to immediate merge when conditions are met.

Fetch the candidate set:

```bash
.claude/scripts/wq-gh.sh pr list --repo werkstattwaedi/machine-auth \
  --state open \
  --search "review:approved" \
  --json number,headRefName,mergeStateStatus,autoMergeRequest,url,title \
  --limit 50
```

For each approved PR:

1. **If `autoMergeRequest` is non-null** → GitHub auto-merge is already
   enabled. Move on; GitHub will land it when CI passes. (We may still
   need to rebase it — handled in step 3.)

2. **Inspect `mergeStateStatus`:**

   | Status | Meaning | Action |
   |---|---|---|
   | `CLEAN` | Ready to merge right now | Merge immediately: `gh pr merge <PR> --merge` |
   | `UNSTABLE` | CI still running or has failures | Enable auto-merge: `gh pr merge <PR> --auto --merge`. If CI is actually red (`statusCheckRollup` shows FAILURE), do NOT enable auto-merge — flag in the digest. |
   | `BLOCKED` | Branch protection rule unmet (other than CI) | Enable auto-merge: `gh pr merge <PR> --auto --merge`. GitHub will land it when the rule is satisfied. |
   | `BEHIND` | Base advanced; branch needs update | Update the branch (step 3), then re-evaluate next run. |
   | `DIRTY` | Conflicts with main | Update the branch (step 3), then re-evaluate next run. |
   | `HAS_HOOKS` / `UNKNOWN` | GitHub is computing | Skip this run, retry next. |

3. **Updating the branch** (for `BEHIND` / `DIRTY`):
   - **If the head ref starts with `workqueue/`**, we own the branch — use Phase 1's rebase-with-force-with-lease flow. (Phase 1 already ran for workqueue branches; if it's still BEHIND/DIRTY here, that means Phase 1's mechanical resolutions failed and it posted a comment. Skip.)
   - **Otherwise** (third-party or human branch), use the non-destructive `gh` primitive that merges main into the PR branch — no force-push:
     ```bash
     .claude/scripts/wq-gh.sh pr update-branch <PR> --repo werkstattwaedi/machine-auth
     ```
     If GitHub returns a conflict, do NOT try to resolve it ourselves — post a comment asking the human to resolve:
     ```bash
     .claude/scripts/wq-gh.sh pr comment <PR> --repo werkstattwaedi/machine-auth --body "$(cat <<'EOF'
     <!-- claude-workqueue -->
     ## Conflict with main — needs your resolution
     
     You approved this PR and I tried to land it, but updating the branch
     against the latest main produced a merge conflict that I won't try to
     resolve autonomously on a branch I don't own. Please resolve the
     conflict; I'll pick the PR up again on the next `/workqueue` run.
     EOF
     )"
     ```

4. **Merge method:** this repo uses merge commits (see recent git log).
   Always pass `--merge`. Do NOT use `--squash` or `--rebase`.

5. Record each merged / auto-merge-enabled / blocked PR for the digest.

End on `main` with a clean tree.

## Phase 2 — Baseline with bounded self-heal

> When `$ARGUMENTS` is set (single-item run), skip the self-heal logic
> entirely: run the baseline and, if red, print the failing tests and
> abort with `WORKQUEUE_RESULT: baseline-red | <failing tests>`. The
> human is at the terminal — they'll handle it.

Run the baseline:

1. Verify clean state again:
   ```bash
   git status --porcelain
   git rev-parse --abbrev-ref HEAD   # must be main
   ```

2. **Pull origin main again.** Phase 1b may have merged approved PRs on
   GitHub (auto-merge fires server-side) while we were processing them
   locally. Without this pull the baseline would run against the
   pre-merge tree, defeating the point of testing the integrated state
   and risking conflicts when worker branches later rebase. This is a
   pure fast-forward — no destructive operation:
   ```bash
   git pull --ff-only origin main
   ```
   If the pull fails for any reason (non-ff, network, etc.), STOP with
   `WORKQUEUE_RESULT: error | could not sync main after Phase 1b: <reason>`
   — proceeding with a stale local main would be worse than aborting.

3. `npm run test:precommit` (Bash `timeout: 600000`).

4. `npm run test:web:e2e` (Bash `timeout: 600000`).

If both pass → record "baseline: green" and continue to Phase 3.

### If baseline fails, classify the failure

Read the failing test names + output and put the failure into exactly one
bucket:

**MECHANICAL** — fix is unambiguous, no behavior change:
- Playwright screenshot drift only (snapshot pixel diff, layout unchanged from intent).
- Vitest snapshot drift (`*.snap`).
- Lockfile drift (`package-lock.json` mismatch after a dep bump).
- Formatter / lint auto-fixable rule.

**HERMETICITY** — clear test-side cause, fix is small and confined:
- Race / timing in a single test file (missing `await`, flaky `setTimeout`, missing `waitFor`).
- Leaky test setup (missing emulator clear, leftover Firestore docs from a prior test).
- Test-only environment dependency (env var, fake-timer setup).
- Fix touches the test file or its colocated helpers ONLY — no production source files.

**ESCALATE** — anything else. Examples:
- Production code change required.
- Multiple test files failing across unrelated areas.
- Security, auth, Firestore rules, schema, migrations.
- You're not sure what bucket it's in. (Default here when in doubt.)

### MECHANICAL or HERMETICITY → auto-fix

Apply the fix on a temporary branch first so we can inspect the diff
before deciding push-direct vs. open-PR:

```bash
git checkout -b workqueue/baseline-fix-$(date -u +%Y%m%dT%H%M%SZ)
```

Apply the fix:
- Screenshot drift: `firebase emulators:exec --config firebase.e2e.json --only firestore,auth,functions 'cd web/apps/checkout && npx playwright test --update-snapshots'`
- Vitest snapshot: `cd web && npm test -- -u` (or the appropriate workspace).
- Lockfile: `cd <pkg-dir> && rm package-lock.json && npm install`.
- Hermeticity: edit the offending test file.

Re-run the full baseline (`npm run test:precommit` + `npm run test:web:e2e`).

- **Still red** → discard the branch (`git checkout main && git branch -D <branch>`) and fall through to ESCALATE.
- **Green** → choose push-direct vs. open-PR based on what the diff touched.

#### Inspect the diff and decide

```bash
git diff main...HEAD --name-only
```

**Push-direct-to-main** is allowed only when:
1. The bucket was **MECHANICAL** (not HERMETICITY), and
2. *Every* changed file matches one of these safe-path globs:
   - `web/apps/*/e2e/**/*.spec.ts-snapshots/*.png` (Playwright snapshots)
   - `**/__snapshots__/*.snap` (Vitest snapshots)
   - `package-lock.json`, `web/package-lock.json`, `web/apps/*/package-lock.json`, `web/modules/package-lock.json`, `functions/package-lock.json`

   These are generated artifacts — there is no plausible behavior question
   for a human to weigh in on, so the PR roundtrip is pure overhead.

If both conditions hold, take the **push-direct** branch.
Otherwise (MECHANICAL but diff escaped safe paths, OR HERMETICITY of any
shape), take the **open-PR** branch.

#### push-direct branch

Replay the commit onto `main` so history stays linear, then push.

```bash
git checkout main
git merge --ff-only workqueue/baseline-fix-<ts>   # ff is guaranteed: we branched from main
git push origin main
git branch -D workqueue/baseline-fix-<ts>
```

If `git push origin main` fails because of branch protection, fall back
to the open-PR branch below — and add a note in Phase 6's digest so the
human knows to relax protection (or accept the PR overhead).

Commit message:
```
test: heal baseline (<one-line summary>)

Auto-pushed to main by /workqueue baseline self-heal (MECHANICAL, safe paths only).
Failing test(s): <list>
Fix: <one-line>
Safe paths touched: <comma-separated list>
```

Record under "Baseline auto-pushes" for the digest. Continue to Phase 3
normally — main is green again, queued issues can proceed.

#### open-PR branch

```bash
git push -u origin HEAD
.claude/scripts/wq-gh.sh pr create --repo werkstattwaedi/machine-auth \
  --title "test: heal baseline (<summary>)" \
  --body "$(cat <<'PR_EOF'
## Baseline self-heal

The Phase 2 baseline run failed; this PR contains the auto-applied fix.

- **Failing tests:** <list>
- **Bucket:** <MECHANICAL (off safe-paths) | HERMETICITY>
- **Fix:** <one-line>
- **Re-run after fix:** ✅ green
- **Files touched outside safe paths:** <list> (this is why it's a PR, not a push)

## Why this was eligible for auto-fix
<one paragraph — name the specific evidence: e.g. "Single missing
`await waitFor()` in the same test file; no production source touched">

---
🤖 Automated by `/workqueue` (Phase 2 self-heal)
PR_EOF
)"
.claude/scripts/wq-gh.sh pr edit <PR> --add-label "wq-baseline-fix" --repo werkstattwaedi/machine-auth
git checkout main
```

Record the PR URL as **outstanding baseline-fix**. Run Phase 5 scoring on
this PR. Then **skip Phases 3 and 4 entirely for this run** — main is
still red, so spawning workers would just produce broken PRs. Jump
straight to Phase 6 (the digest will list the queue as blocked on this
fix PR). Output:

```
WORKQUEUE_RESULT: baseline-fix-pr | <URL> | queue paused until merged
```

Next run will see main green (once merged) and process the queue normally.

### ESCALATE → file an issue, abort

```bash
.claude/scripts/wq-gh.sh issue create --repo werkstattwaedi/machine-auth \
  --title "Baseline broken: <failing test name>" \
  --label "claude-workqueue" \
  --body "$(cat <<'EOF'
<!-- claude-workqueue -->
## Baseline failure (auto-filed by /workqueue Phase 2)

The autonomous workqueue run found a failing baseline and judged the
fix to be out of self-heal scope. Filing this so the next run picks it
up like any other issue.

### Failing test(s)
```
<paste failing test names + the most useful lines of output>
```

### Recent commits
```
<paste `git log -10 --oneline`>
```

### Classification reasoning
<one paragraph — why this was not eligible for auto-fix. e.g. "Touches
production code in `functions/src/auth/`, security-sensitive — needs
human review.">
EOF
)"
```

Then output:
```
WORKQUEUE_RESULT: baseline-escalated | <issue URL>
```
and stop. (Phases 3+ are skipped this run. Next run picks up the new
issue and processes it normally.)

## Phase 3 — Fetch & filter issues

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

4. If no actionable issues remain, continue to Phase 3b.

5. Print the classified list.

## Phase 3b — Fetch & filter PRs with review feedback

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

## Phase 4 — Process each issue (sequential)

Process one issue at a time. Tests use emulators on fixed ports, so parallelism is unsafe.

Before processing any issue, verify the working tree is clean:

```bash
git status --porcelain
```

If dirty, stop and report — do NOT stash or discard the user's work.

### 4a. Mark as in-progress

```bash
.claude/scripts/wq-gh.sh issue edit <N> --add-label "claude-workqueue-wip" --repo werkstattwaedi/machine-auth
```

### 4b. Spawn the worker agent

The worker prompt template lives at `.claude/workqueue/worker-prompt.md`.
To spawn the agent:

1. Read `.claude/workqueue/worker-prompt.md`.
2. Take the text between `--- BEGIN PROMPT ---` and `--- END PROMPT ---`.
3. Substitute every `<N>` with the issue number and `<TITLE>` with the issue title.
4. **If you classified this issue as IMPLEMENT in Phase 3** (plan marker
   present, `claude-workqueue-plan-review` absent), prepend the
   "Implement mode banner" paragraph from `worker-prompt.md`. This is
   load-bearing — without it the worker has historically (incorrectly)
   posted a new plan instead of implementing, especially when the user's
   revision comment after the plan seems to invalidate parts of it.
5. **If a Phase 2 self-heal PR is currently outstanding** (rare — Phase 2
   normally STOPs the run when it opens one), prepend the "Baseline note"
   paragraph from the bottom of `worker-prompt.md`, substituting
   `<FIX_PR_URL>`.
6. Spawn the **Agent tool without `isolation`** (no worktree), in background,
   with the substituted prompt as input.

**Entry state:** issue is labeled `claude-workqueue-wip`; working tree
clean; on `main`.

**Exit contract:** worker outputs a single `WORKQUEUE_RESULT: <kind> | ...`
line — one of `implemented | <summary> | <PR URL>`, `plan-posted | <summary>`,
`question | <summary>`, or `error | <what went wrong>`.

### 4c. Handle the result

Parse the `WORKQUEUE_RESULT` line and update labels:

- **`implemented`** → remove `claude-workqueue-wip` and `claude-workqueue`. Record the PR URL. Run Phase 5 scoring on the new PR.
- **`plan-posted`** → remove `claude-workqueue-wip` (the agent already added `claude-workqueue-plan-review`). Record under "Plans awaiting review."
- **`question`** → remove `claude-workqueue-wip`, add `claude-workqueue-question`.
- **`error`** → remove `claude-workqueue-wip`. Record the error. Do NOT remove `claude-workqueue`.

Also ensure the working tree is clean and the current branch is back on `main` (or the branch the user started on) before moving to the next issue:

```bash
git status --porcelain
git rev-parse --abbrev-ref HEAD
```

If the agent left the tree dirty or on a workqueue branch with uncommitted changes, stop and report — do NOT force-clean.

## Phase 4b — Process PRs with review feedback (sequential)

For each PR with unaddressed review comments, follow the recipe at
`.claude/workqueue/pr-fixup-prompt.md`. In short:

1. **Pre-analyze.** Read the review comments via `gh api .../pulls/<PR>/comments`,
   read the relevant source files on the PR branch, and decide on a specific
   fix approach per comment.
2. **Build a focused prompt** using the skeleton in `pr-fixup-prompt.md`.
   Substitute `<PR>`, `<BRANCH>`, `<TITLE>` and fill in the numbered list of
   review comments + fix approaches. Focused prompts beat generic templates —
   take the time to name files, lines, and exact fixes.
3. **Spawn the Agent** (no isolation, in background) with the substituted
   prompt.

**Entry state:** PR has review comments without `<!-- claude-workqueue-ack -->`
replies; working tree clean; on `main`.

**Exit contract:** worker outputs `WORKQUEUE_RESULT: pr-fixed | <summary>` or
`WORKQUEUE_RESULT: error | <what went wrong>`.

### 4b.3. Handle the result

- **`pr-fixed`** → record as fixed. Re-run Phase 5 scoring (the PR diff has changed).
- **`error`** → record the error.

## Phase 5 — Confidence scoring

Run this against every PR the workqueue produced or modified this run
(implemented issues, PR-feedback fixes, and baseline self-heal PRs).
The score is advisory — it feeds the morning digest so you can decide
which PRs to read carefully and which to skim before approving. The
score itself never gates merge; **the merge gate is your `APPROVED`
review** (see Phase 1b).

For each PR, compute these inputs:

```bash
.claude/scripts/wq-gh.sh pr view <PR> --repo werkstattwaedi/machine-auth --json additions,deletions,files,labels
```

Rubric (start at 5, then add/subtract):

| Signal | Adjustment |
|--------|-----------|
| Diff total `additions + deletions` ≤ 30 | +2 |
| Diff total 31–150 | +0 |
| Diff total 151–500 | −1 |
| Diff total > 500 | −3 |
| Files touched ≤ 3 | +1 |
| Files touched ≥ 10 | −1 |
| Includes a new/changed test file (`*.test.*` or `*.spec.*`) | +1 |
| All file paths are under `web/` or `functions/` test dirs | +1 |
| Touches any path under `functions/src/auth/`, `firestore/firestore.rules`, `firestore/schema.jsonc`, or `functions/src/sessions/` | −3 (sensitive) |
| Touches `package.json` / `package-lock.json` only (dep bump) and CI green | +1 |
| Label `wq-baseline-fix` AND bucket was MECHANICAL | +2 |
| Label `wq-baseline-fix` AND bucket was HERMETICITY | +0 |

Clamp to `[0, 10]`. Apply label:
- `≥ 8` → `wq-low-risk`
- `5–7` → `wq-medium`
- `< 5` → `wq-needs-review`

Write the score into the PR body by appending (idempotent — replace any
existing `<!-- wq-score -->` block):

```markdown
<!-- wq-score -->
## /workqueue confidence score: <N>/10 (<label>)

- diff: <+a / -d> across <n> file(s)
- tests: <added | updated | none>
- sensitive paths: <listed paths or "none">
- baseline-fix bucket: <MECHANICAL | HERMETICITY | n/a>
```

```bash
.claude/scripts/wq-gh.sh pr edit <PR> --add-label "<label>" --repo werkstattwaedi/machine-auth
```

If the PR previously had a different `wq-*` label, remove it first.

## Phase 6 — Daily digest

> Skip this phase when `$ARGUMENTS` is set.

Upsert a single pinned tracking issue titled `[workqueue] Daily digest` so
the morning review is one URL, not a search across PRs.

1. Find the digest issue:
   ```bash
   .claude/scripts/wq-gh.sh issue list --repo werkstattwaedi/machine-auth \
     --search "in:title [workqueue] Daily digest" --state open \
     --json number --jq '.[0].number'
   ```
   If none exists, create it (pin manually once after first run):
   ```bash
   .claude/scripts/wq-gh.sh issue create --repo werkstattwaedi/machine-auth \
     --title "[workqueue] Daily digest" \
     --body "Updated automatically by /workqueue at the end of each run."
   ```

2. Build the digest body. Gather currently-open `workqueue/issue-*` PRs and
   any `wq-baseline-fix` PRs from this run:

   ```bash
   .claude/scripts/wq-gh.sh pr list --repo werkstattwaedi/machine-auth \
     --search "head:workqueue/" --state open \
     --json number,title,url,additions,deletions,labels,reviewDecision,mergeStateStatus,statusCheckRollup
   ```

3. Compose the body (overwrite, not append):

   ```markdown
   <!-- wq-digest -->
   Last updated: <UTC timestamp>
   
   ## Ready for morning review (`wq-low-risk`)
   - [#<PR>](<url>) — <title> — score <N>/10, CI <PASSING|PENDING|FAILING>, <one-sentence what-it-does>
   
   ## Worth a real look (`wq-medium`)
   - <same format>
   
   ## Needs careful review (`wq-needs-review`)
   - <same format>
   
   ## Merged this run (Phase 1b)
   - [#<PR>](<url>) — <title> — merged immediately
   - [#<PR>](<url>) — <title> — auto-merge enabled, waiting on <CI | branch protection>
   
   ## Approved but blocked (needs your attention)
   - [#<PR>](<url>) — <title> — CI red on <check>
   - [#<PR>](<url>) — <title> — conflict with main, needs manual resolution
   
   ## Baseline self-heal (this run)
   - Auto-pushed to main:
     - <commit SHA> — <bucket> — <what was fixed> — paths: <list>
   - Outstanding fix PR (queue paused until merged):
     - [#<PR>](<url>) — <bucket> — <what was fixed>
   
   ## Blocked
   - Plans awaiting your approval:
     - #<N>: <one-line plan summary> (remove `claude-workqueue-plan-review` to approve)
   - Questions awaiting your answer:
     - #<N>: <question summary>
   - Conflicts needing manual rebase:
     - #<PR>: <files>
   - Errors from this run:
     - <issue/PR>: <what went wrong>
   ```

   Omit sections with no entries.

4. Update the issue:
   ```bash
   .claude/scripts/wq-gh.sh issue edit <digest-issue-number> --repo werkstattwaedi/machine-auth --body "$(cat <<'EOF'
   <the body from step 3>
   EOF
   )"
   ```

## Phase 7 — Final summary (stdout) and self-exit

Print a short summary table to stdout:

```
## Workqueue run summary (<UTC timestamp>)

### New issues
| Issue | Title | Status | Details |
...

### PR review fixes
...

### Baseline self-heal
...

### Plans awaiting review
...

### Pending questions
...

### Digest issue: <URL>
```

Omit sections with no entries.

### Final action: termination

After printing the summary, perform the termination snippet from the
top-of-file "Termination signal" rule. This is the *only* mechanism that
unblocks the loop wrapper.

## Reliability & error recovery

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

## Agent prompt guidelines

**Pre-analyze before spawning agents.**

Before spawning an agent for any task:
1. Read the issue/PR comments yourself.
2. Read the relevant source files.
3. Write a focused prompt that names specific files, line numbers, and the expected `WORKQUEUE_RESULT` line.
