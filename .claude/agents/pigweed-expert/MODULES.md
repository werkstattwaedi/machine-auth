# Pigweed Module Catalog

*Purpose: Discover which modules might solve a given problem. Read full docs at `third_party/pigweed/pw_*/docs.rst` when a module seems relevant.*

*Total: 183 modules*

---

## Error Handling & Status

### pw_status
The foundation of Pigweed's error handling. Provides `pw::Status`, a lightweight error code type with 17 standard codes (OK, CANCELLED, UNKNOWN, INVALID_ARGUMENT, DEADLINE_EXCEEDED, NOT_FOUND, ALREADY_EXISTS, PERMISSION_DENIED, RESOURCE_EXHAUSTED, FAILED_PRECONDITION, ABORTED, OUT_OF_RANGE, UNIMPLEMENTED, INTERNAL, UNAVAILABLE, DATA_LOSS, UNAUTHENTICATED). Also provides the `PW_TRY(expr)` macro that returns early if the expression fails. Use this for any function that can fail but doesn't need to return a value.

### pw_result
Combines a value and an error status into a single type: `pw::Result<T>`. When a function succeeds, it returns the value; when it fails, it returns a status. This eliminates the need for separate out-parameters or sentinel values. The `PW_TRY_ASSIGN(var, expr)` macro extracts the value or propagates the error. Supports monadic operations like `and_then()` and `transform()` for chaining operations. Based on Abseil's `absl::StatusOr<T>`.

### pw_assert
Runtime assertion system for checking preconditions and invariants. `PW_CHECK(condition)` crashes with a message if the condition is false - these are always active. `PW_ASSERT(condition)` can be disabled in production builds. `PW_CHECK_INT_LT(a, b)` and similar macros capture both values when the assertion fails. `PW_CRASH("message")` unconditionally crashes. Requires a backend.

**Backends:** pw_assert_basic (simple printf), pw_assert_log (via logging), pw_assert_tokenized (space-efficient), pw_assert_trap (debugger-friendly), pw_assert_zephyr, pw_assert_fuchsia

---

## Data Types & Containers

### pw_span
Provides `pw::span<T>`, a non-owning view of contiguous memory. Equivalent to C++20's `std::span`. Use instead of passing raw `pointer + size` pairs - it's safer and more expressive. When `std::span` is available, `pw::span` is just an alias for it. Essential for any function that needs to operate on arrays or buffers without owning them.

### pw_string
Safe string handling without heap allocation. `pw::InlineString<N>` is a fixed-capacity string that works like `std::string` but with compile-time size limits. `pw::StringBuilder` enables safe `printf`-style formatting into a buffer with automatic truncation instead of overflow. Use these instead of raw `char*` buffers with `snprintf` to prevent buffer overflows and simplify code.

### pw_containers
Fixed-capacity containers that don't use dynamic allocation. `pw::Vector<T, N>` is like `std::vector` but with a compile-time maximum size. `pw::IntrusiveList` is a doubly-linked list where elements contain the list nodes (no separate allocation per element). `pw::FlatMap` provides key-value storage with O(n) lookup but minimal memory overhead. Also includes queues, deques, and other data structures optimized for embedded use.

### pw_bytes
Utilities for working with raw bytes and binary data. `pw::bytes::Array<0x01, 0x02>()` creates compile-time byte arrays. `pw::bytes::Concat()` combines multiple byte sequences. `pw::bytes::CopyInOrder(endian, value)` handles endian conversion. `pw::ConstByteSpan` and `pw::ByteSpan` are type aliases for spans of bytes. Essential for protocol implementations, binary file handling, and hardware communication.

### pw_function
Provides `pw::Function<Signature>`, a lightweight alternative to `std::function` that doesn't allocate memory by default. Can store function pointers, lambdas, or any callable. `pw::Callback<Signature>` is similar but can only be called once, then automatically clears itself. Use for callbacks, event handlers, or any situation where you need to store and invoke callable objects without heap allocation.

### pw_varint
Variable-length integer encoding where smaller values use fewer bytes. Commonly used in protocols like Protocol Buffers. Provides encoding/decoding functions for signed and unsigned integers. Use when you need compact serialization of integers that are typically small but occasionally large.

### pw_json
JSON parsing and generation for embedded systems. Provides a streaming parser that doesn't require loading the entire JSON document into memory. Use when you need to process JSON configuration files, API responses, or other JSON data on resource-constrained devices.

### pw_base64
Base64 encoding and decoding. Converts binary data to/from text-safe ASCII representation. Use when binary data needs to be embedded in text formats like JSON, URLs, or configuration files.

### pw_alignment
Memory alignment utilities. Helpers for ensuring data meets alignment requirements, which is important for DMA, hardware registers, or performance-critical code. Use when you need to guarantee specific memory alignment.

### pw_numeric
Numeric utilities including saturating arithmetic (operations that clamp to min/max instead of overflowing) and checked arithmetic (operations that detect overflow). Use when you need mathematically safe integer operations.

### pw_intrusive_ptr
Intrusive reference-counted smart pointer. Unlike `std::shared_ptr`, the reference count is stored in the object itself, avoiding separate allocations. Use for shared ownership patterns in memory-constrained environments.

### pw_format
Format string utilities for printf-style formatting. Provides compile-time format string validation and utilities. Used internally by other modules but can be useful for custom formatting needs.

### pw_polyfill
Polyfills for C++ standard library features that may not be available on all toolchains. Provides implementations of newer C++ features for older compilers. Typically used implicitly by other modules.

### pw_preprocessor
Preprocessor macro utilities. Helpers for common macro patterns like argument counting, concatenation, and stringification. Used internally by many modules and available for custom macro needs.

---

## Memory & Buffers

### pw_allocator
Allocator interface and multiple implementations for custom memory management. Includes block allocators (subdivide a memory region), bump allocators (fast but no individual free), and allocators with tracking/debugging features. Allows injecting allocation behavior for testing or constraining memory usage. Use when you need more control over memory allocation than the default heap provides.

### pw_malloc
Implementations of malloc/free for systems without a standard library or when custom heap behavior is needed. Provides the system-level memory allocation interface.

**Implementations:** pw_malloc_freelist (simple freelist-based), pw_malloc_freertos (wraps FreeRTOS heap)

### pw_stream
Abstract interface for streaming I/O. `Reader` reads data from a source, `Writer` writes data to a sink, `ReaderWriter` does both. `SeekableReader/Writer` add position control. Implementations exist for memory buffers, files, sockets, UARTs, etc. Use as the foundation for any I/O abstraction - it decouples your code from specific I/O mechanisms.

**Specialized streams:** pw_stream_uart_linux, pw_stream_uart_mcuxpresso, pw_stream_shmem_mcuxpresso

### pw_multibuf
Scatter-gather buffer management for zero-copy I/O. A `MultiBuf` represents a sequence of potentially discontiguous memory regions. Data can be written once and passed through multiple processing stages without copying. Use for network stacks, DMA operations, or any situation where data flows through multiple components and you want to minimize copies.

### pw_ring_buffer
Circular/ring buffer implementation. Data is appended to one end and consumed from the other, with automatic wraparound. Useful for producer-consumer scenarios, UART receive buffers, logging buffers, or any FIFO queue where the maximum size is bounded. Supports prefixed entries for message framing.

### pw_hex_dump
Formats binary data as human-readable hex dumps (like `hexdump` or `xxd`). Use for debug output when you need to inspect binary data visually.

---

## Async & Concurrency

### pw_async2
Pigweed's primary cooperative async framework. `Task` is the core abstraction - a unit of work that yields to the `Dispatcher` when waiting. `Coro` provides C++20 coroutine support for more natural async code. `Future<T>` represents a value that will be available later. Channels (SPSC/MPMC) enable communication between tasks. Use for concurrent programming without the overhead of preemptive threading - ideal for state machines, I/O multiplexing, and event-driven designs.

### pw_async
Older async primitives. **Prefer pw_async2 for new code.** May still be used by some existing code or specific backends.

**Backends:** pw_async_basic, pw_async_fuchsia

### pw_channel
Async channel abstraction. **DEPRECATED** - use pw_async2's built-in channels instead.

### pw_work_queue
Work queue for deferred task execution. Allows queuing work items (functions/callbacks) to be processed later by a worker thread. Use for offloading work from ISRs or high-priority contexts to background processing.

### pw_sync
Thread and interrupt synchronization primitives. `Mutex` and `TimedMutex` protect shared data between threads. `InterruptSpinLock` is safe to use from ISRs. `BinarySemaphore` and `CountingSemaphore` for signaling. `ThreadNotification` is optimized for single-consumer wakeup. `Borrowable<T>` provides container-style external locking. These are portable abstractions that work across RTOSes via backends.

**Backends:** pw_sync_baremetal (interrupt disable), pw_sync_stl (C++ stdlib), pw_sync_freertos, pw_sync_embos, pw_sync_threadx, pw_sync_zephyr

### pw_thread
Thread creation and management. Provides a portable thread abstraction that works across operating systems. `Thread` represents a thread of execution, `ThreadCore` defines the thread's entry point. `this_thread::sleep_for()` pauses execution. Use when you need true preemptive multithreading.

**Backends:** pw_thread_stl, pw_thread_freertos, pw_thread_embos, pw_thread_threadx, pw_thread_zephyr

### pw_interrupt
Interrupt handling abstractions. Provides a portable way to manage interrupt state (enable/disable) and potentially register handlers.

**Backends:** pw_interrupt_cortex_m, pw_interrupt_freertos, pw_interrupt_zephyr

### pw_atomic
Atomic operations for lock-free programming. Provides atomic types and operations similar to `std::atomic`. Use for lock-free data structures or when you need guaranteed atomic access to shared variables.

### pw_chrono
Time handling based on C++'s `<chrono>` but designed for embedded. `SystemClock` provides the primary time source with `now()`, `duration`, and `time_point` types. `SystemTimer` triggers callbacks after a delay. Enables type-safe time calculations that prevent unit confusion (milliseconds vs microseconds). Use for any timeout, delay, or time-measurement needs.

**Backends:** pw_chrono_stl, pw_chrono_freertos, pw_chrono_embos, pw_chrono_threadx, pw_chrono_zephyr, pw_chrono_rp2040

---

## Communication & Protocols

### pw_rpc
Remote Procedure Call framework optimized for embedded. Define services in `.proto` files, generate C++ server and client code, implement handlers. Supports unary RPCs (request-response), server streaming (one request, multiple responses), client streaming (multiple requests, one response), and bidirectional streaming. Works with nanopb or pw_protobuf for serialization. Client libraries available for C++, Python, TypeScript. Use for device-host communication, inter-processor communication, or any request-response protocol.

### pw_rpc_transport
Transport abstractions for pw_rpc. Defines interfaces for sending/receiving RPC packets over different channels. Use when implementing custom RPC transports.

### pw_hdlc
HDLC (High-Level Data Link Control) framing for serial communication. Adds start/end frame delimiters (0x7E), byte stuffing/escaping, and CRC-32 integrity checking to raw byte streams. Enables reliable packet-based communication over UART or other byte-oriented transports. Often paired with pw_rpc for reliable RPC over serial. Use when you need framed packets over a raw byte stream.

### pw_transfer
Reliable data transfer protocol built on pw_rpc. Handles chunking large data into smaller pieces, retransmission of lost chunks, flow control, and progress tracking. Supports both client-initiated and server-initiated transfers. Use for transferring files, firmware images, logs, or any large data between devices. More robust than simple streaming when transfers may be interrupted.

### pw_router
Transport-agnostic packet routing. Routes packets to different destinations based on header information. `PacketParser` interface extracts routing info from packets, `Egress` interface sends packets out. Use when you have multiple communication endpoints (e.g., UART + Bluetooth + USB) and need to route messages between them based on addressing.

### pw_protobuf
Pigweed's Protocol Buffer implementation. Provides streaming encode/decode that processes data incrementally without requiring the entire message in memory. Can be more size-efficient than nanopb for some use cases. Generates C++ code from .proto files. Integrates with pw_rpc.

### pw_protobuf_compiler
Build system integration for compiling .proto files. Generates C++ code from Protocol Buffer definitions. Used at build time, not runtime.

### pw_flatbuffers
FlatBuffers integration. FlatBuffers is an alternative to Protocol Buffers with zero-copy deserialization. Use when you need the specific advantages of FlatBuffers (faster access, no unpacking step).

### pw_grpc
gRPC integration. Allows Pigweed RPC services to interoperate with standard gRPC. Use when you need compatibility with existing gRPC infrastructure.

---

## Hardware Abstraction

### pw_i2c
I2C (Inter-Integrated Circuit) bus interface. `Initiator` represents the I2C controller and provides methods like `WriteReadFor()` to perform transactions with devices. Device drivers accept an `Initiator&` and can be tested with mock/fake implementations. Handles addressing, repeated starts, and error conditions portably.

**Backends:** pw_i2c_linux, pw_i2c_mcuxpresso, pw_i2c_rp2040, pw_i2c_zephyr

### pw_spi
SPI (Serial Peripheral Interface) bus interface. `Initiator` handles chip select management and bidirectional data transfer. Supports configuration of clock polarity (CPOL), phase (CPHA), bit order, and speed. Device drivers can be written against the abstract interface.

**Backends:** pw_spi_linux, pw_spi_mcuxpresso, pw_spi_rp2040

### pw_uart
UART (Universal Asynchronous Receiver-Transmitter) interface. Provides abstract read/write operations for serial ports with configurable baud rate, parity, and flow control. Can integrate with pw_stream for stream-based I/O.

**Backends:** pw_uart_mcuxpresso

### pw_digital_io
GPIO (General Purpose I/O) interface. `DigitalIn` reads pin state (high/low), `DigitalOut` sets pin state, `DigitalInOut` does both, `DigitalInterrupt` handles edge-triggered interrupts. Abstracts away platform-specific GPIO registers and configurations.

**Backends:** pw_digital_io_linux, pw_digital_io_mcuxpresso, pw_digital_io_rp2040, pw_digital_io_zephyr

### pw_analog
Analog input interface for ADC (Analog-to-Digital Converter) readings. Provides a portable way to read analog voltage values from sensors or other analog sources. Abstracts ADC channel selection, resolution, and reference voltage handling.

### pw_display
Display driver interface for screens and LCDs. Provides abstractions for framebuffers, pixel formats, and drawing operations. Use when integrating graphical displays - allows display-agnostic application code.

### pw_clock_tree
Clock configuration abstractions. Represents the system's clock tree (oscillators, PLLs, dividers) and allows portable clock configuration. Use for managing system clocks, especially during initialization or power mode transitions.

**Platform-specific:** pw_clock_tree_mcuxpresso

### pw_dma_mcuxpresso
DMA (Direct Memory Access) support for NXP MCUXpresso platforms. Allows configuring and using DMA for efficient data transfers without CPU involvement. Platform-specific module.

### pw_sys_io
Low-level character I/O interface. Provides basic `ReadByte()` and `WriteByte()` operations, typically used for early boot debug output before full logging is available. Also used as the foundation for simple debug consoles.

**Backends:** pw_sys_io_stdio (host), pw_sys_io_arduino, pw_sys_io_mcuxpresso, pw_sys_io_rp2040, pw_sys_io_stm32cube, pw_sys_io_zephyr, pw_sys_io_ambiq_sdk, pw_sys_io_baremetal_lm3s6965evb, pw_sys_io_baremetal_stm32f429, pw_sys_io_emcraft_sf2

### pw_boot
Boot sequence framework. Defines the startup flow from reset vector to main(). Handles early initialization like stack setup, static constructors, and memory initialization. Platform-specific backends provide the actual implementation.

**Backends:** pw_boot_cortex_m

### pw_cpu_exception
CPU exception/fault handling framework. Captures CPU state (registers, stack) when hardware exceptions occur (hard faults, memory faults, bus faults). Enables crash analysis and debugging. Platform-specific backends handle architecture details.

**Backends:** pw_cpu_exception_cortex_m, pw_cpu_exception_risc_v

---

## Logging & Debugging

### pw_log
Logging facade with severity levels: DEBUG, INFO, WARN, ERROR, CRITICAL. `PW_LOG_INFO("format", args)` logs a message. `PW_LOG_MODULE_NAME` macro sets the source module identifier. The actual logging implementation comes from a backend - this facade allows swapping backends without changing application code. Use for all diagnostic output.

**Backends:** pw_log_basic (simple printf), pw_log_string (string-based), pw_log_tokenized (compact, for production), pw_log_rpc (stream to host), pw_log_null (discard all), pw_log_android, pw_log_fuchsia, pw_log_zephyr

### pw_tokenizer
Compile-time string tokenization. Replaces format strings like `"Temperature: %d degrees"` with 4-byte tokens, dramatically reducing binary size. Arguments are encoded efficiently alongside tokens. Host-side tooling detokenizes logs for human reading. Works with pw_log_tokenized for production logging that's both comprehensive and tiny. Can also tokenize arbitrary strings beyond logging.

### pw_multisink
Multi-consumer log sink. Allows multiple readers to consume the same log stream independently, each maintaining their own read position. Useful when logs need to go to multiple destinations (console, storage, network) simultaneously.

### pw_trace
Tracing facade for performance profiling and event tracking. Records timestamped events with minimal overhead. Events can be visualized as execution traces to understand timing and control flow. Less overhead than logging, designed for high-frequency instrumentation.

**Backends:** pw_trace_tokenized

### pw_metric
Lightweight instrumentation for tracking counters and gauges. Metrics have tokenized names (minimal size impact) and can be organized hierarchically. Counters can be safely incremented from ISRs. Metrics can be queried via RPC for monitoring. Use for tracking health statistics like error counts, buffer fill levels, operation frequencies, or any numeric measurements.

### pw_snapshot
Captures device state at a point in time for later analysis. Designed for crash dumps but usable for any state capture. Stores CPU registers, stack traces, memory regions, thread info, and application-specific data in a protobuf format. Can be stored in flash and retrieved later. Use for post-crash debugging and field failure analysis.

### pw_perf_test
Performance testing framework. Measures execution time of code under test with statistical analysis. Use for benchmarking and detecting performance regressions.

### pw_unit_test
GoogleTest-compatible unit testing framework that runs on both host and embedded targets. `TEST(Suite, Name)` defines tests, `EXPECT_*` (non-fatal) and `ASSERT_*` (fatal) check conditions. The same tests can run on your development machine and on actual hardware. Essential for any testing strategy.

### pw_fuzzer
Fuzz testing support. Integrates with fuzzing engines to automatically generate test inputs that explore code paths and find bugs. Use for security-sensitive code or complex parsers.

### pw_compilation_testing
Compile-time testing utilities. Allows writing tests that verify code fails to compile in expected ways (e.g., testing that a `static_assert` fires). Use for testing compile-time constraints and error messages.

---

## Storage

### pw_kvs
Flash-backed key-value store with integrated wear leveling. Stores key-value pairs persistently, automatically spreading writes across flash sectors to extend flash lifetime. Supports redundant storage for corruption resilience - can store multiple copies and detect/recover from bit errors. Log-structured design handles power loss gracefully. Use for configuration storage, calibration data, counters, or any small-to-medium persistent data on NOR flash.

### pw_blob_store
Stores a single binary blob persistently with integrity checking. Simpler than pw_kvs when you just need to store one contiguous piece of data (like a firmware image, certificate, or log file). Provides `BlobReader` and `BlobWriter` interfaces for streaming access. Includes checksum verification. Use for large single-file storage needs.

### pw_persistent_ram
Utilities for using RAM that survives reboots (not cleared by bootloader or startup code). Enables storing data like crash info, boot counts, or state that persists across warm resets without flash wear. Includes integrity checking because RAM may have bit errors after power glitches. Use when you need fast persistent storage, accepting data loss on full power loss.

### pw_file
Abstract file interface. Provides a common API for file-like operations (open, read, write, seek, close) that can be backed by different storage mechanisms (filesystem, flash, memory). Use when your code needs file semantics but you want to abstract the actual storage.

---

## Cryptography & Security

### pw_checksum
CRC and checksum algorithms. Includes CRC16-CCITT, CRC32, and Fletcher checksums. Optimized implementations with both one-shot and incremental APIs. Use for data integrity verification in protocols, storage, or communication.

### pw_crypto
Cryptographic primitives. Includes hashing (SHA-256) and potentially other algorithms. Check current status as this module may still be developing. Use for secure hashing, authentication, or encryption needs.

### pw_random
Random number generation interface. `RandomGenerator` provides `Get()` to fill a buffer with random bytes. Quality depends on the backend - can be cryptographically secure or just pseudorandom. Use for cryptographic keys, nonces, or any randomization.

**Backends:** pw_random_fuchsia

### pw_tls_client
TLS (Transport Layer Security) client interface for encrypted network connections. Provides handshake, encryption, and certificate verification. Abstracts the underlying TLS library.

**Backends:** pw_tls_client_boringssl, pw_tls_client_mbedtls

### pw_uuid
UUID (Universally Unique Identifier) generation and parsing. Supports standard UUID formats. Use when you need unique identifiers for devices, sessions, or resources.

---

## Bluetooth

### pw_bluetooth
Bluetooth abstractions and common types. Provides foundational types and interfaces for Bluetooth development. Check current status for specific features.

### pw_bluetooth_hci
HCI (Host Controller Interface) packet handling. Parses and constructs the low-level packets exchanged between Bluetooth host and controller per the Bluetooth specification. Use when implementing Bluetooth stacks or working directly with HCI.

### pw_bluetooth_profiles
Standard Bluetooth profile implementations. Provides implementations of common Bluetooth profiles. Check current status for supported profiles.

### pw_bluetooth_proxy
Bluetooth packet proxying. Allows intercepting and forwarding Bluetooth traffic. Use for debugging, testing, or implementing Bluetooth bridges.

### pw_bluetooth_sapphire
Fuchsia's Bluetooth stack integration. Connects Pigweed Bluetooth abstractions to the Sapphire stack. Fuchsia-specific.

---

## System Integration

### pw_system
An opinionated, batteries-included embedded system framework. Combines pw_rpc, pw_log (with tokenization), pw_thread, pw_sync, pw_hdlc, and other modules into a working system out of the box. Includes a device target that can communicate with pw_console on a host. Significantly reduces the configuration needed to get a new project running with Pigweed's features. Use as a starting point for new Pigweed-based projects.

### pw_software_update
Secure over-the-air (OTA) update framework based on TUF (The Update Framework). Defines a bundle format containing firmware images and metadata. Handles signing, verification (protecting against rollback, arbitrary software installation, and key compromise), and staged installation. Provides both tooling for creating/signing bundles and an embedded client for receiving updates. Use when you need secure firmware updates.

### pw_console
Interactive Python console for host-side device interaction. Connects to a device running pw_rpc and provides a REPL for invoking RPCs, viewing logs in real-time, and debugging. Plugin system allows adding custom functionality. Use during development for interactive debugging and testing.

### pw_web
Web-based tools and interfaces. Provides browser-based equivalents of pw_console functionality. Use when you need web-accessible device interaction.

---

## Build & Tooling

### pw_build
Core build system integration. Provides rules and macros for Bazel, GN, and CMake builds of Pigweed-based projects. Handles binary generation, test registration, and configuration. You'll use this implicitly in any Pigweed project.

**Platform extensions:** pw_build_android, pw_build_mcuxpresso

### pw_build_info
Build metadata embedding. Includes build timestamps, git commit hashes, or other build information in the binary. Useful for identifying firmware versions in the field.

### pw_toolchain
Toolchain configuration for cross-compilation. Sets up compilers, linkers, and flags for various target architectures. Defines toolchain features and behaviors.

**Platform-specific:** pw_android_toolchain, pw_stm32cube_build, pw_arduino_build

### pw_presubmit
Presubmit and CI check framework. Runs formatters (clang-format, black), linters (pylint, mypy), builds, and tests as checks before code submission. Highly configurable. Use to maintain code quality and catch issues early.

### pw_watch
File watcher for automatic rebuilds. Monitors source files and triggers builds when changes are detected. Speeds up the development cycle by eliminating manual rebuild steps.

### pw_ide
IDE integration utilities. Generates `compile_commands.json` for clangd and other files IDEs need for code intelligence (completion, navigation, diagnostics). Supports VS Code, CLion, and other LSP-compatible editors.

### pw_env_setup
Development environment setup. Scripts and utilities for installing dependencies, configuring paths, and setting up a consistent development environment across machines.

**Platform-specific:** pw_env_setup_zephyr

### pw_emu
Emulator support for hardware-less testing. Integrates with QEMU and other emulators to run firmware in simulation. Allows testing embedded code without physical hardware, useful for CI/CD.

### pw_bloat
Binary size analysis. Compares sizes between builds, identifies what's contributing to size, generates size reports. Helps track and optimize firmware size over time.

### pw_docgen
Documentation generation. Processes RST documentation and generates HTML output. Used for Pigweed's own docs and can be used for project documentation.

### pw_doctor
Environment diagnostics. Checks that the development environment is correctly configured (compilers, Python packages, etc.) and reports issues. Run when builds fail mysteriously.

### pw_target_runner
Test execution on remote targets. Runs tests on physical hardware or emulators, collecting results. Used by the build system for on-device testing.

### pw_cli
Pigweed command-line interface framework. Provides the `pw` command and plugin system for adding custom commands. Foundation for Pigweed's developer tools.

### pw_cli_analytics
CLI usage analytics. Optional telemetry for understanding how Pigweed tools are used. Can be disabled.

### pw_package
External package management. Downloads and manages third-party dependencies. Used during environment setup to fetch required packages.

### pw_module
Module template and utilities. Helps create new Pigweed modules with the correct structure. Use when adding new modules to Pigweed itself or creating Pigweed-style modules in your project.

### pw_config_loader
Configuration file loading. Parses configuration files (YAML, JSON) into structured data. Use for loading build or runtime configuration.

---

## Specialized

### pw_sensor
Sensor abstraction layer. Provides a common interface for different sensor types with standardized measurement units and sampling patterns. Check current status for supported sensor categories.

### pw_chre
CHRE (Context Hub Runtime Environment) integration. CHRE is Android's framework for always-on sensor processing. This module bridges Pigweed and CHRE. Android-specific.

### pw_kernel
Experimental Pigweed kernel/RTOS. A lightweight real-time operating system built on Pigweed primitives. Very early stage - use established RTOSes (FreeRTOS, Zephyr) for production systems.

### pw_rust
Rust language integration. Provides interoperability between Pigweed's C++ modules and Rust code. Use when mixing Rust and C++ in a Pigweed project.

### pw_libc
C library utilities and wrappers. Provides implementations or wrappers for standard C library functions, useful when the platform's libc is limited or absent.

### pw_libcxx
C++ standard library configuration. Manages libc++ settings and provides utilities for using the C++ standard library in embedded contexts.

### pw_elf
ELF (Executable and Linkable Format) file parsing. Reads ELF binaries to extract symbols, sections, and other metadata. Used by analysis tools like pw_bloat and pw_symbolizer.

### pw_symbolizer
Symbol resolution for stack traces. Converts addresses to function names and source locations using debug info. Essential for making crash dumps and traces human-readable.

### pw_change
Change detection utilities. Helps detect when values or states have changed, useful for implementing reactive patterns or dirty-checking.

---

*When a module looks relevant, read its full documentation at `third_party/pigweed/pw_<module>/docs.rst` for complete API details and examples.*
