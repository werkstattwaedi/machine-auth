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

### Console and Debugging

```bash
./pw console-sim  # Connect to simulator (after running it)
./pw console      # Connect to P2 device via serial
```

The console provides:
- Tokenized log viewing (auto-detokenizes using ELF token database)
- RPC access via Python REPL (`device.rpcs.maco.MacoService.Echo(data=b'hello')`)
- Auto-reconnect on device disconnect/reboot

**Prerequisites:**
- Build target first to generate token database
- For P2: Install udev rule for stable `/dev/particle_*` names (see [config.md](../docs/config.md#linux-serial-device-setup))

See [ADR-0011](../docs/adr/0011-pw-console-logging-rpc-integration.md) for architecture.

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

### Async Code (pw_async2)

**CRITICAL: Never write synchronous/blocking code.** All I/O and waiting must be async using `pw_async2`.

#### Core Pattern: Task + DoPend + Poll

Tasks inherit from `pw::async2::Task` and implement `DoPend()`:

```cpp
#include "pw_async2/dispatcher.h"

class MyTask : public pw::async2::Task {
 private:
  pw::async2::Poll<> DoPend(pw::async2::Context& cx) override {
    // Poll a future - returns Pending or Ready
    if (future_->Pend(cx).IsPending()) {
      return pw::async2::Pending();  // Will be woken when ready
    }
    // Future complete - process result
    auto result = future_->value();
    return pw::async2::Ready();
  }

  std::optional<SomeFuture> future_;
};

// Register task with dispatcher
dispatcher.Post(my_task);
```

#### Future Types Used in This Codebase

| Type | Use Case | Example |
|------|----------|---------|
| `ValueFuture<T>` / `ValueProvider<T>` | One-shot results (RPC responses) | `firebase_client.h` |
| `ListableFutureWithWaker<Self, T>` | Custom typed futures | `pn532_detect_tag_future.h` |
| `SingleFutureProvider<F>` | Enforce one operation at a time | `pn532_nfc_reader.h` |

#### ValueFuture Pattern (for RPC/callbacks)

```cpp
class MyService {
 public:
  // Return a future that will be resolved later
  pw::async2::ValueFuture<pw::Result<Response>> DoOperation() {
    return provider_.Get();
  }

 private:
  void OnRpcComplete(Response response) {
    provider_.Resolve(pw::Result<Response>(response));
  }

  pw::async2::ValueProvider<pw::Result<Response>> provider_;
};
```

#### Custom Future Pattern (for protocol state machines)

See `devices/pn532/pn532_call_future.h` for a complete example:

```cpp
class MyProtocolFuture
    : public pw::async2::ListableFutureWithWaker<MyProtocolFuture,
                                                  pw::Result<Data>> {
 public:
  using Base = pw::async2::ListableFutureWithWaker<...>;
  static constexpr const char kWaitReason[] = "MyProtocol";

 private:
  friend Base;
  pw::async2::Poll<pw::Result<Data>> DoPend(pw::async2::Context& cx) {
    // State machine: return Pending() until complete
    switch (state_) {
      case kSending:
        // ... send data, advance state ...
        return pw::async2::Pending();
      case kWaitingResponse:
        // ... check for response ...
        if (!response_ready_) return pw::async2::Pending();
        return pw::async2::Ready(ParseResponse());
    }
  }
};
```

#### Anti-Patterns to Avoid

```cpp
// BAD: Blocking read
auto data = uart_.BlockingRead();

// GOOD: Async with future
PW_TRY_READY_ASSIGN(auto data, read_future_->Pend(cx));

// BAD: Blocking sleep
pw::this_thread::sleep_for(100ms);

// GOOD: Timer future (in async context)
timer_ = time_provider_.WaitFor(100ms);
if (timer_.Pend(cx).IsPending()) return Pending();

// BAD: Synchronous RPC call that waits
auto response = client_.Call(request);  // Blocks!

// GOOD: Async RPC with callback → future
call_ = client_.MyMethod(request, [this](auto& response, auto status) {
  provider_.Resolve(response);
  std::move(waker_).Wake();
});
return Pending();
```

#### Reference Examples

- **Low-level protocol**: `devices/pn532/pn532_call_future.*` - UART state machine
- **High-level futures**: `devices/pn532/pn532_detect_tag_future.h` - typed results
- **Task with FSM**: `devices/pn532/pn532_nfc_reader.*` - ReaderTask + ETL FSM
- **Event subscription**: `modules/app_state/nfc_event_handler.*` - subscribe/handle pattern
- **RPC integration**: `modules/firebase/firebase_client.*` - callback → future bridge

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

### Screenshot Testing for LVGL UIs

Use `ScreenshotTestHarness` for visual regression testing of LVGL screens without requiring SDL or hardware.

**Framework location**: `//maco_firmware/modules/display/testing`

**Basic usage**:

```cpp
#include "maco_firmware/modules/display/testing/screenshot_test_harness.h"

class MyScreenTest : public ::testing::Test {
 protected:
  void SetUp() override {
    ASSERT_EQ(harness_.Init(), pw::OkStatus());
    screen_ = std::make_unique<MyScreen>();
    ASSERT_EQ(harness_.ActivateScreen(*screen_), pw::OkStatus());
  }

  void TearDown() override {
    if (screen_) screen_->OnDeactivate();
  }

  display::testing::ScreenshotTestHarness harness_;
  std::unique_ptr<MyScreen> screen_;
};

TEST_F(MyScreenTest, InitialState) {
  app_state::AppStateSnapshot snapshot;
  snapshot.state = app_state::AppStateId::kNoTag;

  screen_->OnUpdate(snapshot);
  harness_.RenderFrame();

  EXPECT_TRUE(harness_.CompareToGolden(
      "maco_firmware/path/to/testdata/expected.png",
      "/tmp/diff.png"));  // Diff output on failure
}
```

**Running tests**:

```bash
bazel test //path/to:screen_test                    # Compare against goldens
UPDATE_GOLDENS=1 bazel run //path/to:screen_test    # Update golden images
```

**Important**: Use `bazel run` (not `test`) when updating goldens - `bazel test` runs in a read-only sandbox.

**Golden images**: Store PNG files in `testdata/` directory next to the test file.

**On failure**: Diff images are saved to `/tmp/` showing red pixels where differences occur.

**Example**: See `apps/dev/screens/nfc_test_screen_test.cc` and `apps/dev/screens/testdata/*.png`.

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

## Pigweed Protobuf (pwpb) Patterns

### Storage Options for Fields

pwpb generates different C++ types based on field options. Without options, bytes/string fields use callbacks (not suitable for embedded).

#### `max_size` - Bounded storage

For strings and bytes fields, `max_size:N` generates inline storage:

```protobuf
// In .proto file (inline annotation)
string user_label = 5 [(pw.protobuf.pwpb).max_size = 64];
bytes ntag_challenge = 2 [(pw.protobuf.pwpb).max_size = 16];
```

Generated types:
- `string` with `max_size:N` generates `pw::InlineString<N>`
- `bytes` with `max_size:N` generates `pw::Vector<std::byte, N>`

#### `fixed_size` - Fixed-length arrays

For bytes fields with known fixed size (UIDs, keys), combine `max_size` with `fixed_size:true`:

```
// In .pwpb_options file (required for fixed_size - not available inline)
maco.proto.TagUid.value max_size:7 fixed_size:true
maco.proto.KeyBytes.value max_size:16 fixed_size:true
```

Generated type: `std::array<std::byte, N>` instead of `pw::Vector`

#### `max_count` - Repeated scalars only

For repeated scalar fields, `max_count:N` generates `pw::Vector<T, N>`:

```protobuf
repeated int32 values = 1 [(pw.protobuf.pwpb).max_count = 10];
```

**Important:** `max_count` cannot be used with repeated message fields - those always use callbacks.

### Options File Format (`.pwpb_options`)

Options files provide field-level configuration without modifying `.proto` files:

```
// File: common.pwpb_options
// Format: fully.qualified.field.name option:value [option:value ...]

maco.proto.TagUid.value max_size:7 fixed_size:true
maco.proto.FirebaseId.value max_size:20
maco.proto.KeyBytes.value max_size:16 fixed_size:true
```

Options files are associated with protos in BUILD.bazel:
```python
pw_proto_filegroup(
    name = "maco_service_proto_and_options",
    srcs = ["maco_service.proto"],
    options_files = ["maco_service.options"],
)
```

### Wrapper Types Pattern

Define semantic wrapper types in proto for type safety:

```protobuf
// proto/common.proto
message TagUid { bytes value = 1; }      // 7-byte NFC UID
message FirebaseId { string value = 1; } // 20-char document ID
message KeyBytes { bytes value = 1; }    // 16-byte AES key
```

Export type aliases in C++ for use in function signatures:
```cpp
// types.h
using TagUid = maco::proto::pwpb::TagUid::Message;
using FirebaseId = maco::proto::pwpb::FirebaseId::Message;
using KeyBytes = maco::proto::pwpb::KeyBytes::Message;
```

**Benefits:**
- Type safety: compiler catches `TagUid` vs `KeyBytes` misuse
- Self-documenting APIs: function signature shows intent
- Consistent field naming: all wrappers use `.value`

### Proto File Organization

| Location | Purpose |
|----------|---------|
| `proto/common.proto` | Shared types (TagUid, FirebaseId, KeyBytes, Key enum) |
| `proto/firebase_rpc/*.proto` | Cloud function RPC messages |
| `proto/gateway/*.proto` | Gateway service messages |
| `maco_firmware/protos/*.proto` | Firmware-specific RPC services (MacoService, NfcMockService) |

## Key Differences from Legacy Firmware

| Aspect | Legacy (`firmware/`) | New (`maco_firmware/`) |
|--------|---------------------|------------------------|
| Build system | neopo/cmake | Bazel |
| HAL | Particle Wiring | Pigweed abstractions |
| Threading | Device OS | pw_thread |
| Async | Blocking calls | pw_async2 (Poll/Future) |
| Time | `timeSinceBoot()` wrapper | pw_chrono |
| Byte handling | Raw arrays | pw::bytes |
| Error handling | tl::expected | pw::Status + PW_TRY |
| Assertions | Custom | PW_CHECK_* |
