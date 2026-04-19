#!/usr/bin/env bash
# Runs `gh` authenticated as the workqueue GitHub App so issue comments
# and PRs are attributed to the bot instead of the local user.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GH_TOKEN=$("$script_dir/workqueue-gh-token.sh")
export GH_TOKEN
unset GITHUB_TOKEN
exec gh "$@"
