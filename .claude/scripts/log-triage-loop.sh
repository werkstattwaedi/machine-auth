#!/usr/bin/env bash
# Long-running /log-triage loop. Run it foreground in a tmux pane you leave
# open, the same way as workqueue-loop.sh:
#
#   tmux new -s log-triage
#   ./.claude/scripts/log-triage-loop.sh
#
# Each iteration runs `claude -p /log-triage` headless and sleeps until the
# next slot. Headless (not an interactive pane like workqueue) on purpose:
# triage never needs a human mid-run — it reads logs, files issues, and
# exits — so there is nothing to approve and no reason to hand over the
# pane. That also makes the loop safe to leave unattended.
#
# Ctrl-C stops the loop.
set -uo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_dir"

log_dir="$HOME/.claude/logs/log-triage"
mkdir -p "$log_dir"
lock_file="$log_dir/.lock"
status_file="$log_dir/last-run.txt"

# Single-instance: two loops would double-file issues.
exec 9>"$lock_file"
if ! flock -n 9; then
  echo "another log-triage-loop is already running (lock: $lock_file)" >&2
  exit 1
fi
trap 'flock -u 9; rm -f "$lock_file" 2>/dev/null || true' EXIT

interval="${LOG_TRIAGE_INTERVAL:-24h}"
# After a run that filed something, look again sooner — a fresh regression
# is usually still unfolding and the follow-up detail is worth having.
followup_interval="${LOG_TRIAGE_FOLLOWUP_INTERVAL:-6h}"
claude_bin="${CLAUDE_BIN:-claude}"

# Resend key for the notify phase. Sourced from the generated functions env
# rather than duplicated into another dotfile.
env_file="$repo_dir/functions/.env.oww-maco"
if [[ -z "${RESEND_API_KEY:-}" && -f "$env_file" ]]; then
  RESEND_API_KEY=$(grep -E '^RESEND_API_KEY=' "$env_file" | head -1 | cut -d= -f2-)
  export RESEND_API_KEY
fi
if [[ -z "${RESEND_API_KEY:-}" ]]; then
  echo "warning: RESEND_API_KEY unset — /log-triage will file issues but cannot mail." >&2
fi

# Prune run logs older than 30 days. Best effort.
find "$log_dir" -maxdepth 1 -name '*.log' -mtime +30 -delete 2>/dev/null || true

echo "log-triage loop started (interval: $interval, repo: $repo_dir)"

while true; do
  stamp=$(date +%Y%m%d-%H%M%S)
  run_log="$log_dir/$stamp.log"

  echo "[$(date -Is)] running /log-triage → $run_log"
  "$claude_bin" -p "/log-triage" >"$run_log" 2>&1
  exit_code=$?

  # Verdict comes from stdout, not a file: a headless run is sandboxed to
  # the repo, so writing a signal file under $HOME would be denied.
  verdict=$(grep -oE '^LOG_TRIAGE_VERDICT: *[a-z]+' "$run_log" \
    | tail -1 | awk '{print $2}')
  verdict="${verdict:-unknown}"

  printf '%s exit=%s verdict=%s log=%s\n' \
    "$(date -Is)" "$exit_code" "$verdict" "$run_log" | tee "$status_file"

  # A crashed run leaves no verdict; don't let it hot-loop.
  sleep_for="$interval"
  case "$verdict" in
    filed) sleep_for="$followup_interval" ;;
  esac

  echo "[$(date -Is)] sleeping $sleep_for"
  sleep "$sleep_for"
done
