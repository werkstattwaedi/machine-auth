#!/usr/bin/env bash
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT
#
# Runs the workqueue's review capture specs (web/apps/<app>/e2e/**/*.capture.ts)
# against the e2e emulators and writes PNGs to <out-dir>/<project>/<name>.png.
#
# Usage: scripts/wq-capture.sh <checkout|admin> <out-dir>
#   e.g. scripts/wq-capture.sh checkout .wq-capture/issue-732/before

set -euo pipefail

app="${1:?usage: wq-capture.sh <checkout|admin> <out-dir>}"
out="${2:?usage: wq-capture.sh <checkout|admin> <out-dir>}"
case "$app" in checkout|admin) ;; *) echo "unknown app: $app" >&2; exit 2 ;; esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$out"
export WQ_CAPTURE_OUT="$(cd "$out" && pwd)"
cd "$root"

npx tsx scripts/port-block.ts -- bash -c \
  "scripts/emulator-exec.sh --config \"\$FIREBASE_E2E_CONFIG\" --only firestore,auth,functions,storage \
   'cd web/apps/$app && npx playwright test -c playwright.capture.config.ts'"

echo "captures in $WQ_CAPTURE_OUT:"
find "$WQ_CAPTURE_OUT" -name '*.png' | sort
