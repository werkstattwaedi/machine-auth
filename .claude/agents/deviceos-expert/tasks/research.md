# DeviceOS Research Task

Research how a Wiring API is implemented and provide guidance for HAL-based reimplementation.

## Context

Read the knowledge base first:
- `.claude/agents/deviceos-expert/WIRING_TO_HAL.md` - Known mappings
- `.claude/agents/deviceos-expert/HAL_MODULES.md` - Available HAL modules

## Research Process

1. **Find the Wiring implementation**
   - Header: `device-os/wiring/inc/spark_wiring_*.h`
   - Implementation: `device-os/wiring/src/spark_wiring_*.cpp`

2. **Trace HAL calls**
   - What HAL functions does Wiring call?
   - What initialization is needed?
   - What state does it manage?

3. **Find HAL interface**
   - Header: `device-os/hal/inc/*.h`
   - Types and function signatures

4. **Check P2 implementation**
   - Implementation: `device-os/hal/src/rtl872x/*.cpp`
   - Platform-specific behavior or limitations

5. **Identify dynalib exports**
   - Check `device-os/hal/inc/hal_dynalib_*.h`
   - Confirm functions are exported

## Source Code Locations

```bash
# Wiring headers
third_party/particle/third_party/device-os/wiring/inc/spark_wiring_*.h

# Wiring implementations
third_party/particle/third_party/device-os/wiring/src/spark_wiring_*.cpp

# HAL headers
third_party/particle/third_party/device-os/hal/inc/*.h

# P2 HAL implementations
third_party/particle/third_party/device-os/hal/src/rtl872x/*.cpp

# Dynalib exports
third_party/particle/third_party/device-os/hal/inc/hal_dynalib_*.h
```

## Output Format

```markdown
## Research: [Wiring Feature/API]

### Wiring Implementation Analysis

**Files:**
- Header: `wiring/inc/spark_wiring_xxx.h`
- Implementation: `wiring/src/spark_wiring_xxx.cpp`

**What Wiring Does:**
1. [Step 1 of what the Wiring API does]
2. [Step 2]
3. [etc.]

**HAL Functions Used:**
| Wiring Method | HAL Function(s) |
|---------------|-----------------|
| `Class::method()` | `hal_xxx_function()` |

### HAL Interface

**Header:** `hal/inc/xxx_hal.h`

**Types:**
- `hal_xxx_t` - Description
- `hal_xxx_config_t` - Configuration struct

**Functions:**
```cpp
// Key function signatures
int hal_xxx_init(hal_xxx_interface_t, hal_xxx_config_t*);
int hal_xxx_operation(hal_xxx_interface_t, ...);
```

### P2 Implementation Notes

**File:** `hal/src/rtl872x/xxx_hal.cpp`

[Any P2-specific behavior, limitations, or quirks]

### Reimplementation Guide

To replace the Wiring usage with direct HAL:

```cpp
// Instead of:
WiringClass::method(args);

// Use:
hal_xxx_function(interface, args);
```

**Initialization required:**
```cpp
// Setup code needed
hal_xxx_init(HAL_XXX_INTERFACE1, nullptr);
```

**State management:**
[What state the Wiring class manages that you'll need to handle]

### Dynalib Availability

Confirmed exported in `hal_dynalib_xxx.h`:
- `hal_xxx_init` - Index N
- `hal_xxx_operation` - Index M

### Caveats

[Any important warnings or gotchas]
```

## Common Research Requests

- How does Wire implement I2C transactions?
- How does Serial handle buffering?
- How does SPI handle chip select?
- How does NFC emulation work internally?
- How do interrupts get dispatched?
