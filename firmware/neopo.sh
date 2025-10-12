#!/bin/bash

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Change to script directory
pushd "$SCRIPT_DIR" > /dev/null || exit 1

# Ensure we always return to the previous directory
trap 'popd > /dev/null' EXIT

# Activate virtual environment
source .neopovenv/bin/activate

# Run neopo with all arguments
neopo "$@"
