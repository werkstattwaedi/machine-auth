#!/bin/bash
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT
#
# Sets up Cloud Monitoring alerting for a project: an email notification channel
# and the Cloud Functions error alert policy (function-errors.alert-policy.json).
# The alert fires when any Cloud Function — including the scheduled crons — logs
# an ERROR, so a silent failure pages someone instead of going unnoticed.
#
# Usage:
#   scripts/monitoring/setup.sh --email ops@example.com [--project oww-maco]
#
# Idempotent on the channel (reuses an existing email channel for the address).
# The policy is NOT deduped — if you re-run, delete the old policy first:
#   gcloud alpha monitoring policies list --project=PROJECT \
#     --filter='displayName:"Cloud Functions errors"' --format='value(name)'
#   gcloud alpha monitoring policies delete POLICY_NAME --project=PROJECT
#
# Requires gcloud auth for the project (roles/monitoring.editor).

set -euo pipefail

PROJECT="oww-maco"
EMAIL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --email) EMAIL="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
[[ -n "$EMAIL" ]] || { echo "ERROR: --email is required (where alerts are sent)" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
POLICY_FILE="$SCRIPT_DIR/function-errors.alert-policy.json"

echo "→ Finding or creating an email notification channel for $EMAIL ..."
CHANNEL="$(gcloud beta monitoring channels list \
  --project="$PROJECT" \
  --filter="type='email' AND labels.email_address='$EMAIL'" \
  --format='value(name)' | head -1)"

if [[ -z "$CHANNEL" ]]; then
  CHANNEL="$(gcloud beta monitoring channels create \
    --project="$PROJECT" \
    --display-name="OWW ops alerts ($EMAIL)" \
    --type=email \
    --channel-labels="email_address=$EMAIL" \
    --format='value(name)')"
  echo "  created channel: $CHANNEL"
  echo "  NOTE: confirm the verification email Google sends to $EMAIL."
else
  echo "  reusing channel: $CHANNEL"
fi

echo "→ Creating the Cloud Functions error alert policy ..."
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
sed "s#__CHANNEL__#${CHANNEL//\//\\/}#" "$POLICY_FILE" > "$TMP"
gcloud alpha monitoring policies create --project="$PROJECT" --policy-from-file="$TMP"

echo "✓ Done. Cloud Functions error alerting is active on $PROJECT → $EMAIL."
