#!/usr/bin/env bash
# Cron entry point for /workqueue. Designed to be safe to run every few hours:
#  - flock guarantees no overlap with a previous run still in progress
#  - cheap GH pre-check exits silently when there's nothing actionable in the
#    queue or PR list, so we don't pay the baseline cost on empty runs
#  - all output is logged under ~/.claude/logs/workqueue/, rotated by age
#  - claude is invoked non-interactively via `claude -p` with a budget cap
#
# Wire it up via crontab (see .claude/commands/workqueue.md "Cron setup").
set -uo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_dir"

log_dir="$HOME/.claude/logs/workqueue"
mkdir -p "$log_dir"
log_file="$log_dir/$(date -u +%Y%m%dT%H%M%SZ).log"
current_link="$log_dir/current.log"
status_file="$log_dir/last-run.txt"
lock_file="$log_dir/.lock"

# Prune log files older than 14 days. Best effort.
find "$log_dir" -maxdepth 1 -name '*.log' -mtime +14 -delete 2>/dev/null || true

# Single-instance lock. If another run is in progress, exit quietly.
exec 9>"$lock_file"
if ! flock -n 9; then
  printf '%s skipped: another run is already in progress\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$status_file"
  exit 0
fi

exec >>"$log_file" 2>&1
printf '=== workqueue-cron starting at %s ===\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf 'repo: %s\n' "$repo_dir"

# Make sure the GitHub App credentials are loadable (so `wq-gh.sh` works).
config="${WORKQUEUE_APP_ENV:-$HOME/.config/workqueue-app/env}"
if [[ -f "$config" ]]; then
  # shellcheck disable=SC1090
  source "$config"
fi

wq_gh() { "$repo_dir/.claude/scripts/wq-gh.sh" "$@"; }

# ---- Cheap pre-check: any work to do? -------------------------------------
# Returns work_reason on stdout when there's something to process; empty
# otherwise. We deliberately keep this to ~3 `gh` calls so idle firings cost
# nothing. The full /workqueue run does precise checks (e.g. "has the human
# replied since the bot asked?") — the pre-check is allowed to be optimistic
# and let the full run exit cleanly when there's truly nothing to do.
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
  #    off the critical path of every cron firing.
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

work_reason=$(has_actionable_work || true)
if [[ -z "$work_reason" ]]; then
  msg="$(date -u +%Y-%m-%dT%H:%M:%SZ) idle: no work in queue, baseline skipped"
  printf '%s\n' "$msg"
  printf '%s\n' "$msg" >> "$status_file"
  # Remove the empty log so the dir doesn't fill with idle entries.
  exec >&- 2>&-
  rm -f "$log_file"
  exit 0
fi

# We have real work — point current.log at this run so `tail -F current.log`
# in another terminal picks up the live output.
ln -sf "$log_file" "$current_link"

printf 'work detected: %s\n' "$work_reason"

# ---- Invoke claude non-interactively --------------------------------------
# acceptEdits: never prompt for permissions during the cron run.
# no-session-persistence: each cron run is independent; we don't need resume.
# timeout: hard wall-clock cap so a stuck/looping run can't hold the lock
#   forever. A normal run is well under an hour; 180m is comfortable headroom.
#   On timeout, `timeout` sends SIGTERM then SIGKILL — the next cron firing
#   will acquire the lock and proceed.
claude_bin="${CLAUDE_BIN:-claude}"
wall_clock="${WORKQUEUE_TIMEOUT:-180m}"

set +e
timeout --signal=TERM --kill-after=30s "$wall_clock" \
  "$claude_bin" \
    -p "/workqueue" \
    --permission-mode acceptEdits \
    --no-session-persistence \
    --output-format text
rc=$?
set -e

# Exit 124 means `timeout` killed claude — surface that in the status line.
if [[ "$rc" -eq 124 ]]; then
  printf 'wall-clock timeout (%s) — claude was killed\n' "$wall_clock"
fi

end_msg="$(date -u +%Y-%m-%dT%H:%M:%SZ) ran: ${work_reason}; claude exit=${rc}"
printf '%s\n' "$end_msg"
printf '%s\n' "$end_msg" >> "$status_file"

exit "$rc"
