# Pigweed Knowledge Summary

*Last updated: 2026-01-08*

## Executive Summary

Pigweed is Google's open-source embedded development framework designed around three core principles: **portability** (facade/backend pattern enables platform independence), **efficiency** (zero dynamic allocation, minimal code size), and **reliability** (type-safe APIs, comprehensive error handling).

The framework provides a cohesive set of modules that work together through shared conventions. Rather than forcing wholesale adoption, projects can selectively use individual modules. Key architectural patterns include: facades with pluggable backends, `pw::Status` error propagation with `PW_TRY` macros, and cooperative async via `pw_async2`.

Pigweed emphasizes **compile-time safety** wherever possible—from `constexpr` byte array construction to static thread safety analysis. This philosophy extends to testing with GoogleTest-compatible APIs that run on both host and embedded targets.

---

## Local Documentation Index

All documentation is available locally in `third_party/pigweed/`. Use these paths to find detailed information:

### Core Guides

| Topic | File |
|-------|------|
| Facade pattern | `docs/sphinx/facades.rst` |
| Embedded C++ guide | `docs/sphinx/embedded_cpp_guide.rst` |
| Style guide (overview) | `docs/sphinx/style_guide.rst` |
| Size optimizations | `docs/sphinx/size_optimizations.rst` |
| Module structure | `docs/sphinx/module_structure.rst` |
| Target configuration | `docs/sphinx/targets.rst` |
| Toolchain setup | `docs/sphinx/toolchain.rst` |
| FAQ | `docs/sphinx/faq.rst` |
| Glossary | `docs/sphinx/glossary.rst` |

### Style Guides (detailed)

| Topic | File |
|-------|------|
| C++ style | `docs/sphinx/style/cpp.rst` |
| Python style | `docs/sphinx/style/python.rst` |
| Bazel style | `docs/sphinx/style/bazel.rst` |
| Protobuf style | `docs/sphinx/style/protobuf.rst` |
| Commit messages | `docs/sphinx/style/commit_message.rst` |
| Documentation (RST) | `docs/sphinx/style/rest.rst` |
| Doxygen | `docs/sphinx/style/doxygen.rst` |
| CLI style | `docs/sphinx/style/cli.rst` |

### Build Systems

| Topic | File |
|-------|------|
| Build overview | `docs/sphinx/build/overview.rst` |
| **Bazel** quickstart | `docs/sphinx/build/bazel/quickstart.rst` |
| Bazel dependencies | `docs/sphinx/build/bazel/dependencies.rst` |
| Bazel integration | `docs/sphinx/build/bazel/integration/` |
| GN build | `docs/sphinx/build/gn/index.rst` |
| CMake build | `docs/sphinx/build/cmake/index.rst` |

### Getting Started

| Topic | File |
|-------|------|
| First time setup | `docs/sphinx/get_started/first_time_setup.rst` |
| Zephyr integration | `docs/sphinx/get_started/zephyr.rst` |
| Static analysis | `docs/sphinx/get_started/analysis.rst` |
| GitHub Actions | `docs/sphinx/get_started/github_actions.rst` |

### OS Integration

| Topic | File |
|-------|------|
| Zephyr RTOS | `docs/sphinx/os/zephyr/index.rst` |
| Zephyr Kconfig | `docs/sphinx/os/zephyr/kconfig.rst` |

### Module Documentation

Individual module docs are at `pw_<module>/docs.rst`. Examples:
- `pw_async2/docs.rst` - Async framework
- `pw_result/docs.rst` - Error handling
- `pw_rpc/docs.rst` - RPC framework
- `pw_log/docs.rst` - Logging

### Showcases (Example Projects)

The "Sense" tutorial is a complete example project:
- `docs/sphinx/showcases/sense/index.rst` - Overview
- `docs/sphinx/showcases/sense/setup.rst` - Setup
- `docs/sphinx/showcases/sense/build.rst` - Building
- `docs/sphinx/showcases/sense/rpc.rst` - RPC usage
- `docs/sphinx/showcases/sense/host_tests.rst` - Testing

---

## Module Quick Reference

### pw_async2 - Cooperative Async Framework
**Purpose:** Enables concurrent programming through cooperative scheduling without threading overhead.

**Key APIs:**
- `Task` - Unit of work implementing `DoPend(Context&)` returning `Poll<>`
- `Dispatcher` - Coordinates task execution via `Post()` and `RunToCompletion()`
- `Future<T>` - Async result container
- Channels (SPSC/SPMC/MPSC/MPMC) - Inter-task communication

**When to use:** Non-blocking I/O, state machines, concurrent operations without threads.

**Common mistakes:**
- Blocking inside `DoPend()` (should always return quickly)
- Forgetting to wake the dispatcher when state changes
- Not handling `Pending` vs `Ready` states correctly

---

### pw_async2/channels - Inter-task Communication
**Purpose:** Fixed-capacity queues for passing data between async tasks.

**Key APIs:**
- `Send()` / `Receive()` - Return futures for async operations
- `TrySend()` / `TryReceive()` - Non-blocking immediate operations
- `BlockingSend()` / `BlockingReceive()` - With optional timeout

**When to use:** Passing events/data between Tasks or between async and sync code.

**Note:** This is the current replacement. The older `pw_channel` module is **DEPRECATED**.

---

### pw_result - Error Propagation
**Purpose:** Type-safe union of value or error status.

**Key APIs:**
- `pw::Result<T>` - Either value or `pw::Status`
- `.ok()` / `.status()` / `.value()` - Access result
- `.and_then()` / `.transform()` - Monadic chaining
- `PW_TRY_ASSIGN(var, expr)` - Extract or propagate error

**When to use:** Any function that can fail and return a value.

**Common mistakes:**
- Calling `.value()` without checking `.ok()` first
- Not using `PW_TRY` macros (verbose error handling)

---

### pw_status - Status Codes
**Purpose:** Exception-free error handling primitive.

**Key APIs:**
- `pw::Status` - 17 standard codes (OK, INVALID_ARGUMENT, NOT_FOUND, etc.)
- `pw::OkStatus()` - Success factory
- `PW_TRY(status_expr)` - Propagate on failure
- `.ok()` / `.IsNotFound()` / etc. - Status checks

**When to use:** All error-returning functions.

---

### pw_bytes - Binary Data Handling
**Purpose:** Type-safe byte manipulation utilities.

**Key APIs:**
- `pw::bytes::Array<0x01, 0x02>()` - Compile-time byte arrays
- `pw::bytes::Concat(...)` - Combine byte sequences
- `pw::bytes::CopyInOrder(endian, value)` - Endian-aware conversion
- `pw::ConstByteSpan` / `pw::ByteSpan` - Non-owning byte views

**When to use:** Protocol implementations, binary data handling.

---

### pw_stream - I/O Interfaces
**Purpose:** Foundational streaming interface for data transfer.

**Key APIs:**
- `Reader` / `Writer` - Basic single-direction streams
- `ReaderWriter` - Bidirectional streams
- `SeekableReader` / `SeekableWriter` - Position-aware streams

**When to use:** UART, flash, network, any data sink/source.

---

### pw_sync - Synchronization Primitives
**Purpose:** Thread and interrupt synchronization.

**Key APIs:**
- `Mutex` / `TimedMutex` - Mutual exclusion
- `InterruptSpinLock` - ISR-safe locking
- `ThreadNotification` - Single-consumer signaling
- `Borrowable<T>` - Container-style external locking

**When to use:** Shared data protection, thread coordination.

---

### pw_chrono - Time Handling
**Purpose:** Portable `std::chrono` for embedded systems.

**Key APIs:**
- `pw::chrono::SystemClock` - Primary clock facade
- Standard `std::chrono::duration` / `time_point`
- `SystemTimer` - One-shot deferred callbacks

**When to use:** Timeouts, delays, scheduling.

**Common mistakes:**
- Using `count()` to escape type system (lose safety)
- Using lossy conversions without explicit floor/ceil/round

---

### pw_log - Logging
**Purpose:** Embedded logging with tokenization support.

**Key APIs:**
- `PW_LOG_DEBUG/INFO/WARN/ERROR/CRITICAL(fmt, ...)`
- `PW_LOG_EVERY_N(level, rate, ...)` - Rate limiting
- `PW_LOG_MODULE_NAME` - Per-file module identifier

**When to use:** All diagnostic output.

---

### pw_assert - Assertions
**Purpose:** Crash triggering and condition checking.

**Key APIs:**
- `PW_CRASH(format, ...)` - Unconditional crash
- `PW_CHECK(condition)` - Assert with optional message
- `PW_CHECK_INT_LT(a, b)` - Binary comparison with value capture
- `PW_CHECK_OK(status)` - Status assertion
- `PW_ASSERT(condition)` - Header/constexpr-safe

**When to use:** Programmer error detection, precondition validation.

---

### pw_containers - Embedded Containers
**Purpose:** Fixed-capacity STL-like containers.

**Key APIs:**
- `pw::Vector<T, N>` - Fixed-capacity vector
- Intrusive linked lists
- Maps/Sets with predictable performance

**When to use:** Collections without dynamic allocation.

---

### pw_rpc - Remote Procedure Calls
**Purpose:** Embedded RPC with protobuf serialization.

**Key APIs:**
- Service classes generated from `.proto` files
- Nanopb or pw_protobuf serialization
- Client libraries for C++, Python, TypeScript

**When to use:** Device-host communication, remote control.

---

### pw_unit_test - Testing Framework
**Purpose:** GoogleTest-compatible embedded testing.

**Key APIs:**
- `TEST(Suite, Case)` - Test definition
- `EXPECT_*` / `ASSERT_*` - Assertions
- `PW_CONSTEXPR_TEST` - Compile-time testing

**When to use:** All unit testing.

---

## Pattern Catalog

### Error Propagation Pattern
```cpp
pw::Status DoSomething() {
  PW_TRY(Step1());
  PW_TRY(Step2());
  return pw::OkStatus();
}

pw::Result<int> GetValue() {
  PW_TRY_ASSIGN(auto x, ComputeX());
  PW_TRY_ASSIGN(auto y, ComputeY());
  return x + y;
}
```

### Async Task Pattern
```cpp
class MyTask : public pw::async2::Task {
  pw::async2::Poll<> DoPend(pw::async2::Context& cx) override {
    if (!future_) {
      future_.emplace(StartOperation());
    }
    auto poll = future_->Pend(cx);
    if (poll.IsPending()) return pw::async2::Pending();

    // Process result
    future_.reset();
    return pw::async2::Ready();
  }

  std::optional<SomeFuture> future_;
};
```

### Compile-time Byte Arrays
```cpp
constexpr auto kCommand = pw::bytes::Array<0x00, 0xA4, 0x04, 0x00>();
constexpr auto kPacket = pw::bytes::Concat(
    kHeader,
    pw::bytes::CopyInOrder(pw::endian::big, length));
```

---

## Anti-Pattern Catalog

### ❌ Escaping Type System
```cpp
// BAD: Loses type safety
auto ms = duration.count();
DoSomething(ms);

// GOOD: Keep in type system
DoSomething(duration);
```

### ❌ Blocking in Async Code
```cpp
// BAD: Blocks the dispatcher
Poll<> DoPend(Context&) {
  std::this_thread::sleep_for(100ms);  // NEVER DO THIS
}

// GOOD: Use timer future
Poll<> DoPend(Context& cx) {
  return timer_.PendFor(cx, 100ms);
}
```

### ❌ Ignoring Status
```cpp
// BAD: Ignoring errors
auto result = MayFail();
UseValue(*result);  // Crash if failed!

// GOOD: Check first
if (!result.ok()) return result.status();
UseValue(*result);
```

---

## Decision Flowcharts

### Choosing Error Handling
```
Need to return value + error? → pw::Result<T>
Just returning status? → pw::Status
Programmer error (should never happen)? → PW_CHECK / PW_ASSERT
```

### Choosing Synchronization
```
Protecting shared data?
├── Between threads only → pw::sync::Mutex
├── Including ISRs → pw::sync::InterruptSpinLock
└── Signaling another thread → pw::sync::ThreadNotification

Need to borrow guarded object? → pw::sync::Borrowable<T>
```

### Choosing Async Pattern
```
Single operation? → Return Future directly
Multiple sequential ops? → Task with state machine
Passing data between tasks? → pw_async2 Channel
```

---

## Cross-Cutting Concerns

### Threading Model
- Use `pw_sync` primitives (not raw `std::mutex`)
- Annotate with `PW_GUARDED_BY()` for static analysis
- Prefer `Borrowable<T>` for external locking patterns

### Error Handling
- Always use `PW_TRY` / `PW_TRY_ASSIGN` for propagation
- Use semantic status codes (NOT_FOUND, INVALID_ARGUMENT, etc.)
- Assertions for programmer errors, status for runtime errors

### Logging
- Define `PW_LOG_MODULE_NAME` per translation unit
- Use appropriate levels (DEBUG < INFO < WARN < ERROR < CRITICAL)
- Consider tokenization for production builds

### Testing
- Use `pw_unit_test` for host and device testing
- Mock hardware dependencies via facades
- Use `PW_CONSTEXPR_TEST` for compile-time validation
