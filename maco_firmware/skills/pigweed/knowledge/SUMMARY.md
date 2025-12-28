# Pigweed Knowledge Summary

*Last updated: 2025-12-28*

## Executive Summary

Pigweed is Google's collection of embedded-targeted libraries designed for resource-constrained environments. The framework prioritizes **zero dynamic allocation**, **exception-free error handling**, and **compile-time safety** while maintaining familiar C++ APIs. Unlike traditional embedded libraries, Pigweed modules are designed to work together through well-defined interfaces (facades) that allow backend substitution at build time.

The core philosophy centers on three principles: (1) provide STL-like APIs that feel natural to C++ developers, (2) eliminate hidden costs like dynamic memory allocation or exceptions, and (3) enable portable code through facade patterns that separate interface from implementation. This allows the same application code to run on FreeRTOS, Zephyr, bare-metal, or host systems by swapping backends at build time.

Pigweed emphasizes **informed poll** for async operations (cooperative scheduling without preemption overhead), **tokenization** for logging efficiency (50%+ size reduction), and **type-safe APIs** using modern C++ features like `std::byte`, `std::span`, and `std::chrono`.

---

## Module Quick Reference

### Error Handling

#### pw_status
- **Purpose**: Exception-free error propagation using status codes
- **Key APIs**: `pw::Status`, `pw::OkStatus()`, `PW_TRY()` macro
- **When to use**: Any function that can fail; prefer over exceptions or error codes
- **Common mistakes**: Using raw integers instead of Status; forgetting to check return values

#### pw_result
- **Purpose**: Union type combining success value OR error status
- **Key APIs**: `pw::Result<T>`, `ok()`, `value()`, `and_then()`, `transform()`
- **When to use**: Functions returning a value that may fail
- **Common mistakes**: Accessing `value()` without checking `ok()` first

### Strings & Containers

#### pw_string
- **Purpose**: Safe string handling without dynamic allocation
- **Key APIs**: `pw::InlineString<N>`, `pw::StringBuilder`
- **When to use**: Any string manipulation in embedded code
- **Common mistakes**: Using `std::string` (allocates); exceeding fixed capacity silently

#### pw_containers
- **Purpose**: STL-like containers without dynamic allocation
- **Key APIs**: `pw::Vector<T, N>`, intrusive lists, flat maps
- **When to use**: Collections with known maximum size
- **Common mistakes**: Using `std::vector` (allocates); ignoring capacity limits

#### pw_span
- **Purpose**: C++20 `std::span` polyfill for C++17
- **Key APIs**: `pw::span<T>`, `pw::span<std::byte>`
- **When to use**: Passing array views without copying; **pass by value, not reference**
- **Common mistakes**: Passing span by reference (unnecessary indirection)

### Logging

#### pw_log
- **Purpose**: Printf-style logging with level filtering
- **Key APIs**: `PW_LOG_INFO()`, `PW_LOG_ERROR()`, `PW_LOG_DEBUG()`
- **When to use**: All runtime logging; always prefer over printf
- **Common mistakes**: Using C++ streams (defeats tokenization); forgetting `PW_LOG_MODULE_NAME`

#### pw_tokenizer
- **Purpose**: Replace strings with binary tokens for 50%+ size reduction
- **Key APIs**: `PW_TOKENIZE_STRING()`, token database generation
- **When to use**: Production logging to minimize flash/bandwidth
- **Common mistakes**: Using non-literal format strings; forgetting to generate token database

### Async & Concurrency

#### pw_async2
- **Purpose**: Cooperative async framework without preemptive threading
- **Key APIs**: `Task`, `Dispatcher`, `DoPend()`, `PW_TRY_READY_ASSIGN()`
- **When to use**: Complex async workflows; I/O-bound operations
- **Common mistakes**: Blocking in tasks; not yielding when blocked

#### pw_thread
- **Purpose**: Portable threading abstraction
- **Key APIs**: `pw::Thread`, `pw::this_thread::sleep_for()`, `pw::this_thread::yield()`
- **When to use**: When preemptive multithreading is required
- **Common mistakes**: Not calling `join()` or `detach()`; using `std::thread` directly

#### pw_sync
- **Purpose**: Synchronization primitives with backend flexibility
- **Key APIs**: `pw::sync::Mutex`, `pw::sync::TimedMutex`, `pw::sync::InterruptSpinLock`
- **When to use**: Protecting shared state; ISR-safe locking
- **Common mistakes**: Using `std::mutex` (not portable); forgetting priority inheritance

### Time

#### pw_chrono
- **Purpose**: STL-compatible time handling for embedded
- **Key APIs**: `pw::chrono::SystemClock`, durations, time_points
- **When to use**: All time-related operations; timeouts, delays
- **Common mistakes**: Using raw milliseconds; calling `count()` prematurely

### Communication

#### pw_rpc
- **Purpose**: Lightweight RPC for embedded devices
- **Key APIs**: Service registration, generated stubs, `pw::rpc::Server`
- **When to use**: Device-to-host or device-to-device communication
- **Common mistakes**: Not registering services; blocking in RPC handlers

#### pw_hdlc
- **Purpose**: Frame-based serial communication with CRC
- **Key APIs**: `WriteUIFrame()`, `Decoder`
- **When to use**: Reliable serial communication; RPC transport
- **Common mistakes**: Insufficient decode buffer; ignoring frame errors

#### pw_stream
- **Purpose**: Polymorphic streaming interfaces
- **Key APIs**: `Reader`, `Writer`, `SeekableWriter`
- **When to use**: Abstracting data sources/sinks
- **Common mistakes**: Creating unnecessary copies; not using span-based APIs

#### pw_protobuf
- **Purpose**: Minimal-footprint protobuf encoding/decoding
- **Key APIs**: `StreamEncoder`, `MemoryEncoder`, `StreamDecoder`
- **When to use**: Structured data serialization
- **Common mistakes**: Not checking status returns; insufficient buffer sizing

### Storage

#### pw_kvs
- **Purpose**: Flash-backed key-value store with wear leveling
- **Key APIs**: `KeyValueStore`, `Get()`, `Put()`, `Delete()`
- **When to use**: Persistent configuration; non-volatile storage
- **Common mistakes**: Ignoring write failures; not handling corruption

### Hardware Abstraction

#### pw_digital_io
- **Purpose**: GPIO abstraction with active/inactive semantics
- **Key APIs**: `DigitalIn`, `DigitalOut`, `DigitalInOut`
- **When to use**: Platform-portable GPIO access
- **Common mistakes**: Assuming high/low instead of active/inactive; querying state in ISR

### Testing & Debugging

#### pw_unit_test
- **Purpose**: GoogleTest-compatible embedded testing
- **Key APIs**: `TEST()`, `EXPECT_EQ()`, `ASSERT_TRUE()`
- **When to use**: All unit tests
- **Common mistakes**: Using matchers with light backend; assuming GoogleMock availability

#### pw_assert
- **Purpose**: Runtime assertions with value capture
- **Key APIs**: `PW_CHECK()`, `PW_DCHECK()`, `PW_CRASH()`
- **When to use**: Invariant checking; defensive programming
- **Common mistakes**: Using `assert()` (no value capture); missing type suffix on comparisons

### Utilities

#### pw_bytes
- **Purpose**: Compile-time byte array construction
- **Key APIs**: `pw::bytes::Array`, `pw::bytes::Concat`, endian utilities
- **When to use**: Building binary protocols; endianness handling
- **Common mistakes**: Runtime byte manipulation when compile-time is possible

#### pw_checksum
- **Purpose**: CRC algorithms (CRC16-CCITT, CRC32)
- **Key APIs**: `Crc16Ccitt::Calculate()`, `Crc32::Calculate()`
- **When to use**: Data integrity verification
- **Common mistakes**: Wrong polynomial selection; forgetting initial value

---

## Pattern Catalog

### 1. Error Propagation with PW_TRY

```cpp
pw::Status DoWork() {
  PW_TRY(Initialize());
  PW_TRY(Process());
  return pw::OkStatus();
}
```

### 2. Result Chaining

```cpp
pw::Result<int> GetValue() {
  return ReadSensor()
      .and_then([](int raw) { return Calibrate(raw); })
      .transform([](int cal) { return cal * 2; });
}
```

### 3. Fixed-Size String Building

```cpp
pw::InlineString<64> message;
pw::StringBuilder sb(message);
sb << "Sensor " << id << ": " << value << " mV";
```

### 4. Span-Based APIs

```cpp
// Good: Accept span by value
void Process(pw::span<const std::byte> data);

// Bad: Unnecessary indirection
void Process(const pw::span<const std::byte>& data);
```

### 5. Mutex with Thread Safety Annotations

```cpp
class Counter {
 public:
  void Increment() PW_LOCKS_EXCLUDED(mutex_) {
    std::lock_guard lock(mutex_);
    ++count_;
  }
 private:
  pw::sync::Mutex mutex_;
  int count_ PW_GUARDED_BY(mutex_) = 0;
};
```

### 6. Async Task Pattern

```cpp
class MyTask : public pw::async2::Task {
  pw::async2::Poll<> DoPend(pw::async2::Context& cx) override {
    PW_TRY_READY_ASSIGN(auto data, reader_.PendRead(cx));
    Process(data);
    return pw::async2::Ready();
  }
};
```

---

## Anti-Pattern Catalog

### 1. Dynamic Allocation

```cpp
// Bad: Uses heap
std::string name = "device";
std::vector<int> values;

// Good: Stack-allocated
pw::InlineString<32> name("device");
pw::Vector<int, 16> values;
```

### 2. Raw Time Values

```cpp
// Bad: Unclear units, easy to misuse
void Sleep(int ms);
Sleep(1000);

// Good: Type-safe duration
void Sleep(pw::chrono::SystemClock::duration delay);
Sleep(std::chrono::seconds(1));
```

### 3. C++ Streams for Logging

```cpp
// Bad: Defeats tokenization
PW_LOG_INFO("Value: " << value);  // Won't compile or work

// Good: Printf-style
PW_LOG_INFO("Value: %d", value);
```

### 4. Unchecked Status

```cpp
// Bad: Ignoring errors
WriteData(buffer);

// Good: Explicit handling
PW_TRY(WriteData(buffer));
// or
if (auto status = WriteData(buffer); !status.ok()) {
  HandleError(status);
}
```

### 5. std::mutex in Embedded Code

```cpp
// Bad: Not portable, no priority inheritance
std::mutex mutex;

// Good: Pigweed abstraction with backend flexibility
pw::sync::Mutex mutex;
```

---

## Decision Flowcharts

### When to Use Which Error Type

```
Need to return a value on success?
├─ Yes → pw::Result<T>
└─ No → pw::Status

Need custom error type (not Status)?
├─ Yes → pw::expected<T, E>
└─ No → pw::Result<T> or pw::Status
```

### When to Use Which String Type

```
Fixed maximum size known?
├─ Yes → pw::InlineString<N>
└─ No → External buffer + pw::StringBuilder

Building string incrementally?
├─ Yes → pw::StringBuilder
└─ No → pw::InlineString<N>
```

### When to Use Which Sync Primitive

```
Need to protect against ISRs?
├─ Yes → pw::sync::InterruptSpinLock
└─ No ↓

Need timeout support?
├─ Yes → pw::sync::TimedMutex
└─ No → pw::sync::Mutex

Need recursive locking?
├─ Yes → pw::sync::RecursiveMutex (avoid if possible)
└─ No → pw::sync::Mutex
```

---

## Cross-Cutting Concerns

### Threading Best Practices
- Use `pw::sync::Mutex` with RAII (`std::lock_guard`)
- Enable thread safety annotations (`-Wthread-safety`)
- Prefer cooperative async (`pw_async2`) over threads when possible
- Always specify thread options via facade pattern for portability

### Error Handling Strategy
- Functions return `pw::Status` or `pw::Result<T>`
- Use `PW_TRY()` for early-return propagation
- Check `ok()` before accessing `value()`
- Reserve `PW_CHECK()` for invariants, not error handling

### Logging Guidelines
- Use `PW_LOG_*` macros exclusively
- Define `PW_LOG_MODULE_NAME` per file
- Enable tokenization for production builds
- Printf-style only (no streams)

### Memory Management
- No `new`/`delete` in embedded code
- Use `pw::InlineString`, `pw::Vector` with fixed capacity
- Pass `pw::span` by value for array views
- Prefer stack allocation; use static for long-lived objects

### Portability
- Use Pigweed abstractions over STL when backend flexibility needed
- Configure backends via Bazel/GN flags, not code
- Test on host with STL backend before deploying to target
