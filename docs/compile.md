# Compilation Guide

This guide covers building both the new Pigweed-based firmware (`maco_firmware/`) and the legacy Particle firmware (`firmware/`).

## MACO Firmware (Bazel)

The new Pigweed-based firmware in `maco_firmware/` uses Bazel.

### Quick Reference

| Task | Command |
|------|---------|
| Build simulator | `bazel build //maco_firmware/apps/dev:simulator` |
| Run simulator | `bazel run //maco_firmware/apps/dev:simulator` |
| Build P2 firmware | `bazel build //maco_firmware/apps/dev` |
| Flash to device | `./pw flash` |
| Sanitizer builds | `./pw build asan`, `./pw build tsan`, `./pw build ubsan` |

### Important: `bazel` vs `./pw`

- **Use `bazel`** for regular development - auto-updates IDE compile_commands
- **Use `./pw`** for flash and sanitizers - runs isolated, no IDE pollution

See [ADR-0009](adr/0009-local-build-flash-tooling.md) for architecture details.

### One-time Setup (Bazel)

For simulator builds, install SDL2 development libraries:

```bash
# Ubuntu/Debian
sudo apt-get install libsdl2-dev

# macOS
brew install sdl2

# Fedora
sudo dnf install SDL2-devel
```

---

## Legacy Firmware (neopo)

**IMPORTANT: Always use these build scripts. Never run `cmake`, `make`, or `neopo` directly.**

### One-time Setup

Run this once to set up the neopo build environment (must be run from firmware directory):

```bash
cd firmware

TEMPDIR="$(mktemp -d)"
git clone https://github.com/nrobinson2000/neopo "$TEMPDIR/neopo"
python3 -m venv .neopovenv
source .neopovenv/bin/activate
python3 -m pip install "$TEMPDIR/neopo"
```

### Firmware Compilation

**Always use `firmware/neopo.sh` to compile Particle firmware.**

```bash
# From anywhere in the repository
firmware/neopo.sh compile
```



NOTE: Cloud compilation (`particle compile`) fails due to large LVGL library size, so its not an option. 

## Simulator Compilation

**Always use `firmware/simulator/build.sh` to build the simulator.**

```bash
# From anywhere in the repository
firmware/simulator/build.sh
```

The script:

- Checks for SDL2 dependencies
- Configures CMake in the correct directory
- Builds with optimal parallel jobs
- Produces `firmware/simulator/build/simulator`

**Running the simulator:**

```bash
# Build and run in one command (recommended for quick iteration)
firmware/simulator/run.sh --state idle      # Build + run in idle state
firmware/simulator/run.sh --state active    # Build + run with active session
firmware/simulator/run.sh --state denied    # Build + run in denied state

# Or run directly (if already built)
firmware/simulator/build/simulator --state idle
```

## Troubleshooting

### Firmware compilation issues

```bash
# Clean build (rarely needed)
firmware/neopo.sh clean
firmware/neopo.sh compile
```

### Simulator compilation issues

```bash
# Clean rebuild
rm -rf firmware/simulator/build/
firmware/simulator/build.sh
```
