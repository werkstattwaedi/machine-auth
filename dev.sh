#!/usr/bin/env bash
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT
#
# One-command dev environment startup.
# Checks prerequisites, builds if needed, then starts all services.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[dev]${NC} $1"; }
warn() { echo -e "${YELLOW}[dev]${NC} $1"; }
error() { echo -e "${RED}[dev]${NC} $1"; exit 1; }

FRESH=false
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=true ;;
  esac
done

# Check prerequisites
command -v node >/dev/null 2>&1 || error "node is required. Install Node.js 22+."
command -v firebase >/dev/null 2>&1 || error "firebase CLI is required. Run: npm i -g firebase-tools"

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  error "Node.js 20+ required, found $(node -v)"
fi

# Install root deps if needed
if [ ! -d "node_modules" ]; then
  info "Installing root dependencies..."
  npm install
fi

# Install functions deps if needed
if [ ! -d "functions/node_modules" ]; then
  info "Installing functions dependencies..."
  (cd functions && npm install)
fi

# Build functions if needed
if [ ! -d "functions/lib" ]; then
  info "Building functions..."
  (cd functions && npm run build)
fi

# Install web deps if needed
if [ -d "web" ] && [ ! -d "web/node_modules" ]; then
  info "Installing web dependencies..."
  (cd web && npm install)
fi

if [ "$FRESH" = true ]; then
  warn "Fresh start requested — clearing persisted emulator data..."
  rm -rf firebase-data
fi

if [ -d "firebase-data" ]; then
  info "Restoring emulator data from previous session."
else
  info "No persisted data found — starting with empty emulators."
  info "  Run 'npm run seed' after startup to populate test data."
fi

info "Starting dev environment..."
info "  Emulator UI:  http://localhost:4000"
info "  Functions:    http://localhost:5001"
info "  Web app:      http://localhost:5173"
info "  Hosting:      http://localhost:5050"
info ""
info "Press Ctrl+C to stop all services."
info "  Tip: use './dev.sh --fresh' to start with empty emulators."
echo ""

npm run dev
