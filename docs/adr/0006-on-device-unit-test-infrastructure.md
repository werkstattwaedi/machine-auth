# ADR-0006: On-Device Unit Test Infrastructure

**Status:** Accepted

**Date:** 2026-01-01

**Applies to:** `third_party/particle/` (Particle Pigweed backends)

## Context

Pigweed's `pw_unit_test` provides GoogleTest-compatible unit testing for embedded systems. However, running tests on actual Particle hardware requires:

1. Building firmware that includes test code and a test runner
2. Flashing to the device
3. Capturing serial output for test results

Pigweed's `pw_cc_test` macro can support on-device tests (see [Pigweed Sense device tests](https://pigweed.dev/showcases/sense/device_tests.html)), but requires a more Pigweed-native linker setup. Our current Particle linking process (two-pass linking with Device OS part1/part2) doesn't integrate cleanly with Pigweed's device test infrastructure.

## Decision

### Custom `particle_cc_test` Macro

Create `rules/particle_test.bzl` providing a `particle_cc_test` macro:

```python
particle_cc_test(
    name = "loopback_test",
    srcs = ["test/loopback_test.cc"],
    deps = [":initiator", "@pigweed//pw_bytes"],
)
```

Generates four targets:
- `{name}.lib` - Static library containing test code
- `{name}.elf` - Linked ELF with Device OS
- `{name}.bin` - Flashable binary
- `{name}_flash` - Flashes firmware and opens serial monitor

### Test Main Function

Tests link against `//pw_unit_test_particle:main` which provides:

```cpp
int main() {
  // Wait for USB serial connection
  while (!HAL_USB_USART_Is_Connected(kSerial)) {
    HAL_Delay_Milliseconds(100);
  }

  // Run tests with SimplePrintingEventHandler
  pw::unit_test::SimplePrintingEventHandler handler(WriteToSerial);
  pw::unit_test::RegisterEventHandler(&handler);
  int result = RUN_ALL_TESTS();

  // Idle forever so user can see results
  while (true) { HAL_Delay_Milliseconds(1000); }
}
```

**Key design choices:**

- Uses HAL APIs only (`HAL_Delay_Milliseconds`, `HAL_USB_USART_Is_Connected`) - Wiring API is unavailable in Bazel-based builds
- Provides `main()` function called by `pigweed_entry.cc`'s `setup()` - avoids multiple definition errors
- Loops forever after tests complete so results remain visible on serial monitor
- Uses `SimplePrintingEventHandler` for human-readable output via `pw_sys_io`

### Flash Script

`rules/flash_test.sh` handles the flash-and-monitor workflow:

1. Flash firmware via `particle flash --local`
2. Poll `particle serial list` until device reconnects (15-second timeout)
3. Open `particle serial monitor --follow` for test output

## Usage

From parent project with module override:

```bash
# Build test firmware
bazel build --config=p2 @particle_bazel//pw_spi_particle:loopback_test

# Flash and run with serial monitor
bazel run --config=p2 @particle_bazel//pw_spi_particle:loopback_test_flash
```

## Consequences

**Pros:**

- Reusable macro works in particle_bazel module and external repos
- Single command to flash and monitor test results
- GoogleTest-compatible assertions (`EXPECT_EQ`, `ASSERT_TRUE`, etc.)
- HAL-only implementation works with Bazel build system

**Cons:**

- Manual test execution (no CI integration without hardware-in-loop)
- Tests must be explicitly listed (no automatic test discovery)
- Serial monitor requires USB connection and Ctrl+C to exit

## Future Work

Migrate to Pigweed's native `pw_cc_test` for on-device tests. This would enable better integration with Pigweed's test infrastructure (automatic discovery, `bazel test` integration). Requires refactoring the linker setup to be more Pigweed-native and less reliant on Particle's two-pass linking approach.
