# DeviceOS Skill

Ambient context for DeviceOS HAL usage and Wiring API detection.

## Activation Triggers

Activate when code involves:
- Particle DeviceOS APIs
- Wiring library usage (Wire, Serial, SPI, pinMode, digitalWrite, etc.)
- HAL function calls (`hal_*` functions)
- P2 firmware development
- RTL872x platform code

## Core Principle: HAL Only (No Wiring)

**Wiring APIs will not compile in this project.** The Wiring layer is not included in our Bazel/Pigweed build. All hardware access must use direct HAL calls.

When you see Wiring usage being proposed or added:
1. **Flag it** - Explain that Wiring won't compile
2. **Provide alternative** - Show the HAL equivalent
3. **Consult expert** - Use deviceos-expert agent for complex cases

## Quick Reference: Wiring to HAL

| Wiring | HAL | Header |
|--------|-----|--------|
| `pinMode(pin, mode)` | `hal_gpio_mode(pin, mode)` | `gpio_hal.h` |
| `digitalWrite(pin, val)` | `hal_gpio_write(pin, val)` | `gpio_hal.h` |
| `digitalRead(pin)` | `hal_gpio_read(pin)` | `gpio_hal.h` |
| `Wire.begin()` | `hal_i2c_init(iface, cfg)` | `i2c_hal.h` |
| `SPI.begin()` | `hal_spi_init(iface)` | `spi_hal.h` |
| `Serial.begin(baud)` | `hal_usart_init(iface, cfg)` | `usart_hal.h` |
| `delay(ms)` | `hal_delay_milliseconds(ms)` | `delay_hal.h` |

## Anti-Patterns to Flag

### Don't Allow: Global Wiring Instances

```cpp
// BAD - Uses global Wiring instance
Wire.beginTransmission(addr);
Wire.write(data);
Wire.endTransmission();
```

```cpp
// GOOD - Direct HAL
hal_i2c_begin_transmission(HAL_I2C_INTERFACE1, addr, nullptr);
hal_i2c_write(HAL_I2C_INTERFACE1, data);
hal_i2c_end_transmission(HAL_I2C_INTERFACE1, true);
```

### Don't Allow: Arduino-Style Functions

```cpp
// BAD - Arduino compatibility layer
pinMode(D0, OUTPUT);
digitalWrite(D0, HIGH);
```

```cpp
// GOOD - HAL functions
hal_gpio_mode(D0, OUTPUT);
hal_gpio_write(D0, 1);
```

### Don't Allow: Wiring Includes

```cpp
// BAD - Including Wiring headers
#include "spark_wiring_i2c.h"
#include "spark_wiring_spi.h"
```

```cpp
// GOOD - HAL headers only
#include "i2c_hal.h"
#include "spi_hal.h"
```

## When to Consult deviceos-expert

Use the `deviceos-expert` agent via Task tool for:
- Understanding how a Wiring API is implemented
- Finding the right HAL functions for a task
- Debugging P2-specific issues
- Complex peripheral configuration

## HAL Source Locations

```
third_party/particle/third_party/device-os/
├── hal/inc/           # HAL headers (use these)
├── hal/src/rtl872x/   # P2 implementations
└── wiring/            # Wiring layer (avoid)
```

## Documentation Sources

Full Particle documentation is available locally:

| Resource | Path |
|----------|------|
| Wiring API | `third_party/particle/third_party/docs/src/content/reference/device-os/firmware.md` |
| Photon 2 Datasheet | `third_party/particle/third_party/docs/src/content/reference/datasheets/wi-fi/photon-2-datasheet.md` |

## Commands Available

- `/deviceos-plan` - Plan HAL-based feature implementation
- `/deviceos-review` - Review code for Wiring usage violations
- `/deviceos-explain` - Explain a HAL module or concept
- `/deviceos-research` - Research Wiring API implementation
- `/deviceos-update-docs` - Update knowledge base from docs
