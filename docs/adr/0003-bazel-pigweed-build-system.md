# ADR-0003: Bazel + Pigweed Build System

**Status:** Accepted

**Date:** 2025-12-31

**Applies to:** `maco_firmware/`

## Context

The old `firmware/` used Particle's `neopo` compiler and `make`. This had limitations:
- Wiring API is hobbyist quality and does not scale
- Hard to share code with host-side tests
- No on-device unit testing
- Slow builds (60+ seconds)
- Single monolithic binary - can't easily build separate apps (factory test, tag prep tool)
- Had to manually implement patterns like Result types, status codes, async - never worked well

We need a build system that supports both Particle P2 hardware and host simulation, with professional embedded patterns.

## Decision

### Bazel with bzlmod

Use Bazel as the build system with bzlmod (MODULE.bazel) for dependency management:

```python
# MODULE.bazel
module(name = "machine_auth", version = "0.0.1")

bazel_dep(name = "pigweed")
local_path_override(module_name = "pigweed", path = "third_party/pigweed")

bazel_dep(name = "particle_bazel")
local_path_override(module_name = "particle_bazel", path = "third_party/particle")

bazel_dep(name = "lvgl")
local_path_override(module_name = "lvgl", path = "third_party/lvgl")
```

### Pigweed Integration

Pigweed provides battle-tested embedded primitives we previously tried to build ourselves:
- **pw_result/pw_status**: Proper error handling (replaces our manual Result types)
- **pw_async2**: Cooperative async runtime (replaces hand-rolled state machines)
- **pw_system**: RPC, logging, async runtime infrastructure
- **pw_thread/pw_sync/pw_chrono**: OS abstraction for threading, timing
- **Backend pattern**: Abstract interfaces with platform-specific implementations
- **Toolchains**: Host clang and ARM cross-compilation

### particle-bazel Library

Custom `particle_bazel` module (in `third_party/particle/`) provides Pigweed backends for Particle Device OS:
- `pw_thread_particle` - Thread creation using Particle OS threads
- `pw_sync_particle` - Mutexes, semaphores via Particle primitives
- `pw_chrono_particle` - System clock using Particle time APIs
- `pw_sys_io_particle` - Serial I/O for RPC/logging
- `pb_log` - Bridge from pw_log to Particle serial

### Platform Selection

Platforms defined in `targets/<platform>/BUILD.bazel`:

```python
platform(
    name = "p2",
    constraint_values = ["@pigweed//pw_build/constraints/arm:cortex-m33"],
    flags = flags_from_dict({
        "@pigweed//pw_thread:thread_backend": "@particle_bazel//pw_thread_particle:thread",
        "@pigweed//pw_chrono:system_clock_backend": "@particle_bazel//pw_chrono_particle:system_clock",
        # ... other backend bindings
    }),
)
```

Targets use Bazel transitions to select their platform automatically:
```bash
bazelisk build //maco_firmware/apps/dev            # P2 firmware (dev build)
bazelisk build //maco_firmware/apps/dev:simulator  # host simulator
bazelisk run //maco_firmware/apps/dev:flash        # build + flash to device
bazelisk build //maco_firmware/apps/prod           # P2 firmware (production)
```

### Third-Party as Git Submodules

Dependencies in `third_party/` as git submodules:
- `third_party/pigweed` - Pigweed framework
- `third_party/particle` - particle-bazel (our library)
- `third_party/lvgl` - LVGL graphics (with custom BUILD.bazel)

## Consequences

**Pros:**
- Single build system for host + hardware
- Incremental builds (seconds, not minutes)
- Multiple apps from shared code (production, factory test, tag prep, etc.)
- On-device unit tests with pw_unit_test
- Pigweed's battle-tested primitives (pw_async2, pw_result, pw_status)
- Flash directly via `./pw flash`
- IDE support via compile_commands.json (pw_ide auto-refresh)

**Cons:**
- Learning curve for Bazel + Pigweed
- particle-bazel requires maintenance as Device OS evolves
- Git submodules add complexity to repo management

## Related

- [ADR-0009](0009-local-build-flash-tooling.md) - Local build and flash tooling architecture
