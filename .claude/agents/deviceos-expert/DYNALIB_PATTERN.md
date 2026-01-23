# DeviceOS Dynalib Pattern

## Overview

Dynalib creates a **dynamic function jump table** at a fixed memory location, enabling two independently-compiled modules (system firmware + user application) to call functions at runtime without recompilation.

## How It Works

### 1. Dynalib Declaration (hal/inc/hal_dynalib_*.h)

```c
// In hal/inc/hal_dynalib_gpio.h
DYNALIB_BEGIN(hal_gpio)
DYNALIB_FN(0, hal_gpio, hal_pin_map, hal_pin_info_t*(void))
DYNALIB_FN(1, hal_gpio, hal_gpio_mode, void(hal_pin_t, PinMode))
DYNALIB_FN(2, hal_gpio, hal_gpio_write, void(hal_pin_t, uint8_t))
DYNALIB_FN(3, hal_gpio, hal_gpio_read, int32_t(hal_pin_t))
// ... more functions at fixed indices
DYNALIB_END(hal_gpio)
```

### 2. Export Side (System Firmware)

When compiled with `DYNALIB_EXPORT` defined:

```c
// hal/src/rtl872x/hal_dynalib_export.cpp
#define DYNALIB_EXPORT
#include "hal_dynalib.h"
#include "hal_dynalib_gpio.h"
// Creates jump table: dynalib_hal_gpio = { &hal_pin_map, &hal_gpio_mode, ... }
```

The `DYNALIB_FN` macro expands to a jump table entry containing the function address.

### 3. Import Side (User Application)

When compiled with `DYNALIB_IMPORT` defined:

```c
// hal-dynalib/src/hal_gpio.c
#include "hal_dynalib_gpio.h"
// Creates stub functions with ARM assembly
```

The `DYNALIB_FN` macro expands to a naked ARM assembly stub:

```asm
hal_gpio_write:
    ldr r12, =dynalib_hal_gpio  // Load table address
    ldr r12, [r12, #8]          // Index 2 * 4 bytes
    bx  r12                     // Jump to actual function
```

## Key Rules

### Fixed Indices
Functions are exported by **fixed index** (0, 1, 2, ...). Once assigned, an index can never change.

```c
// WRONG - will break ABI
DYNALIB_FN(0, hal_gpio, hal_gpio_write, ...)  // Was index 2!
DYNALIB_FN(1, hal_gpio, hal_gpio_mode, ...)

// CORRECT - maintain original indices
DYNALIB_FN(0, hal_gpio, hal_pin_map, ...)
DYNALIB_FN(1, hal_gpio, hal_gpio_mode, ...)
DYNALIB_FN(2, hal_gpio, hal_gpio_write, ...)
```

### Adding New Functions
New functions must be **appended to the end**:

```c
DYNALIB_FN(0, hal_gpio, hal_pin_map, ...)
DYNALIB_FN(1, hal_gpio, hal_gpio_mode, ...)
DYNALIB_FN(2, hal_gpio, hal_gpio_write, ...)
DYNALIB_FN(3, hal_gpio, hal_gpio_read, ...)
DYNALIB_FN(4, hal_gpio, hal_gpio_new_function, ...)  // NEW - appended
```

### Removing Functions
Functions cannot be removed; use `DYNALIB_FN_PLACEHOLDER` to reserve the slot:

```c
DYNALIB_FN(0, hal_gpio, hal_pin_map, ...)
DYNALIB_FN_PLACEHOLDER(1)  // Was hal_gpio_deprecated
DYNALIB_FN(2, hal_gpio, hal_gpio_write, ...)
```

## Why This Matters for Our Project

1. **We use pre-compiled system firmware** - Our user code links against the dynalib
2. **HAL functions are stable** - The HAL API is designed for this linking model
3. **Wiring is unavailable** - Wiring won't compile in our Bazel/Pigweed build; we use HAL directly
4. **Platform upgrades** - Updating system firmware doesn't require recompiling user code

## Architecture Diagram

```
┌─────────────────────────────────────┐
│          User Application           │
│  (Compiled with DYNALIB_IMPORT)     │
│                                     │
│   hal_gpio_write(pin, value);       │
│         ↓                           │
│   [ARM stub: load table, jump]      │
└───────────────┬─────────────────────┘
                │
                ↓ (runtime jump)
┌───────────────┴─────────────────────┐
│          Dynalib Jump Table         │
│  (at fixed memory location)         │
│                                     │
│  [0] → hal_pin_map                  │
│  [1] → hal_gpio_mode                │
│  [2] → hal_gpio_write  ←───┐        │
│  [3] → hal_gpio_read       │        │
└────────────────────────────┼────────┘
                             │
                             ↓
┌────────────────────────────┴────────┐
│         System Firmware             │
│  (Compiled with DYNALIB_EXPORT)     │
│                                     │
│   void hal_gpio_write(...) {        │
│       // RTL872x SDK call           │
│   }                                 │
└─────────────────────────────────────┘
```

## Finding Dynalib Definitions

```bash
# List all dynalib modules
ls third_party/particle/third_party/device-os/hal/inc/hal_dynalib_*.h

# Find functions in a specific module
grep "DYNALIB_FN" third_party/particle/third_party/device-os/hal/inc/hal_dynalib_gpio.h

# Find stub implementations
ls third_party/particle/third_party/device-os/hal-dynalib/src/
```
