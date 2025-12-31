# ADR-0004: Platform Hardware Abstraction

**Status:** Accepted

**Date:** 2025-12-31

**Applies to:** `maco_firmware/` (Pigweed + Bazel)

## Context

maco_firmware targets multiple platforms (host simulator, Particle P2). Each platform has different hardware (SDL vs SPI LCD, keyboard vs capacitive touch). We need a clean way to:

1. Define hardware interfaces once
2. Provide platform-specific implementations
3. Wire implementations to interfaces per-platform

## Decision

### Factory Functions in `maco::system`

Platform-specific drivers are accessed via factory functions that return static instances:

```cpp
// maco_firmware/system/system.h
namespace maco::system {
  maco::display::DisplayDriver& GetDisplayDriver();
  maco::display::TouchButtonDriver& GetTouchButtonDriver();
}

// maco_firmware/targets/p2/system.cc
maco::display::DisplayDriver& GetDisplayDriver() {
  static maco::display::PicoRes28LcdDriver driver;
  return driver;
}
```

**Pattern:**

- Return abstract interface reference
- Create static instance inside function (lazy initialization, no shutdown needed)
- Each `targets/<platform>/system.cc` provides its own implementations

### Directory Organization

```
maco_firmware/
├── modules/display/          # Abstract interfaces
│   ├── display_driver.h
│   └── touch_button_driver.h
├── devices/                  # Reusable device implementations
│   ├── pico_res28_lcd/
│   └── cap_touch/
└── targets/
    ├── host/                 # Host-specific wiring
    │   ├── system.cc         # Factory functions → SdlDisplayDriver
    │   └── lv_conf.h
    └── p2/                   # P2-specific wiring
        ├── system.cc         # Factory functions → PicoRes28LcdDriver
        └── lv_conf.h
```

**Rules:**

- `modules/` - Abstract interfaces, platform-independent code
- `devices/` - Concrete device drivers (could be reused across platforms)
- `targets/<platform>/` - Keep slim: config files + system.cc wiring only

## Consequences

**Pros:**

- Adding new hardware: implement interface in `devices/`, wire in `targets/`
- Application code uses `maco::system::Get*()` without knowing platform
- No runtime overhead (static instances, no virtual dispatch on hot path)

**Cons:**

- Each new driver type needs a factory function added to `system.h`
