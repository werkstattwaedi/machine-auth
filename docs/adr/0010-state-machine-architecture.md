# ADR-0010: State Machine Architecture

**Status:** Accepted (async task portion superseded by [ADR-0014](0014-cpp20-coroutines-for-async.md))

**Date:** 2026-01-04

**Applies to:** `maco_firmware/` (Pigweed + Bazel)

## Context

maco_firmware has two distinct state management needs:

1. **Application state** - System-level state machines (NFC auth flow, session lifecycle, machine activation) requiring hierarchical states and complex transition logic
2. **Async task state** - Internal state within pw_async2 tasks for managing multi-step async operations

### Application State Requirements

- Hierarchical states (e.g., Active → WarmingUp/Running/Paused)
- Event-driven transitions (NFC reads, timeouts, UI actions)
- No dynamic allocation
- Active maintenance for long-term support

### Libraries Evaluated for Application State

| Library | Hierarchy | Memory | Last Commit | Particle Integration |
|---------|-----------|--------|-------------|---------------------|
| **ETL HFSM** | Yes | Zero heap | Dec 2025 (active) | Easy - no OS deps |
| **hsmcpp** | Yes | ~20KB heap | 2 years ago | Hard - needs custom dispatcher |

## Decision

### Application State: ETL HFSM

Use [ETL (Embedded Template Library)](https://www.etlcpp.com/) `etl::hfsm` for application-level state machines:

- **Zero dynamic allocation** - All storage compile-time or stack
- **CRTP-based routing** - No vtable overhead, direct function calls
- **Header-only** - Simple integration, no build complexity
- **Actively maintained** - v20.44.2 (Dec 2025), 5,842 commits, 150 contributors

```cpp
// Application state machine using ETL HFSM
class MachineState : public etl::fsm_state<MachineFsm, MachineState, StateId::kIdle, ...> {
  void on_enter_state() { /* activate relay, log, etc */ }
  etl::fsm_state_id_t on_event(const SessionCreatedEvent& e) {
    return StateId::kActive;
  }
};
```

### Async Task State: pw_async2 with enum

Use Pigweed's recommended pattern for internal task state - simple enum + switch within `DoPend()`:

```cpp
// Async task with internal state (Pigweed pattern)
class NfcReadTask : public pw::async2::Task {
  enum class State { kIdle, kReading, kAuthenticating, kDone };

  pw::async2::Poll<> DoPend(pw::async2::Context& cx) override {
    switch (state_) {
      case State::kIdle:
        state_ = State::kReading;
        [[fallthrough]];
      case State::kReading:
        PW_TRY_READY_ASSIGN(tag_data_, reader_.PendRead(cx));
        state_ = State::kAuthenticating;
        [[fallthrough]];
      case State::kAuthenticating:
        PW_TRY_READY_ASSIGN(auth_result_, auth_.PendAuth(cx, tag_data_));
        // Notify application FSM
        app_fsm_.receive(TagAuthenticatedEvent{auth_result_});
        state_ = State::kDone;
        return pw::async2::Ready();
    }
  }

  State state_ = State::kIdle;
};
```

### Integration Pattern

```
┌─────────────────────────────────────────────────────────┐
│                    pw_async2 Dispatcher                 │
├─────────────────────────────────────────────────────────┤
│  NfcReadTask      SessionTask      TimeoutTask          │
│  (enum state)     (enum state)     (enum state)         │
│       │                │                │               │
│       └────────────────┼────────────────┘               │
│                        ▼                                │
│              ┌─────────────────┐                        │
│              │   ETL HFSM      │                        │
│              │ (app state)     │                        │
│              │ Idle→Active→... │                        │
│              └─────────────────┘                        │
└─────────────────────────────────────────────────────────┘
```

**pw_async2 tasks** handle async I/O and timing with simple internal state.
**ETL HFSM** handles application state transitions triggered by task completions.

### Integration Path

1. Add ETL as `third_party/etl/` (header-only, Bazel target)
2. Create `maco_firmware/system/fsm/` for application state machines
3. Migrate existing variant-based state machines incrementally

## Consequences

**Pros:**

- Clear separation: async coordination (pw_async2) vs application logic (ETL HFSM)
- Zero heap allocation for both patterns
- ETL actively maintained; pw_async2 is core Pigweed
- No custom dispatcher work needed

**Cons:**

- Two patterns to learn (enum+switch for tasks, CRTP for app state)
- ETL HFSM has verbose template boilerplate

**Tradeoffs:**

- **Rejected hsmcpp** - Better async API but unmaintained (2 years), requires custom Particle dispatcher, uses heap allocation
- **Rejected ETL HFSM for task state** - Overkill for simple sequential async operations; enum+switch is simpler and Pigweed-idiomatic
