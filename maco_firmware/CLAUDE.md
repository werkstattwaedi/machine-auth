# MACO Firmware - AI Context

This is the new Pigweed-based firmware. For the legacy Particle firmware, see `firmware/CLAUDE.md`.

## Planning and Review

Use these skills when working on maco_firmware:

- **`/pw-plan`** - Plan feature implementations using idiomatic Pigweed patterns
- **`/pw-review`** - Review code for Pigweed best practices and anti-patterns
- **`/docs-review`** - Check code consistency with documented architecture decisions

## Building and Flashing

### For Claude (AI assistant)

**Always use `./pw` to avoid changing the user's IDE state:**

```bash
./pw build host    # Build simulator
./pw build p2      # Build P2 firmware
./pw flash         # Flash to device
./pw build asan    # Address Sanitizer
./pw build tsan    # Thread Sanitizer
./pw build ubsan   # Undefined Behavior Sanitizer
```

### For human developers

**Use `bazel` directly when you want IDE to update:**

```bash
bazel build //maco_firmware/apps/dev:simulator  # Updates IDE to host
bazel build //maco_firmware/apps/dev            # Updates IDE to P2
bazel run //maco_firmware/apps/dev:simulator    # Build + run simulator
```

**Use `./pw` when you don't want IDE changes:**

```bash
./pw flash         # Flash without IDE change
./pw build asan    # Sanitizer without IDE change
```

See [ADR-0009](../docs/adr/0009-local-build-flash-tooling.md) for tooling architecture.

## Architecture

### Directory Structure

```
maco_firmware/
├── apps/                # Application binaries
│   └── dev/             # Development app (firmware + simulator targets)
├── devices/             # Device-specific drivers (display, touch, etc.)
│   └── pico_res28_lcd/  # ST7789 display driver
├── modules/             # Platform-agnostic abstractions
│   └── display/         # Display driver interface + Display manager
├── system/              # System-wide interfaces
│   └── system.h         # Platform HAL (GetDisplayDriver, GetTouchButtonDriver)
└── targets/             # Platform glue code (wiring hardware to drivers)
    ├── host/            # Host simulator (SDL)
    └── p2/              # Particle P2 target
```

### Hardware Abstraction

**Constructor Dependency Injection** - Hardware dependencies injected via constructor:

```cpp
class PicoRes28LcdDriver : public DisplayDriver {
 public:
  static constexpr uint16_t kWidth = 240;
  static constexpr uint16_t kHeight = 320;

  PicoRes28LcdDriver(
      pw::spi::Initiator& spi,
      pw::digital_io::DigitalOut& cs,
      pw::digital_io::DigitalOut& dc,
      pw::digital_io::DigitalOut& rst,
      pw::digital_io::DigitalOut& bl);

  pw::Status Init() override;
  uint16_t width() const override { return kWidth; }
  uint16_t height() const override { return kHeight; }
};
```

**Hardware dimensions are compile-time constants**, not runtime parameters. The driver knows its own size.

**Platform wiring in `targets/{platform}/system.cc`:**

```cpp
maco::display::DisplayDriver& GetDisplayDriver() {
  static pb::ParticleDigitalOut cs_pin(D5);
  static pb::ParticleDigitalOut dc_pin(D10);
  // ... create hardware instances ...
  static PicoRes28LcdDriver driver(spi, cs, dc, rst, bl);
  return driver;
}
```

## Pigweed Patterns

### pw_bytes for Byte Data

Use `pw::bytes` utilities instead of raw arrays:

```cpp
#include "pw_bytes/array.h"
#include "pw_bytes/endian.h"

// Compile-time constants
constexpr auto kCmdColumnAddressSet = pw::bytes::Array<0x2A>();
constexpr auto kCmdMemoryWrite = pw::bytes::Array<0x2C>();

// Big-endian data with Concat and CopyInOrder
SendData(kCmdColumnAddressSet,
    pw::bytes::Concat(
        pw::bytes::CopyInOrder(pw::endian::big, area->x1),
        pw::bytes::CopyInOrder(pw::endian::big, area->x2)));
```

**Boundary helper for LVGL (uint8_t) ↔ Pigweed (std::byte):**

```cpp
inline pw::ConstByteSpan AsBytes(const uint8_t* data, size_t size) {
  // NOLINTNEXTLINE(cppcoreguidelines-pro-type-reinterpret-cast)
  return pw::ConstByteSpan(reinterpret_cast<const std::byte*>(data), size);
}
```

### Error Handling

Use `PW_TRY()` for error propagation, `PW_CHECK_*` for assertions:

```cpp
pw::Status Init() {
  PW_TRY(cs_.Enable());
  PW_TRY(dc_.Enable());
  PW_TRY(spi_.Configure(kSpiConfig));
  return pw::OkStatus();
}

// Assertions - fail fast, don't be defensive
auto* self = static_cast<Driver*>(lv_display_get_user_data(disp));
PW_CHECK_NOTNULL(self);

// Type checks
PW_CHECK_INT_EQ(
    lv_color_format_get_size(lv_display_get_color_format(display_)),
    2,
    "Expected RGB565 color format");
```

### Chrono Literals

Use chrono literals for durations:

```cpp
#include "pw_thread/sleep.h"

void HardwareReset() {
  using namespace std::chrono_literals;

  (void)rst_.SetState(pw::digital_io::State::kActive);
  pw::this_thread::sleep_for(50ms);
  (void)rst_.SetState(pw::digital_io::State::kInactive);
  pw::this_thread::sleep_for(50ms);
  (void)rst_.SetState(pw::digital_io::State::kActive);
  pw::this_thread::sleep_for(150ms);
}
```

### LVGL Integration

**Inline callbacks with auto parameters:**

```cpp
display_ = lv_lcd_generic_mipi_create(
    kWidth, kHeight,
    LV_LCD_FLAG_MIRROR_X | LV_LCD_FLAG_MIRROR_Y,
    [](auto* disp, auto* cmd, auto cmd_size, auto* param, auto param_size) {
      auto* self = static_cast<Driver*>(lv_display_get_user_data(disp));
      PW_CHECK_NOTNULL(self);
      self->SendData(AsBytes(cmd, cmd_size), AsBytes(param, param_size));
    },
    []([[maybe_unused]] auto* disp,
       [[maybe_unused]] auto* cmd,
       [[maybe_unused]] auto cmd_size,
       [[maybe_unused]] auto* param,
       [[maybe_unused]] auto param_size) {
      // Unused callback
    });
```

Use `[[maybe_unused]]` for unused lambda parameters.

## Unit Testing

### Host Unit Tests (`pw_cc_test`)

Use `pw_cc_test` for fast, isolated unit tests that run on the host. These test logic without hardware.

```python
# BUILD.bazel
load("@pigweed//pw_unit_test:pw_cc_test.bzl", "pw_cc_test")

pw_cc_test(
    name = "my_driver_test",
    srcs = ["my_driver_test.cc"],
    deps = [
        ":my_driver",
        "@pigweed//pw_digital_io:digital_io_mock",
        "@pigweed//pw_spi:initiator_mock",
    ],
)
```

Run with: `bazel test //path/to:my_driver_test`

### On-Device Hardware Tests (`particle_cc_test`)

Use `particle_cc_test` for tests that require real hardware (display, sensors, etc.).

**Note:** `./pw build p2` compiles hardware tests to ensure they stay buildable, but does not run them.

**⚠️ Claude: NEVER run on-device tests unless explicitly asked by the user.** Running these tests will flash the connected device, which may have unintended side effects (interrupts user's work, overwrites firmware, etc.).

```python
# BUILD.bazel
load("@particle_bazel//rules:particle_test.bzl", "particle_cc_test")

particle_cc_test(
    name = "hardware_test",
    srcs = ["hardware_test.cc"],
    platform = "//maco_firmware/targets/p2:p2",
    deps = [...],
)
```

Flash and run with: `bazel run //path/to:hardware_test_flash`

### Pigweed Mocks

**SPI Mock** - Verify exact byte sequences sent over SPI:

```cpp
#include "pw_spi/initiator_mock.h"

constexpr auto kExpectedCmd = pw::bytes::Array<0x2A>();
constexpr auto kExpectedData = pw::bytes::Array<0x00, 0x10>();

auto transactions = pw::spi::MakeExpectedTransactionArray({
    pw::spi::MockWriteTransaction(pw::OkStatus(), kExpectedCmd),
    pw::spi::MockWriteTransaction(pw::OkStatus(), kExpectedData),
});
pw::spi::MockInitiator spi_mock(transactions);

// ... use spi_mock ...

EXPECT_EQ(spi_mock.Finalize(), pw::OkStatus());  // Verify all transactions executed
```

**GPIO Mock** - Use `DigitalInOutMock` with sibling cast for `DigitalOut`:

```cpp
#include "pw_digital_io/digital_io_mock.h"

// DigitalInOutMock provides both input and output, use .as<>() to convert
pw::digital_io::DigitalInOutMock<10> pin_mock;  // 10 = event capacity

// Pass to code expecting DigitalOut& using sibling cast
MyDriver driver(spi, pin_mock.as<pw::digital_io::DigitalOut>());

// Verify GPIO state changes
auto& events = pin_mock.events();
EXPECT_EQ(events[0].state, pw::digital_io::State::kInactive);
// Note: Constructor creates initial event at kInactive
```

### Making Code Testable

**Use protected methods** instead of private for testability:

```cpp
// In header
class MyDriver {
 public:
  // Public API...

 protected:
  // Protected for testability - allows test subclass to call directly
  void SendData(pw::ConstByteSpan cmd, pw::ConstByteSpan data);
};

// In test file
class TestableMyDriver : public MyDriver {
 public:
  using MyDriver::MyDriver;    // Inherit constructors
  using MyDriver::SendData;    // Expose protected method
};
```

This follows Pigweed's preferred pattern over `FRIEND_TEST` (which couples tests to implementation).

## Codestyle

**Copyright Header:**
```cpp
// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT
```

- Google C++ style guide
- `snake_case.h` / `snake_case.cc`
- Comments describe **why**, not what changed
- Avoid generic "Manager" suffixes - use specific names like `Crossfade`, `SessionRegistry`

## Key Differences from Legacy Firmware

| Aspect | Legacy (`firmware/`) | New (`maco_firmware/`) |
|--------|---------------------|------------------------|
| Build system | neopo/cmake | Bazel |
| HAL | Particle Wiring | Pigweed abstractions |
| Threading | Device OS | pw_thread |
| Time | `timeSinceBoot()` wrapper | pw_chrono |
| Byte handling | Raw arrays | pw::bytes |
| Error handling | tl::expected | pw::Status + PW_TRY |
| Assertions | Custom | PW_CHECK_* |
