# DeviceOS Explain Task

Explain a HAL module or DeviceOS concept in depth.

## Context

Read the knowledge base first:
- `.claude/agents/deviceos-expert/HAL_MODULES.md` - Available HAL modules
- `.claude/agents/deviceos-expert/DYNALIB_PATTERN.md` - Dynalib architecture

## Research Process

1. **Identify the target** - What module/concept to explain
2. **Find the header** - Look in `device-os/hal/inc/`
3. **Find P2 implementation** - Look in `device-os/hal/src/rtl872x/`
4. **Check dynalib exports** - See what's available via `hal_dynalib_*.h`
5. **Optional: Check Wiring** - If relevant, show how Wiring uses it

## Source Code Locations

```bash
# HAL headers (interfaces)
third_party/particle/third_party/device-os/hal/inc/

# P2 implementations
third_party/particle/third_party/device-os/hal/src/rtl872x/

# Dynalib declarations
third_party/particle/third_party/device-os/hal/inc/hal_dynalib_*.h

# Wiring implementations (for reference)
third_party/particle/third_party/device-os/wiring/src/
```

## Output Format

```markdown
## [Module/Concept Name]

### Overview
[Brief description of what this module does]

### HAL Interface
**Header:** `hal/inc/[header].h`

**Key Types:**
- `type_name` - Description

**Key Functions:**
| Function | Purpose |
|----------|---------|
| `hal_xxx_init()` | Initialize the peripheral |
| `hal_xxx_operation()` | Perform operation |

### P2 Implementation
**File:** `hal/src/rtl872x/[impl].cpp`

[Explain how it works on P2, any quirks or limitations]

### Usage Example

```cpp
// Example showing correct HAL usage
hal_xxx_init(HAL_XXX_INTERFACE1, nullptr);
hal_xxx_operation(...);
```

### Notes
[Any important caveats, P2-specific behavior, etc.]
```

## Common Topics to Explain

- GPIO configuration and edge cases
- I2C transaction model
- SPI clock modes
- USART configuration
- NFC Type 2 limitations
- Interrupt handling
- Timer/delay mechanisms
- Threading (concurrent_hal)
