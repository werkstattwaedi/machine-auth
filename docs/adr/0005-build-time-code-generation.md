# ADR-0005: Build-Time Code Generation

**Status:** Accepted

**Date:** 2026-01-01

**Applies to:** All generated code in the repository

## Context

Code generation is common in embedded projects: fonts, protocol buffers, configuration files, asset converters, etc. There are two approaches:

1. **Check in generated code**: Run generator manually, commit output
2. **Build-time generation**: Generator runs as part of `bazel build`

Checked-in generated code has significant drawbacks:
- Repository bloat (generated code often 10-100x larger than source)
- Source/output drift when someone edits source but forgets to regenerate
- Unclear provenance - which tool version? which parameters?
- Merge conflicts in generated files
- Code review noise for machine-generated content

## Decision

**Prefer build-time code generation over checked-in generated code.**

Generated files should be build artifacts, not source files. Only check in:
- Source files (`.ttf`, `.proto`, `.fbs`, configuration)
- Generator configuration (parameters in BUILD files)
- Lockfiles for reproducibility (e.g., `pnpm-lock.yaml`)

### Implementation Patterns

#### Pattern 1: npm-based Generators (aspect_rules_js)

For npm-distributed tools, use `aspect_rules_js` with pnpm lockfiles:

```
third_party/<tool>/
├── BUILD.bazel      # npm_link_all_packages()
├── package.json     # npm dependency declaration
├── pnpm-lock.yaml   # hermetic version lock
└── <tool>.bzl       # Bazel macro wrapping genrule
```

Usage in downstream BUILD files:
```python
load("//third_party/lv_font_conv:font.bzl", "lvgl_font")

lvgl_font(name = "roboto_24", ttf = "Roboto-Regular.ttf", size = 24)
```

**Example:** `third_party/lv_font_conv/` for LVGL fonts

#### Pattern 2: Pigweed Generators

Pigweed provides generators for protobufs, nanopb, etc. Use their rules directly:
```python
load("@pigweed//pw_protobuf:pw_proto_library.bzl", "pw_proto_library")

pw_proto_library(
    name = "my_proto",
    deps = [":my_proto_src"],
)
```

#### Pattern 3: Native Bazel Rules

For standard formats, use existing Bazel rules:
```python
proto_library(name = "api_proto", srcs = ["api.proto"])
cc_proto_library(name = "api_cc_proto", deps = [":api_proto"])
```

### Exceptions

Check in generated code only when:
- Generator is not available in CI/build environment
- Generation requires proprietary tools
- Bootstrap problem (generator needs generated code to build)

Document exceptions in the relevant BUILD file with rationale.

## Consequences

**Pros:**
- Repository stays lean (source only)
- Single source of truth - no drift possible
- Clear parameters in BUILD files
- Reproducible via lockfiles
- No merge conflicts in generated code
- Code review focuses on meaningful changes

**Cons:**
- First build may download generator dependencies
- Generator tool updates require lockfile regeneration
- Build errors if generator fails (vs. stale but working code)

**Migration:**
When converting checked-in generated code to build-time:
1. Add generator to appropriate `third_party/` wrapper
2. Create Bazel macro for easy usage
3. Update BUILD files to use macro
4. Delete checked-in generated files
5. Verify build produces equivalent output

## References

- Example: `third_party/lv_font_conv/` (npm-based font generation)
- Example: `schema/` (flatbuffers generation)
- Related: ADR-0003 (Bazel + Pigweed Build System)
