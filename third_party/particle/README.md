# Particle Bazel

Bazel infrastructure for building Particle firmware with [Pigweed](https://pigweed.dev/).

This module provides:
- Device OS SDK integration for Particle P2 (RTL8721DM / Cortex-M33)
- Pigweed backend implementations for Particle hardware
- Two-pass linking for OTA-compatible firmware binaries
- Build rules for firmware compilation and flashing

## Directory Structure

```
particle-bazel/
├── BUILD.bazel              # Device OS targets (headers, dynalibs, user-part glue)
├── MODULE.bazel             # Bazel module definition
├── pw_assert_particle/      # pw_assert backend (breakpoint on failure)
├── pw_chrono_particle/      # pw_chrono backend (HAL timer)
├── pw_digital_io_particle/  # pw_digital_io wrapper (pb::ParticleDigitalIn/Out)
├── pw_sync_particle/        # pw_sync backend (HAL mutex)
├── pw_sys_io_particle/      # pw_sys_io backend (USB serial)
├── pw_thread_particle/      # pw_thread backends (id, yield, sleep)
├── pb_log/                  # Log bridge (Device OS -> pw_log)
├── pb_watchdog/             # Watchdog wrapper (pb::watchdog::Watchdog)
├── rules/                   # Bazel build rules
│   └── particle_firmware.bzl
├── third_party/
│   └── device-os/           # Particle Device OS submodule
├── platforms/               # Platform definitions
├── toolchain/               # ARM toolchain configuration
└── tools/                   # Utility scripts (CRC patching, size extraction)
```

## Usage

### 1. Add as a Bazel module dependency

In your `MODULE.bazel`:

```starlark
bazel_dep(name = "particle_bazel")
local_path_override(
    module_name = "particle_bazel",
    path = "particle",  # Path to particle-bazel submodule
)

bazel_dep(name = "pigweed")
local_path_override(
    module_name = "pigweed",
    path = "third_party/pigweed",
)
```

### 2. Import the bazelrc configuration

In your `.bazelrc`:

```
import %workspace%/particle/.bazelrc
```

### 3. Create firmware targets

In your `BUILD.bazel`:

```starlark
load("@particle_bazel//rules:particle_firmware.bzl",
     "particle_cc_binary",
     "particle_firmware_binary",
     "particle_flash_binary")

cc_library(
    name = "my_firmware_lib",
    srcs = ["main.cc"],
    deps = [
        "@particle_bazel//:device_os_headers",
        "@particle_bazel//pw_digital_io_particle:digital_io",
        "@particle_bazel//pb_log:log_bridge",
        "@pigweed//pw_log",
    ],
    target_compatible_with = ["@pigweed//pw_build/constraints/arm:cortex-m33"],
)

particle_cc_binary(
    name = "my_firmware.elf",
    deps = [":my_firmware_lib"],
)

particle_firmware_binary(
    name = "my_firmware",
    elf = ":my_firmware.elf",
)

particle_flash_binary(
    name = "flash",
    firmware = ":my_firmware.bin",
)
```

### 4. Build and flash

```bash
# Build firmware
bazel build --config=p2 //path/to:my_firmware.elf

# Build and flash
bazel run --config=p2 //path/to:flash
```

## Available Targets

### Device OS Integration (`@particle_bazel//`)

| Target | Description |
|--------|-------------|
| `:device_os_headers` | Device OS header files |
| `:device_os_user_part` | Complete user-part dependencies |
| `:hal_dynalib` | HAL dynamic library exports |
| `:services_dynalib` | Services dynamic library exports |
| `:linker_scripts` | Linker scripts for firmware |

### Pigweed Backends (`pw_*_particle/`)

| Target | Pigweed Facade | Description |
|--------|----------------|-------------|
| `pw_assert_particle:assert_backend` | `pw_assert` | Triggers debugger breakpoint on assert |
| `pw_chrono_particle:system_clock` | `pw_chrono` | System clock using HAL timer |
| `pw_digital_io_particle:digital_io` | `pw_digital_io` | GPIO wrapper classes |
| `pw_sync_particle:mutex` | `pw_sync` | Mutex using HAL concurrency |
| `pw_sys_io_particle:sys_io` | `pw_sys_io` | USB serial I/O |
| `pw_thread_particle:id` | `pw_thread` | Thread ID |
| `pw_thread_particle:yield` | `pw_thread` | Thread yield |
| `pw_thread_particle:sleep` | `pw_thread` | Thread sleep |

### Particle-Bazel Utilities (`pb_*/`)

| Target | Description |
|--------|-------------|
| `pb_log:log_bridge` | Bridges Device OS logs to pw_log |
| `pb_watchdog:watchdog` | Hardware watchdog wrapper |

These use the `pb::` namespace:

```cpp
#include "pb_digital_io/digital_io.h"
#include "pb_log/log_bridge.h"
#include "pb_watchdog/watchdog.h"

pb::ParticleDigitalOut led(D7);
pb::ParticleDigitalIn button(D0, pb::ParticleDigitalIn::Mode::kInputPulldown);
pb::log::InitLogBridge();
pb::watchdog::Watchdog wdt;
```

## Why No Wiring/Arduino API?

The Wiring/Arduino API (e.g., `pinMode()`, `digitalWrite()`, `String`) is **intentionally not exposed**. Use Pigweed (`pw_*`) and particle-bazel (`pb_*`) abstractions instead.

**Reasons:**

- **Testability**: Pigweed facades can be mocked for unit testing; Wiring cannot
- **Type safety**: Standard C++ types (`std::string_view`, `pw::span`) vs. custom `String` class
- **Error handling**: Consistent `pw::Status` returns vs. silent failures
- **Separation of concerns**: Clear interfaces between hardware and application logic

**Migration examples:**

| Wiring | particle-bazel |
|--------|----------------|
| `pinMode(D7, OUTPUT)` | `pb::ParticleDigitalOut led(D7)` |
| `digitalWrite(D7, HIGH)` | `led.SetState(pw::digital_io::State::kActive)` |
| `digitalRead(D0)` | `button.GetState()` |
| `delay(1000)` | `pw::this_thread::sleep_for(1000ms)` |
| `millis()` | `pw::chrono::SystemClock::now()` |

## Build Rules

### `particle_cc_binary`

Creates a Particle firmware ELF with two-pass linking for precise memory boundaries.

```starlark
particle_cc_binary(
    name = "firmware.elf",
    srcs = ["main.cc"],      # Optional: source files
    deps = [...],            # Dependencies
    copts = [...],           # Additional compiler flags
    defines = [...],         # Preprocessor defines
    linkopts = [...],        # Additional linker flags
    two_pass = True,         # Use two-pass linking (default: True)
)
```

### `particle_firmware_binary`

Converts ELF to flashable .bin with SHA256/CRC32 patched.

```starlark
particle_firmware_binary(
    name = "firmware",
    elf = ":firmware.elf",
)
```

### `particle_flash_binary`

Creates a target to flash firmware via USB.

```starlark
particle_flash_binary(
    name = "flash",
    firmware = ":firmware.bin",
)
```

## Configuration

The `.bazelrc` provides the `p2` config for Particle P2 builds:

```bash
bazel build --config=p2 //...
```

This configures:
- Target platform: Cortex-M33
- C++ standard: C++17
- Pigweed backends for embedded target

## License

- particle-bazel: MIT
- Device OS: LGPL v3
