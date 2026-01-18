#!/bin/bash
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

# Generate token database from firmware binary
# Usage: ./tools/gen_token_db.sh [binary_path] [output_csv]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

BINARY="${1:-$PROJECT_ROOT/bazel-bin/maco_firmware/apps/dev/dev_firmware}"
OUTPUT="${2:-$PROJECT_ROOT/tokens.csv}"

if [ ! -f "$BINARY" ]; then
    echo "Error: Binary not found at $BINARY"
    echo "Build the firmware first: ./pw build p2"
    exit 1
fi

echo "Generating token database from $BINARY..."
python -m pw_tokenizer.database create --database "$OUTPUT" "$BINARY"
echo "Token database written to $OUTPUT"
