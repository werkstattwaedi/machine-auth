#!/usr/bin/env bash
# Long-running /workqueue loop. Designed to run foreground inside a tmux
# pane that you leave open. Each iteration:
#  - Cheap GH pre-check; if no work, sleep $WORKQUEUE_INTERVAL and re-check.
#  - If work exists, hand the current tmux pane to an interactive `claude`
#    session running `/workqueue` with Remote Control enabled. Permission
#    prompts and worker `SendUserMessage` calls forward to your phone /
#    browser via Remote Control, so you can answer remotely.
#  - Phase 7 of /workqueue runs `tmux send-keys "/exit" Enter` as its final
#    step. Because claude owns the pane during the run, the keystrokes land
#    in claude's input buffer; once Phase 7 returns and claude is back at
#    its prompt, it processes /exit and shuts down. This loop's `while`
#    body unblocks and the next iteration starts.
#  - Sleep $WORKQUEUE_INTERVAL between iterations.
#
# Wire it up: open a tmux pane you can leave running, then:
#   ./.claude/scripts/workqueue-loop.sh
# Ctrl-C to stop the loop. The in-flight claude session (if any) is left
# alone — it exits on its own via Phase 7.
set -uo pipefail

# Refuse to run outside tmux — the Phase 7 self-exit relies on
# `tmux send-keys` reaching the pane that claude inherited.
if [[ -z "${TMUX:-}" ]]; then
  echo "workqueue-loop must run inside a tmux session." >&2
  echo "Start one with: tmux new -s workqueue   then re-run this script." >&2
  exit 1
fi

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_dir"

log_dir="$HOME/.claude/logs/workqueue"
mkdir -p "$log_dir"
status_file="$log_dir/last-run.txt"
lock_file="$log_dir/.lock"

# Single-instance: refuse a second loop on the same machine.
exec 9>"$lock_file"
if ! flock -n 9; then
  echo "another workqueue-loop is already running (lock: $lock_file)" >&2
  exit 1
fi
trap 'flock -u 9; rm -f "$lock_file" 2>/dev/null || true' EXIT

# Make sure the GitHub App credentials are loadable (so `wq-gh.sh` works).
config="${WORKQUEUE_APP_ENV:-$HOME/.config/workqueue-app/env}"
if [[ -f "$config" ]]; then
  # shellcheck disable=SC1090
  source "$config"
fi

wq_gh() { "$repo_dir/.claude/scripts/wq-gh.sh" "$@"; }

interval="${WORKQUEUE_INTERVAL:-4h}"
claude_bin="${CLAUDE_BIN:-claude}"

# Prune log files older than 14 days. Best effort.
find "$log_dir" -maxdepth 1 -name '*.log' -mtime +14 -delete 2>/dev/null || true

# ---- Cheap pre-check: any work to do? -------------------------------------
# Returns work_reason on stdout when there's something to process; empty
# otherwise. ~3 `gh` calls — keeps the idle path cheap so polling every few
# hours is essentially free. The full /workqueue run does precise checks
# (e.g. "has the human replied since the bot asked?") — the pre-check is
# allowed to be optimistic and let the full run exit cleanly when there's
# truly nothing to do.
has_actionable_work() {
  local repo="werkstattwaedi/machine-auth"
  local reason=""

  # 1. Issues that look ready: open + claude-workqueue label + not in WIP or
  #    plan-review hold. Also count open `claude-workqueue-question` issues
  #    optimistically — if the human hasn't answered, the full run exits fast.
  local issues_json
  issues_json=$(wq_gh issue list \
    --repo "$repo" \
    --label "claude-workqueue" \
    --state open \
    --json number,labels \
    --limit 50 2>/dev/null || echo '[]')

  local actionable_issues
  actionable_issues=$(printf '%s' "$issues_json" | jq -r '
    [.[]
     | select((.labels | map(.name) | contains(["claude-workqueue-wip"]) | not)
              and (.labels | map(.name) | contains(["claude-workqueue-plan-review"]) | not))
     | .number] | length
  ' 2>/dev/null || echo 0)
  if [[ "${actionable_issues:-0}" -gt 0 ]]; then
    reason="${actionable_issues} actionable issue(s)"
  fi

  local question_count
  question_count=$(wq_gh issue list \
    --repo "$repo" \
    --label "claude-workqueue-question" \
    --state open \
    --json number \
    --limit 50 2>/dev/null \
    | jq -r 'length' 2>/dev/null || echo 0)
  if [[ "${question_count:-0}" -gt 0 ]]; then
    reason="${reason:+$reason; }${question_count} question(s) open"
  fi

  # 2. Open workqueue PRs with mergeStateStatus BEHIND (need rebase) or DIRTY
  #    (conflicts). Same single call also tells us if any PRs exist at all —
  #    if there are PRs without merge issues we still want to check review
  #    comments below.
  local prs_json
  prs_json=$(wq_gh pr list \
    --repo "$repo" \
    --search "head:workqueue/issue-" \
    --state open \
    --json number,mergeStateStatus \
    --limit 50 2>/dev/null || echo '[]')

  local stale_prs
  stale_prs=$(printf '%s' "$prs_json" | jq -r \
    '[.[] | select(.mergeStateStatus == "BEHIND" or .mergeStateStatus == "DIRTY")] | length' \
    2>/dev/null || echo 0)
  if [[ "${stale_prs:-0}" -gt 0 ]]; then
    reason="${reason:+$reason; }${stale_prs} PR(s) need rebase"
  fi

  # 3. Approved PRs (any branch in the repo, not just workqueue). Phase 1b
  #    will rebase / enable auto-merge / merge as appropriate. This single
  #    `gh` call covers third-party PRs (dependabot, human-authored, etc.)
  #    that you've reviewed and approved.
  local approved_prs
  approved_prs=$(wq_gh pr list \
    --repo "$repo" \
    --state open \
    --search "review:approved" \
    --json number \
    --limit 50 2>/dev/null \
    | jq -r 'length' 2>/dev/null || echo 0)
  if [[ "${approved_prs:-0}" -gt 0 ]]; then
    reason="${reason:+$reason; }${approved_prs} approved PR(s) to land"
  fi

  # 4. For each open workqueue PR, check unaddressed review comments. Skipped
  #    when another signal already triggered, to keep the chatty per-PR calls
  #    off the critical path of every poll.
  if [[ -z "$reason" ]]; then
    local pr_numbers
    pr_numbers=$(printf '%s' "$prs_json" | jq -r '.[].number' 2>/dev/null || true)
    local unaddressed_prs=0
    for pr in $pr_numbers; do
      local n
      n=$(wq_gh api "repos/$repo/pulls/$pr/comments" --jq \
        '[.[] | select(.body | contains("<!-- claude-workqueue-ack -->") | not)] | length' \
        2>/dev/null || echo 0)
      if [[ "${n:-0}" -gt 0 ]]; then
        unaddressed_prs=$((unaddressed_prs + 1))
      fi
    done
    if [[ "$unaddressed_prs" -gt 0 ]]; then
      reason="${unaddressed_prs} PR(s) with review feedback"
    fi
  fi

  printf '%s' "$reason"
}

stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

echo "workqueue-loop starting at $(stamp); interval=${interval}; tmux pane=${TMUX_PANE:-?}"
echo "ctrl-c to stop. logs: $log_dir/"
echo "$(stamp) loop started; interval=${interval}" >> "$status_file"

while true; do
  reason=$(has_actionable_work || true)
  if [[ -z "$reason" ]]; then
    echo "$(stamp) idle: no actionable work; sleeping ${interval}"
    echo "$(stamp) idle" >> "$status_file"
    sleep "$interval" || break
    continue
  fi

  echo "$(stamp) work detected: $reason — launching claude /workqueue"
  echo "$(stamp) running: $reason" >> "$status_file"

  # Hand the pane to claude. Phase 7 self-exits via `tmux send-keys`, so we
  # don't need any timeout(1) or watchdog around this — the wrapper just
  # waits for claude to exit cleanly.
  #
  # --permission-mode auto: forward permission requests to Remote Control
  #   instead of auto-skipping. Combined with --remote-control + --brief,
  #   you get push notifications for both permission prompts and
  #   SendUserMessage worker questions, answerable from your phone/browser.
  # --remote-control workqueue: stable session name; the receiving URL is
  #   the same across iterations so you can bookmark it.
  # --brief: enables the SendUserMessage tool so worker agents can reach
  #   you via Remote Control when they need input.
  # --no-session-persistence: each loop iteration is independent.
  set +e
  "$claude_bin" \
    --permission-mode auto \
    --remote-control workqueue \
    --brief \
    --no-session-persistence \
    "/workqueue"
  rc=$?
  set -e

  echo "$(stamp) claude exited with rc=$rc; sleeping ${interval}"
  echo "$(stamp) done rc=$rc" >> "$status_file"
  sleep "$interval" || break
done

echo "$(stamp) workqueue-loop terminated"
echo "$(stamp) loop stopped" >> "$status_file"
