#!/bin/bash
set -e

# Build and run script for Machine Auth Simulator
# This script MUST be run from the firmware/simulator/ directory

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Change to script directory
pushd "$SCRIPT_DIR" > /dev/null || exit 1
# Ensure we always return to the previous directory
trap 'popd > /dev/null' EXIT


echo "=== Building Simulator ==="
./build.sh

echo
echo "=== Running Simulator ==="
echo "Arguments: $@"
echo

# Run simulator with all arguments passed to this script
exec ./build/simulator "$@"
