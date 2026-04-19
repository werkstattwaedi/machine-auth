#!/usr/bin/env bash
# Mints a short-lived GitHub App installation access token for the
# workqueue bot and prints it to stdout. Caches in /tmp for ~50 minutes.
#
# Requires the following variables, sourced from either the environment
# or ~/.config/workqueue-app/env (override via $WORKQUEUE_APP_ENV):
#   WORKQUEUE_APP_ID               numeric App ID
#   WORKQUEUE_APP_INSTALLATION_ID  numeric installation ID on the repo
#   WORKQUEUE_APP_PRIVATE_KEY      path to the App's .pem private key

set -euo pipefail

config="${WORKQUEUE_APP_ENV:-$HOME/.config/workqueue-app/env}"
if [[ -f "$config" ]]; then
  # shellcheck disable=SC1090
  source "$config"
fi

: "${WORKQUEUE_APP_ID:?missing; see .claude/commands/workqueue.md Setup section}"
: "${WORKQUEUE_APP_INSTALLATION_ID:?missing; see .claude/commands/workqueue.md Setup section}"
: "${WORKQUEUE_APP_PRIVATE_KEY:?missing; see .claude/commands/workqueue.md Setup section}"

if [[ ! -r "$WORKQUEUE_APP_PRIVATE_KEY" ]]; then
  echo "Private key not readable at: $WORKQUEUE_APP_PRIVATE_KEY" >&2
  exit 1
fi

cache="/tmp/workqueue-gh-token-${WORKQUEUE_APP_INSTALLATION_ID}"
now=$(date +%s)

if [[ -f "$cache" ]]; then
  mtime=$(stat -c %Y "$cache" 2>/dev/null || stat -f %m "$cache")
  if (( now - mtime < 3000 )); then
    cat "$cache"
    exit 0
  fi
fi

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

header=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
iat=$(( now - 60 ))
exp=$(( now + 540 ))
payload=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$iat" "$exp" "$WORKQUEUE_APP_ID" | b64url)
signing_input="${header}.${payload}"
signature=$(printf '%s' "$signing_input" \
  | openssl dgst -sha256 -sign "$WORKQUEUE_APP_PRIVATE_KEY" \
  | b64url)
jwt="${signing_input}.${signature}"

response=$(curl -sS -X POST \
  -H "Authorization: Bearer ${jwt}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/app/installations/${WORKQUEUE_APP_INSTALLATION_ID}/access_tokens")

token=$(printf '%s' "$response" | jq -r '.token // empty')
if [[ -z "$token" ]]; then
  echo "Failed to obtain installation token:" >&2
  printf '%s\n' "$response" >&2
  exit 1
fi

umask 077
printf '%s' "$token" > "$cache"
printf '%s' "$token"
