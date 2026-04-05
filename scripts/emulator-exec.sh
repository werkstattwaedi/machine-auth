#!/usr/bin/env bash
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT
#
# Wrapper around `firebase emulators:exec` that kills stale emulator
# processes on the configured ports before starting.
#
# Usage: scripts/emulator-exec.sh [firebase-args...]
#   e.g. scripts/emulator-exec.sh --config firebase.e2e.json --only firestore 'cd web && npm run test:integration'

set -euo pipefail

# Ports configured in firebase.e2e.json
EMULATOR_PORTS=(8180 9199 5101 4400 4500)

for port in "${EMULATOR_PORTS[@]}"; do
  pid=$(lsof -ti ":$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "⚠ Killing stale process on port $port (PID $pid)"
    kill "$pid" 2>/dev/null || true
  fi
done

# Brief pause to let ports release
sleep 1

exec firebase emulators:exec "$@"
