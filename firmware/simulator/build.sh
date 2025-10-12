#!/bin/bash
set -e

# Build script for Machine Auth Simulator
# This script MUST be run from the firmware/simulator/ directory

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Change to script directory
cd "$SCRIPT_DIR"

echo "=== Machine Auth Simulator Build ==="
echo "Working directory: $SCRIPT_DIR"
echo

# Check for SDL2
if ! pkg-config --exists sdl2; then
    echo "ERROR: SDL2 not found!"
    echo
    echo "Please install SDL2 development libraries:"
    echo "  Ubuntu/Debian: sudo apt-get install libsdl2-dev libsdl2-ttf-dev"
    echo "  macOS: brew install sdl2 sdl2_ttf"
    echo "  Fedora: sudo dnf install SDL2-devel SDL2_ttf-devel"
    echo
    exit 1
fi

# Check for SDL2_ttf
if ! pkg-config --exists SDL2_ttf; then
    echo "ERROR: SDL2_ttf not found!"
    echo
    echo "Please install SDL2_ttf development libraries:"
    echo "  Ubuntu/Debian: sudo apt-get install libsdl2-ttf-dev"
    echo "  macOS: brew install sdl2_ttf"
    echo "  Fedora: sudo dnf install SDL2_ttf-devel"
    echo
    exit 1
fi

echo "SDL2 found: $(pkg-config --modversion sdl2)"
echo "SDL2_ttf found: $(pkg-config --modversion SDL2_ttf)"
echo

# Create build directory
if [ ! -d "build" ]; then
    echo "Creating build directory..."
    mkdir -p build
fi

# Configure
echo "Configuring CMake..."
cmake -B build -S . -DCMAKE_BUILD_TYPE=Debug

# Build
echo "Building..."
NUM_CORES=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)
cmake --build build -j${NUM_CORES}

echo
echo "=== Build Complete ==="
echo "Run simulator: $SCRIPT_DIR/build/simulator [--state idle|active|denied]"
echo
