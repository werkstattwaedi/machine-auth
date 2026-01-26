# ADR-0014: C++20 Coroutines for Async Operations

**Status:** Accepted (supersedes async task portion of ADR-0010)

**Date:** 2026-01-26

**Applies to:** `maco_firmware/` (Pigweed + Bazel)

## Context

ADR-0010 established two patterns for state management:
1. **Application state**: ETL HFSM for hierarchical state machines
2. **Async task state**: enum+switch within `DoPend()` for multi-step async operations

The enum+switch pattern was chosen because C++20 coroutines were not available in the toolchain at the time. With C++20 support now enabled, Pigweed's `pw_async2::Coro<T>` provides a significantly more readable and maintainable approach for sequential async operations.

### Problems with enum+switch

- **Manual state tracking**: Must define enum values and manage transitions explicitly
- **Scattered logic**: Code for a single logical operation split across switch cases
- **Error-prone**: Easy to forget `[[fallthrough]]` or mismanage state variables
- **Hard to read**: Sequential intent obscured by state machine boilerplate

## Decision

**Use `pw::async2::Coro<T>` as the preferred pattern for async operations.** The manual `Task` + `DoPend()` + enum/switch pattern should only be used when coroutines are not suitable (rare edge cases).

### Core Components

| Component | Purpose |
|-----------|---------|
| `pw::async2::Coro<T>` | Coroutine return type (T = return value) |
| `pw::async2::CoroContext` | Allocator wrapper for coroutine frames |
| `pw::async2::CoroOrElseTask` | Wraps coroutine with error handler for dispatcher |
| `co_await` | Suspend until sub-coroutine completes |
| `co_return` | Return value from coroutine |

### Example: Sequential Async Operations

```cpp
// Before: enum+switch pattern (NO LONGER PREFERRED)
class NfcReadTask : public pw::async2::Task {
  enum class State { kIdle, kDetecting, kReading };

  pw::async2::Poll<> DoPend(pw::async2::Context& cx) override {
    switch (state_) {
      case State::kIdle:
        detect_future_.emplace(reader_.DetectTag());
        state_ = State::kDetecting;
        [[fallthrough]];
      case State::kDetecting:
        PW_TRY_READY_ASSIGN(tag_, detect_future_->Pend(cx));
        read_future_.emplace(tag_->Read());
        state_ = State::kReading;
        [[fallthrough]];
      case State::kReading:
        PW_TRY_READY_ASSIGN(data_, read_future_->Pend(cx));
        return pw::async2::Ready();
    }
  }
  State state_ = State::kIdle;
};

// After: Coroutine pattern (PREFERRED)
pw::async2::Coro<pw::Result<Data>> ReadNfcTag(
    pw::async2::CoroContext& cx,
    NfcReader& reader) {
  auto tag = co_await reader.DetectTag(cx);
  if (!tag.ok()) co_return tag.status();

  auto data = co_await tag->Read(cx);
  co_return data;
}
```

### Starting a Coroutine on the Dispatcher

```cpp
class MyReader {
 public:
  MyReader(pw::allocator::Allocator& alloc) : coro_cx_(alloc) {}

  void Start(pw::async2::Dispatcher& dispatcher) {
    auto coro = RunLoop(coro_cx_);
    task_.emplace(std::move(coro), [](pw::Status s) {
      PW_LOG_ERROR("Coroutine failed: %d", static_cast<int>(s.code()));
    });
    dispatcher.Post(*task_);
  }

 private:
  pw::async2::Coro<pw::Status> RunLoop(pw::async2::CoroContext& cx);

  pw::async2::CoroContext coro_cx_;  // ~512 bytes from allocator
  std::optional<pw::async2::CoroOrElseTask> task_;
};
```

### Memory Requirements

`CoroContext` allocates coroutine frames from the provided allocator. Budget approximately **512 bytes per active coroutine**. The allocator must provide sufficient memory for all concurrent coroutines.

### ETL HFSM Unchanged

This ADR only supersedes the "async task state" portion of ADR-0010. **ETL HFSM remains the correct choice for application-level state machines** where:
- Hierarchical states are needed (e.g., Active → WarmingUp/Running/Paused)
- Complex event-driven transitions exist
- State visualization/debugging is important

## Consequences

**Pros:**

- **More readable**: Sequential code flow matches logical intent
- **No manual state tracking**: Compiler handles suspension/resumption
- **Less error-prone**: No forgotten `[[fallthrough]]` or state mismatches
- **Composable**: Coroutines can call other coroutines with `co_await`

**Cons:**

- **Memory overhead**: Requires allocator with sufficient memory (~512 bytes per coroutine)
- **Debugging**: Stack traces may be less clear (compiler-generated code)

**Migration:**

- Existing `DoPend()` implementations can remain (still valid, just not preferred)
- New async code should use `Coro<T>` wherever possible
- Convert existing code opportunistically during refactoring

**Reference implementation:** `maco_firmware/devices/pn532/pn532_nfc_reader.*`
