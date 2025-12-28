#!/bin/bash
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT
#
# Switch IDE code analysis between platforms
# Usage: ./tools/switch_platform.sh [host|p2]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

if [ -z "$1" ]; then
    echo "Usage: $0 [host|p2]"
    echo ""
    echo "Available platforms:"
    echo "  host - Host toolchain (for general development)"
    echo "  p2   - Particle P2 (ARM Cortex-M33)"
    echo ""
    if [ -L "compile_commands.json" ]; then
        current=$(readlink compile_commands.json)
        echo "Current: $current"
    else
        echo "No platform selected. Run 'bazel run //:refresh_compile_commands' first."
    fi
    exit 1
fi

PLATFORM="$1"
COMPILE_COMMANDS=".compile_commands/${PLATFORM}/compile_commands.json"

if [ ! -f "$COMPILE_COMMANDS" ]; then
    echo "Error: $COMPILE_COMMANDS not found"
    echo "Run 'bazel run //:refresh_compile_commands' first"
    exit 1
fi

ln -sf "$COMPILE_COMMANDS" compile_commands.json
echo "Switched to $PLATFORM platform"
echo "Restart your language server (clangd) to pick up the changes"
