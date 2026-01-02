# ADR-0009: Local Build and Flash Tooling

**Status:** Accepted

**Date:** 2026-01-02

**Applies to:** `maco_firmware/`

## Context

Building and flashing firmware requires multiple tools with different behaviors:

1. **IDE code intelligence** (clangd) needs `compile_commands.json` to be kept in sync with the code being actively developed
2. **Flash operations** run as host tools (k8-opt-exec configuration), which would pollute IDE state if compile_commands were updated
3. **Sanitizer builds** (asan, tsan, ubsan) are useful for CI/testing but shouldn't change IDE state during normal development

The challenge: how to auto-update IDE for development builds while isolating flash and sanitizer operations?

## Decision

### Dual-Command Architecture

We implement two entry points with different behaviors:

#### 1. `bazel` (via `tools/bazel` wrapper)

Bazelisk automatically detects `tools/bazel` and uses it as a wrapper. After every successful `build`, `run`, or `test`:

```bash
$BAZEL_REAL "$@"
# On success, refresh compile_commands via pw_ide
$BAZEL_REAL run @pigweed//pw_ide/bazel:update_compile_commands -- "$@"
```

**Use for:** Regular development (IDE stays in sync)

#### 2. `./pw` (via `pw` script)

Runs bazel in an isolated environment with `BAZELISK_SKIP_WRAPPER=1`.

**Special commands** (handled directly by the script):
- `./pw flash` → Runs `bazel run //maco_firmware/apps/dev:flash`
- `./pw run //target` → Runs `bazel run //target`

**Workflow commands** (via Pigweed workflows_launcher):
- `./pw build host` → Build simulator
- `./pw build p2` → Build P2 firmware
- `./pw build asan/tsan/ubsan` → Sanitizer builds

**Use for:** Flash, sanitizers, CI (no IDE pollution)

### Components

| File | Purpose |
|------|---------|
| `tools/bazel` | Wrapper that auto-refreshes compile_commands |
| `pw` | Wrapper that runs isolated (no compile_commands update) |
| `workflows.json` | Defines build configurations for `./pw` |
| `//:pw` | Bazel target for Pigweed workflows_launcher |

### Workflow Configurations

`workflows.json` defines these builds:

| Build | Config | Targets |
|-------|--------|---------|
| `host` | default | `//maco_firmware/apps/dev:simulator` |
| `p2` | `--config=p2` | `//maco_firmware/apps/dev:dev` |
| `flash` | default | `//maco_firmware/apps/dev:flash` |
| `asan` | `--config=asan` | `//maco_firmware/...` |
| `tsan` | `--config=tsan` | `//maco_firmware/...` |
| `ubsan` | `--config=ubsan` | `//maco_firmware/...` |

### When to Use Each

| Task | Command | Updates IDE? |
|------|---------|--------------|
| Build during development | `bazel build //target` | ✅ Yes |
| Run tests | `bazel test //target` | ✅ Yes |
| Flash firmware | `./pw flash` | ❌ No |
| Sanitizer builds | `./pw build asan` | ❌ No |
| Run all checks | `./pw build default` | ❌ No |

### For Claude (AI Assistant)

**Always use `./pw` commands** to avoid accidentally changing the user's IDE state:

```bash
./pw build host    # Build simulator
./pw build p2      # Build P2 firmware
./pw flash         # Flash to device
./pw build asan    # Address Sanitizer
```

## Consequences

**Pros:**

- IDE compile_commands always reflects what developer is actively working on
- Flash operation doesn't pollute IDE with k8-opt-exec configuration
- Sanitizer builds are isolated from main development workflow
- Single `workflows.json` defines all build configurations
- Claude doesn't interfere with user's IDE state

**Cons:**

- Two commands to remember (`bazel` vs `./pw`)
- Requires understanding when to use each
- First `./pw` invocation is slow (builds workflows_launcher)

## Related

- [ADR-0003](0003-bazel-pigweed-build-system.md) - Bazel + Pigweed build system
- [ADR-0002](0002-firmware-simulator-architecture.md) - Simulator architecture
