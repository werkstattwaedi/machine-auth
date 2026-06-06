#!/usr/bin/env bash
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT
#
# Prepare every deployable artifact for production deploy:
#   - functions/     install + TypeScript build
#   - web/           install + Vite build (checkout + admin)
#   - gateway        Bazel proto build, payload tarball, .env from gcloud secrets
#   - checkout-kiosk install + electron-rebuild (native NFC bindings)
#
# After this completes, the following commands will succeed without any
# additional preparation:
#   firebase deploy                                       # functions, rules, hosting
#   npx tsx scripts/deploy-gateway.ts --host <pi>         # gateway → Raspberry Pi
#   (kiosk: rsync checkout-kiosk/ to kiosk box, npm install, npm start)
#
# This script does NOT cover one-time manual steps from the deploy
# checklist (secret rotation, custom-claim re-saves, smoke tests).
# See docs/deployment-checklist.md.

set -euo pipefail

cd "$(dirname "$0")/.."

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${GREEN}[predeploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[predeploy]${NC} $1"; }
fail() { echo -e "${RED}[predeploy]${NC} $1"; exit 1; }

command -v node >/dev/null      || fail "node not found"
command -v firebase >/dev/null  || fail "firebase CLI not found (npm i -g firebase-tools)"
command -v bazelisk >/dev/null  || fail "bazelisk not found (needed for gateway proto build)"
command -v gcloud >/dev/null    || fail "gcloud not found (needed to fetch gateway secrets)"

step "Firebase project"
firebase use

step "Generating env files from operations config"
npm run generate-env

# A prior deploy rewrites functions/package.json's @oww/shared to a packed
# `file:` tarball (see scripts/deploy-functions.ts) and deploy:functions:cleanup
# normally reverts it. An interrupted/failed deploy can leave that state
# behind; the next `npm install` then resolves @oww/shared to the *stale*
# tarball, so `tsc` can't see exports added since (mirrors the husky
# pre-commit guard). Self-heal here so predeploy never builds against a
# stale shared package.
if grep -q '"@oww/shared": "file:' functions/package.json 2>/dev/null; then
  warn "functions/package.json is in deploy state (@oww/shared → packed tarball, leftover from an interrupted deploy). Restoring the workspace ref."
  git restore functions/package.json
  rm -f functions/oww-shared-*.tgz
fi

step "Install all workspace dependencies (root)"
npm install

step "Shared TS package: build"
npm run build:shared

step "Functions: build"
(cd functions && npm run build)

step "Web: build (checkout + admin)"
(cd web && npm run build)

step "Gateway: build payload + generate .env from gcloud secrets"
npx tsx scripts/deploy-gateway.ts --build-only

step "Checkout kiosk: typecheck (electron-rebuild ran in postinstall)"
(cd checkout-kiosk && npm run typecheck)

cat <<EOF

${GREEN}[predeploy] OK — all artifacts built.${NC}

Ready to deploy:
  firebase deploy                                          # functions + rules + hosting
  npx tsx scripts/deploy-gateway.ts --host <user@host>     # gateway → Pi
  (kiosk: push checkout-kiosk/ to kiosk machine, run npm install + npm start there)

Manual steps not handled here (see docs/deployment-checklist.md):
  - Firebase Functions secrets rotation
  - Custom claims for newly-promoted admins (re-save user doc)
  - Smoke tests against production
EOF
