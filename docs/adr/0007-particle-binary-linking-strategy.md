# ADR-0007: Particle Binary Linking Strategy

**Status:** Accepted

**Date:** 2026-01-01

**Applies to:** `third_party/particle/` (Particle Pigweed backends)

## Context

Particle Device OS uses a complex linking process for user firmware:

1. **Module boundaries** - User firmware must declare precise flash/RAM sizes in the module header for OTA updates to work correctly
2. **Two-pass linking** - The Make build first links with conservative defaults, extracts actual sizes from the ELF, then re-links with precise values
3. **CRC patching** - Final binary needs SHA256 and CRC32 patched into the module header

We needed to replicate this in Bazel to build Pigweed-based firmware for Particle devices.

## Decision

### Replicate Particle's Make Build Approach

Rather than redesigning the linking process, we focused on replicating what Particle's Make scripts do:

```
Pass 1: Link with generous defaults (1.5MB flash, 128KB SRAM)
     ↓
Extract: Use objdump to get actual section sizes from intermediate ELF
     ↓
Generate: Create memory_platform_user.ld with precise sizes
     ↓
Pass 2: Re-link with precise memory values for OTA-compatible module header
     ↓
Patch: Add SHA256/CRC32 checksums to final .bin
```

### Custom `particle_cc_binary` Macro

The `particle_cc_binary` macro in `rules/particle_firmware.bzl` implements this:

```python
particle_cc_binary(
    name = "app.elf",
    srcs = ["main.cc"],
    deps = [":my_lib"],
    platform = "@particle_bazel//platforms/p2:particle_p2",
)
```

This creates:
- `{name}_lib` - cc_library with Particle compiler flags
- `{name}` - ELF via `_particle_two_pass_binary` rule

The `_particle_two_pass_binary` rule:
- Collects static libraries from deps
- Runs two-pass linking via shell script
- Uses `extract_elf_sizes.py` to parse ELF sections between passes
- Generates `memory_platform_user.ld` with precise sizes

### Key Files

- `rules/particle_firmware.bzl` - Main macros and two-pass linking rule
- `rules/memory_platform_user.ld` - Conservative defaults for pass 1
- `tools/extract_elf_sizes.py` - Extracts section sizes from intermediate ELF
- `tools/particle_crc.py` - Patches SHA256/CRC32 into final binary

## Consequences

### Pros

- **Works** - Successfully builds and flashes Pigweed firmware to Particle P2
- **OTA compatible** - Module headers have correct sizes for OTA updates
- **Familiar** - Matches what Particle developers expect from their build system

### Cons

- **`particle_cc_binary` is disjoint from `cc_binary`** - This is a custom rule, not a configuration of the standard `cc_binary`. Pigweed uses `cc_binary` with custom linker scripts, but our approach creates a separate rule type entirely.

- **Breaks downstream integrations:**
  - **On-device tests** - Pigweed's `pw_cc_test` expects `cc_binary` semantics; we needed a separate `particle_cc_test` macro (see ADR-0006)
  - **pw_ide** - Target selection and IDE integration is more complicated since our targets don't follow standard patterns
  - **Tooling** - Any Pigweed tooling that expects `cc_binary` conventions won't work automatically

- **Two-pass linking overhead** - Every build links twice, though this is fast for typical firmware sizes

## Future Work

Investigate migrating to Pigweed-style `cc_binary` with custom linker scripts:

1. **Understand** why Particle requires two-pass linking - Is it fundamentally necessary for OTA, or an artifact of their build system?
2. **Explore** static module size allocation - Could we reserve fixed sizes and avoid runtime size calculation?
3. **Prototype** single-pass linking with Pigweed linker scripts to see what breaks
4. **Migrate** incrementally if feasible, enabling `pw_cc_test` and standard IDE integration
