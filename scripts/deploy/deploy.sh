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
#   scripts/deploy/deploy.sh staging          # deploy everything to oww-maco-staging
#   scripts/deploy/deploy.sh prod             # deploy everything to oww-maco
#   scripts/deploy/deploy.sh staging prod     # staging first, then prod
#   scripts/deploy/deploy.sh prod --yes       # skip the confirmations (release + production)
#   scripts/deploy/deploy.sh staging --allow-off-main   # deploy a branch (recorded as such)
#   scripts/deploy/deploy.sh prod --new-release         # new release name for an already
#                                                # released commit (ops config change)
#   scripts/deploy/deploy.sh prod --no-agent            # print pending deploy steps instead
#                                                # of starting an agent for them
#
# Refuses to run unless machine-auth AND the operations repo are on the
# latest main with no uncommitted changes (scripts/deploy/deploy-preflight.ts,
# ADR-0045); --allow-off-main overrides that and the deploy log says so.
#
# Then it names the release (scripts/deploy/release.ts): a commit deployed before
# reuses its vYYYY.M.N tag; a new commit gets the next number after one
# confirmation — for prod, that question replaces "Deploy to PRODUCTION?".
# Every build below carries that version (BUILD_VERSION).
#
# Per environment this runs (and finally records the deploy — git tag plus
# the operations repo's deploys/log.jsonl and STATE.md, ADR-0045):
#   1. generate-env (staging: --env staging overlay per ADR-0034)
#   2. setup-bigquery.ts — every time, so a new stats column exists before
#      the functions that emit it (ADR-0049; needs ADC)
#   3. functions deploy via scripts/deploy/deploy-functions.ts (packs @oww/shared,
#      restores package.json/lockfile even on failure)
#   4. firebase deploy --only firestore,storage   (rules + indexes)
#   5. firebase deploy --only hosting             (predeploy hook builds web;
#      staging builds with WEB_BUILD_SCRIPT=build:staging so staging sites
#      never ship prod-configured bundles)
#
# One-off deploy steps (ADR-0049, docs/deploy/): before step 3, between 3
# and 4, and after 5 the script stops for the step files added since this
# environment's last deploy tag (migrations the PRs since then declared in
# their Deploy: line), hands them to an interactive `claude` session (or
# prints them: --no-agent, no terminal, or already inside Claude Code) and
# asks once whether they are done. --yes does not answer that question.
#
# The same order, with what each one-off step phase leaves deployed when
# it is declined, is in scripts/deploy/README.md — keep both in step.
#
# The active `firebase use` alias is never changed — every command passes
# --project explicitly.

set -euo pipefail

cd "$(dirname "$0")/../.."

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
NEW_RELEASE=0
USE_AGENT=1
for arg in "$@"; do
  case "$arg" in
    staging) WANT_STAGING=1 ;;
    prod) WANT_PROD=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --allow-off-main) export DEPLOY_ALLOW_OFF_MAIN=1 ;;
    --new-release) NEW_RELEASE=1 ;;
    --no-agent) USE_AGENT=0 ;;
    *) fail "Unknown argument: $arg (expected: staging, prod, --yes, --allow-off-main, --new-release, --no-agent)" ;;
  esac
done
[ $((WANT_STAGING + WANT_PROD)) -gt 0 ] || fail "Usage: scripts/deploy/deploy.sh [staging] [prod] [--yes]"

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

step "Preflight: latest main in machine-auth and the operations repo"
npx tsx scripts/deploy/deploy-preflight.ts --component firebase || exit 1

# What gets deployed, captured before anything below touches the tree —
# deploy-record.ts records (and tags) this, not whatever is checked out
# when the run ends.
DEPLOY_RECORD_COMMIT="$(git rev-parse HEAD)"
DEPLOY_RECORD_DIRTY=0
[ -z "$(git status --porcelain --ignore-submodules --untracked-files=no)" ] || DEPLOY_RECORD_DIRTY=1
export DEPLOY_RECORD_COMMIT DEPLOY_RECORD_DIRTY

step "Release"
if [ "$WANT_STAGING" -eq 1 ] && [ "$WANT_PROD" -eq 1 ]; then
  question="deploy to staging, then PRODUCTION ($PROD_PROJECT)"
elif [ "$WANT_PROD" -eq 1 ]; then
  question="deploy to PRODUCTION ($PROD_PROJECT)"
else
  question="deploy to staging"
fi
release_args=(--question "$question")
[ "$ASSUME_YES" -eq 1 ] && release_args+=(--yes)
[ "$NEW_RELEASE" -eq 1 ] && release_args+=(--new-release)
release_out="$(mktemp)"
npx tsx scripts/deploy/release.ts "${release_args[@]}" --out "$release_out" || { rm -f "$release_out"; exit 1; }
# Only BUILD_VERSION=<semver> and RELEASE_CONFIRMED=<0|1>, written by release.ts.
BUILD_VERSION="$(sed -n 's/^BUILD_VERSION=//p' "$release_out")"
RELEASE_CONFIRMED="$(sed -n 's/^RELEASE_CONFIRMED=//p' "$release_out")"
rm -f "$release_out"
[ -n "$BUILD_VERSION" ] || fail "release.ts reported no version"
export BUILD_VERSION

step "Install workspace dependencies (also builds @oww/shared via postinstall)"
npm install

# One-off deploy steps (ADR-0049, docs/deploy/): a step file added since
# this environment's last deploy tag is pending (an environment without a
# tag is a fresh installation — nothing pending). At each phase boundary
# the script stops, hands the pending files to an interactive
# `claude` session that carries them out — or prints them, with --no-agent,
# without a terminal, or when this script already runs inside a Claude Code
# session (the outer agent reads them) — and asks once whether they are
# done. --yes never answers that question.
deploy_steps() {
  local env="$1" phase="$2" project="$3" pending prompt answer f
  pending="$(npx tsx scripts/deploy/deploy-steps.ts list --env "$env" --phase "$phase" --no-fetch)" \
    || fail "Could not read the deploy steps in docs/deploy/ — fix the file named above."
  [ -n "$pending" ] || return 0

  step "[$env] Deploy steps, $phase (docs/deploy/, ADR-0049):"
  sed 's/^/  /' <<<"$pending"
  if [ "$USE_AGENT" -eq 1 ] && [ -t 0 ] && [ -z "${CLAUDECODE:-}" ] && command -v claude >/dev/null; then
    prompt="$(npx tsx scripts/deploy/deploy-steps.ts prompt --env "$env" --phase "$phase" \
      --project "$project" --version "$BUILD_VERSION" --no-fetch)" \
      || fail "Could not build the agent prompt."
    echo "Starting an agent session to carry them out — end it when they are done."
    claude "$prompt" || warn "The agent session ended with an error."
  else
    while IFS= read -r f; do
      echo; echo -e "${YELLOW}----- $f -----${NC}"; cat "$f"
    done <<<"$pending"
    echo; echo "Carry these out now (or hand them to an agent), then confirm."
  fi

  echo -en "\n${YELLOW}All $phase steps done for $env? [y/N] ${NC}"
  read -r answer || answer=""
  [[ "$answer" =~ ^[Yy] ]] && return 0
  case "$phase" in
    before-functions)
      fail "Deploy steps not done — nothing deployed to $env. Carry them out, then run the deploy again." ;;
    after-functions)
      fail "Deploy steps not done — functions are deployed to $env, rules and hosting are not.
  Carry them out, then run the deploy again." ;;
    *)
      fail "Deploy steps not done — $env is deployed but NOT recorded, on purpose: the steps
  come back at the next deploy. Carry them out, then record the deploy:
  npx tsx scripts/deploy/deploy-record.ts deploy --env $env --component firebase" ;;
  esac
}

deploy_env() {
  local env="$1" project web_build
  if [ "$env" = "prod" ]; then
    project="$PROD_PROJECT"
    web_build="build"
    # A newly cut release already asked (and named production).
    if [ "$ASSUME_YES" -ne 1 ] && [ "$RELEASE_CONFIRMED" != 1 ]; then
      echo -en "\n${YELLOW}Deploy $BUILD_VERSION to PRODUCTION ($project)? [y/N] ${NC}"
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

  # Every deploy (ADR-0049): BigQuery learns a new stats column before the
  # functions that emit it go live — the export inserts with
  # skipInvalidRows: false, so one unknown column fails the whole batch.
  # Idempotent and quick; needs Application Default Credentials.
  step "[$env] BigQuery schema → $project (setup-bigquery.ts, idempotent)"
  npx tsx scripts/deploy/setup-bigquery.ts --project "$project" \
    || fail "setup-bigquery.ts failed for $project — nothing deployed. No credentials?
  gcloud auth application-default login"

  deploy_steps "$env" before-functions "$project"

  step "[$env] Functions → $project"
  npx tsx scripts/deploy/deploy-functions.ts --project "$project"

  # The staging-only test hooks (functions/src/testing/) forge badge taps with
  # the tag keys production shares and bill machine time without a terminal.
  # Their exports are conditional on the staging project id and the handlers
  # refuse elsewhere — this is the third, after-the-fact check that none of
  # them ever reached production.
  if [ "$env" = "prod" ]; then
    step "[$env] Verifying staging-only test tooling is absent from $project"
    local deployed hook
    deployed="$(firebase functions:list --project "$project")"
    for hook in mintTestTap uploadTestUsage; do
      if grep -q "$hook" <<<"$deployed"; then
        fail "$hook is deployed in PRODUCTION ($project). Delete it now:
  firebase functions:delete $hook --region europe-west6 --project $project"
      fi
    done
  fi

  deploy_steps "$env" after-functions "$project"

  step "[$env] Firestore + Storage rules/indexes → $project"
  firebase deploy --only firestore,storage --project "$project"

  step "[$env] Hosting (checkout + admin) → $project"
  WEB_BUILD_SCRIPT="$web_build" firebase deploy --only hosting --project "$project"

  deploy_steps "$env" after-deploy "$project"

  step "[$env] Recording the deploy (ADR-0045)"
  npx tsx scripts/deploy/deploy-record.ts deploy --env "$env" --component firebase \
    || warn "Deploy succeeded but was not recorded — record it by hand:
  npx tsx scripts/deploy/deploy-record.ts deploy --env $env --component firebase"

  step "[$env] Done → $project"
}

for env in "${ENVS[@]}"; do
  deploy_env "$env"
done

cat <<EOF

${GREEN}[deploy] $BUILD_VERSION deployed to: ${ENVS[*]}${NC}

Not covered by this script (see docs/deployment-checklist.md):
  - Gateway (npx tsx scripts/deploy/deploy-gateway.ts) and kiosk
  - Secrets rotation / new defineSecret values
  - Custom claims for newly-promoted admins (re-save user doc)
  - The smoke run: after a staging deploy that changes what people see, and
    before production, send an agent through the staging apps with
    /smoke-staging in Claude Code (runbook: ../machine-auth-operations/smoke)
EOF
