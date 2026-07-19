#!/usr/bin/env bash
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT
#
# One-shot Firebase deploy (functions + firestore/storage rules + hosting)
# for staging and/or production. Does NOT deploy the gateway or the kiosk —
# see docs/deployment-checklist.md for those and for the one-time manual
# steps (secrets, custom claims, smoke tests).
#
# Usage:
#   scripts/deploy.sh staging          # deploy everything to oww-maco-staging
#   scripts/deploy.sh prod             # deploy everything to oww-maco
#   scripts/deploy.sh staging prod     # staging first, then prod
#   scripts/deploy.sh prod --yes       # skip the production confirmation
#
# Per environment this runs:
#   1. generate-env (staging: --env staging overlay per ADR-0034)
#   2. functions deploy via scripts/deploy-functions.ts (packs @oww/shared,
#      restores package.json/lockfile even on failure)
#   3. firebase deploy --only firestore,storage   (rules + indexes)
#   4. firebase deploy --only hosting             (predeploy hook builds web;
#      staging builds with WEB_BUILD_SCRIPT=build:staging so staging sites
#      never ship prod-configured bundles)
#
# The active `firebase use` alias is never changed — every command passes
# --project explicitly.

set -euo pipefail

cd "$(dirname "$0")/.."

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $1"; }
fail() { echo -e "${RED}[deploy]${NC} $1"; exit 1; }

PROD_PROJECT="oww-maco"
STAGING_PROJECT="oww-maco-staging"

WANT_STAGING=0
WANT_PROD=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    staging) WANT_STAGING=1 ;;
    prod) WANT_PROD=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    *) fail "Unknown argument: $arg (expected: staging, prod, --yes)" ;;
  esac
done
[ $((WANT_STAGING + WANT_PROD)) -gt 0 ] || fail "Usage: scripts/deploy.sh [staging] [prod] [--yes]"

# When both environments are requested, staging always deploys first —
# regardless of argument order — so problems surface there before prod.
ENVS=()
[ "$WANT_STAGING" -eq 1 ] && ENVS+=(staging)
[ "$WANT_PROD" -eq 1 ] && ENVS+=(prod)

command -v node >/dev/null     || fail "node not found"
command -v firebase >/dev/null || fail "firebase CLI not found (npm i -g firebase-tools)"

# Staging hosting targets are applied once per clone (ADR-0034); without
# them the hosting deploy fails with an unhelpful "target not configured".
for env in "${ENVS[@]}"; do
  if [ "$env" = "staging" ] && ! grep -q "\"$STAGING_PROJECT\"" .firebaserc; then
    fail "Staging hosting targets missing in .firebaserc — run the one-time
  firebase target:apply hosting checkout $STAGING_PROJECT --project $STAGING_PROJECT
  firebase target:apply hosting admin ${STAGING_PROJECT}-admin --project $STAGING_PROJECT"
  fi
done

# Self-heal leftover functions deploy state (same logic as predeploy.sh):
# an interrupted deploy leaves package.json/package-lock.json pinning
# @oww/shared at a packed tarball, and deploy-functions.ts would snapshot
# and faithfully restore that dirty state.
if grep -q '"@oww/shared": "file:' functions/package.json 2>/dev/null \
  || grep -q 'oww-shared-[0-9].*\.tgz' package-lock.json 2>/dev/null; then
  warn "Leftover functions deploy state detected — restoring package.json/lockfile."
  git restore functions/package.json package-lock.json
  rm -f functions/oww-shared-*.tgz
fi
rm -rf functions/node_modules/@oww/shared

step "Install workspace dependencies (also builds @oww/shared via postinstall)"
npm install

deploy_env() {
  local env="$1" project web_build
  if [ "$env" = "prod" ]; then
    project="$PROD_PROJECT"
    web_build="build"
    if [ "$ASSUME_YES" -ne 1 ]; then
      echo -en "\n${YELLOW}Deploy to PRODUCTION ($project)? [y/N] ${NC}"
      read -r answer || answer=""
      [[ "$answer" =~ ^[Yy] ]] || fail "Aborted."
    fi
    step "[$env] Generating env files from operations config"
    npm run generate-env
  else
    project="$STAGING_PROJECT"
    web_build="build:staging"
    step "[$env] Generating staging env files (config.staging.jsonc overlay)"
    npx tsx scripts/generate-env.ts --env staging
  fi

  step "[$env] Functions → $project"
  npx tsx scripts/deploy-functions.ts --project "$project"

  step "[$env] Firestore + Storage rules/indexes → $project"
  firebase deploy --only firestore,storage --project "$project"

  step "[$env] Hosting (checkout + admin) → $project"
  WEB_BUILD_SCRIPT="$web_build" firebase deploy --only hosting --project "$project"

  step "[$env] Done → $project"
}

for env in "${ENVS[@]}"; do
  deploy_env "$env"
done

cat <<EOF

${GREEN}[deploy] All requested environments deployed: ${ENVS[*]}${NC}

Not covered by this script (see docs/deployment-checklist.md):
  - Gateway (npx tsx scripts/deploy-gateway.ts) and kiosk
  - Secrets rotation / new defineSecret values
  - Custom claims for newly-promoted admins (re-save user doc)
  - Smoke tests
EOF
