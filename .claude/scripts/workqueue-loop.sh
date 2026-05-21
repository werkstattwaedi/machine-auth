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

idle_interval="${WORKQUEUE_IDLE_INTERVAL:-1h}"
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

  # 4. For each open workqueue PR, check unaddressed review threads. Skipped
  #    when another signal already triggered, to keep the chatty per-PR calls
  #    off the critical path of every poll.
  #
  #    A review thread is "addressed" when its newest reply carries the
  #    `<!-- claude-workqueue-ack -->` marker. Counting raw comments without
  #    the marker is wrong: the original review comment (authored by a
  #    human or CodeQL bot) can never contain it, so a fully-acked thread
  #    still has 1+ non-ack comments and the loop would fire claude on
  #    every poll forever. Group by thread root (in_reply_to_id // id) and
  #    inspect only the latest reply in each group.
  if [[ -z "$reason" ]]; then
    local pr_numbers
    pr_numbers=$(printf '%s' "$prs_json" | jq -r '.[].number' 2>/dev/null || true)
    local unaddressed_prs=0
    for pr in $pr_numbers; do
      local n
      n=$(wq_gh api "repos/$repo/pulls/$pr/comments" --jq '
        group_by(.in_reply_to_id // .id)
        | map(sort_by(.created_at) | last)
        | [.[] | select(.body | contains("<!-- claude-workqueue-ack -->") | not)]
        | length
      ' 2>/dev/null || echo 0)
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

echo "workqueue-loop starting at $(stamp); idle_interval=${idle_interval}; tmux pane=${TMUX_PANE:-?}"
echo "ctrl-c to stop. logs: $log_dir/"
echo "$(stamp) loop started; idle_interval=${idle_interval}" >> "$status_file"

while true; do
  reason=$(has_actionable_work || true)
  if [[ -z "$reason" ]]; then
    echo "$(stamp) idle: no actionable work; sleeping ${idle_interval}"
    echo "$(stamp) idle" >> "$status_file"
    sleep "$idle_interval" || break
    continue
  fi

  echo "$(stamp) work detected: $reason — launching claude /workqueue"
  echo "$(stamp) running: $reason" >> "$status_file"
  run_start=$(date +%s)

  # Background watchdog: /workqueue touches WORKQUEUE_SIGNAL_FILE at every
  # exit path (normal Phase 7 completion or any abort — idle, dirty tree,
  # baseline-red, baseline-escalated, etc.). The watchdog polls for the
  # file and sends /exit to this tmux pane (where claude is now running),
  # so claude shuts down regardless of which exit branch /workqueue took.
  # This is more robust than asking the model to remember tmux send-keys
  # at every abort path.
  signal_file=$(mktemp -t "workqueue-signal.XXXXXX")
  rm -f "$signal_file"   # ensure it doesn't exist at start of run
  export WORKQUEUE_SIGNAL_FILE="$signal_file"

  # Capture the pane the wrapper was launched in. The watchdog MUST target
  # this pane explicitly — without `-t`, tmux send-keys / capture-pane act
  # on whichever pane happens to be active when the watchdog fires, so if
  # you've switched panes/windows while claude was running the /exit lands
  # in the wrong pane and claude never shuts down.
  target_pane="${TMUX_PANE:-}"

  (
    trap 'exit 0' TERM
    while [[ ! -f "$signal_file" ]]; do sleep 3; done
    sleep 2   # let claude flush its final output
    tmux send-keys -t "$target_pane" "/exit" Enter

    # If claude has pending background work (e.g. a /loop wakeup scheduled
    # externally), /exit pops a "Background work is running" prompt with
    # "1. Exit anyway / 2. Stay". The default-highlighted option is "Exit
    # anyway"; we explicitly send "1" then Enter to be unambiguous in case
    # the default changes. Poll for ~10s; if the prompt doesn't appear,
    # claude exited cleanly and we don't need to do anything.
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      sleep 1
      if tmux capture-pane -t "$target_pane" -p 2>/dev/null | grep -q "Background work is running"; then
        sleep 1
        tmux send-keys -t "$target_pane" 1 Enter
        break
      fi
    done
  ) &
  watchdog_pid=$!

  # Hand the pane to claude.
  #
  # --permission-mode auto: forward permission requests to Remote Control
  #   instead of auto-skipping. Combined with --remote-control + --brief,
  #   you get push notifications for both permission prompts and
  #   SendUserMessage worker questions, answerable from your phone/browser.
  # --remote-control workqueue: stable session name; the receiving URL is
  #   the same across iterations so you can bookmark it.
  # --brief: enables the SendUserMessage tool so worker agents can reach
  #   you via Remote Control when they need input.
  # Note: --no-session-persistence is only valid with -p (print mode), so
  # we omit it. Each interactive iteration leaves a persisted session on
  # disk; Claude Code prunes those over time on its own.
  set +e
  "$claude_bin" \
    --permission-mode auto \
    --remote-control workqueue \
    --brief \
    "/workqueue"
  rc=$?
  set -e

  # Tear down the watchdog and signal file regardless of how claude exited.
  kill "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true
  rm -f "$signal_file"
  unset WORKQUEUE_SIGNAL_FILE

  # Fail-fast: if claude exited with an error in <10s, this is almost
  # certainly a flag/config problem (not a real run). Stop so you can fix
  # it instead of looping on a broken config.
  run_end=$(date +%s)
  if [[ "$rc" -ne 0 ]] && (( run_end - run_start < 10 )); then
    echo "$(stamp) claude failed in $(( run_end - run_start ))s with rc=$rc — assuming config error, stopping loop" >&2
    echo "$(stamp) loop stopped: claude rc=$rc within 10s" >> "$status_file"
    exit "$rc"
  fi

  # Successful run (or a real run that errored after >10s): re-check work
  # immediately. The pre-check is ~3 cheap gh calls; the *real* minimum
  # iteration time is the baseline (~15min inside claude itself), so this
  # can't tight-loop. If there's more queued work (e.g., a rebase opened
  # a new PR, or a baseline-escalated issue is now ready to triage), we
  # fire claude again right away. Once truly idle, we fall through to
  # the no-work branch and sleep $idle_interval.
  echo "$(stamp) claude exited with rc=$rc; re-checking for more work"
  echo "$(stamp) done rc=$rc" >> "$status_file"
done

echo "$(stamp) workqueue-loop terminated"
echo "$(stamp) loop stopped" >> "$status_file"
