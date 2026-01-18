---
description: Plan a feature implementation using idiomatic Pigweed patterns. Use before implementing new features to ensure proper module selection and architecture.
---

# Pigweed Architecture Planning

You are helping plan a feature implementation using Pigweed idiomatically. This requires deep analysis to recommend the right modules and patterns.

## Knowledge Base

- **Module catalog**: `.claude/agents/pigweed-expert/MODULES.md` (all 183 Pigweed modules)
- **Patterns & examples**: `.claude/agents/pigweed-expert/SUMMARY.md`
- **Pigweed docs**: `third_party/pigweed/pw_*/docs.rst`
- **Particle backends**: `third_party/particle/pw_*_particle/docs.rst`
- **Particle modules**: `third_party/particle/pb_*/docs.rst`

## Instructions

### Phase 1: Understand Requirements

First, analyze what the user is trying to build:
- What are the functional requirements?
- What are the constraints (memory, latency, power, real-time)?
- What hardware abstractions are needed?
- What communication protocols are involved?
- What error handling is required?

If requirements are unclear, ask clarifying questions.

### Phase 2: Check Documentation

1. Read `.claude/agents/pigweed-expert/MODULES.md` to identify candidate modules
2. For specific module details, read `third_party/pigweed/pw_<module>/docs.rst`
3. Check `SUMMARY.md` for established patterns

### Phase 3: Module Selection

For each aspect of the feature, determine:
- Which Pigweed module(s) apply?
- What are the alternatives and tradeoffs?
- Are there module combinations that work well together?

Consider these module categories:
- **Async**: pw_async2 for cooperative multitasking
- **Error handling**: pw_result, pw_status
- **Data**: pw_containers, pw_span, pw_string
- **Communication**: pw_rpc, pw_hdlc, pw_stream
- **Storage**: pw_kvs, pw_blob_store
- **Logging**: pw_log, pw_tokenizer
- **Time**: pw_chrono
- **Sync**: pw_sync, pw_thread

For Particle Device OS, also consider:
- **GPIO**: pw_digital_io_particle
- **SPI**: pw_spi_particle (DMA transfers)
- **UART**: pw_stream_particle (non-blocking)
- **Crypto**: pb_crypto (AES for NTAG424)
- **Logging bridge**: pb_log (Device OS to pw_log)
- **Watchdog**: pb_watchdog

### Phase 4: Architecture Design

Design the system following Pigweed principles:
- **Facade pattern**: Where are hardware abstractions needed?
- **Dependency injection**: What dependencies should be injected?
- **Testability**: How will this be tested on host?
- **Modularity**: How do components connect?

### Phase 5: Implementation Strategy

Create a concrete plan:
- What order should things be built?
- What are the risk areas?
- What BUILD.bazel targets are needed?
- What tests should be written first?

## Output Format

### Summary
Brief overview of the recommended approach

### Recommended Modules
| Module | Purpose in This Feature |
|--------|------------------------|
| pw_xxx | Why it's needed |

### Architecture
- High-level design with component interactions
- Key interfaces/facades needed
- Dependency graph

### Build Targets
```python
# BUILD.bazel structure
cc_library(
    name = "feature_name",
    hdrs = ["feature.h"],
    srcs = ["feature.cc"],
    deps = [
        "@pigweed//pw_result",
        "@pigweed//pw_log",
    ],
)
```

### Implementation Phases
1. Phase 1: ...
2. Phase 2: ...

### Testing Strategy
- Host-side tests with pw_unit_test
- What to mock/fake
- Integration test approach

### Open Questions
- Things to resolve before/during implementation

---

## Feature to Plan

$ARGUMENTS
