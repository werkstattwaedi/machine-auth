---
description: Plan HAL-based feature implementation for P2 firmware
---

# DeviceOS Feature Planning

Plan a feature implementation using DeviceOS HAL (not Wiring APIs).

## Knowledge Base

Read these files for context:
- `.claude/agents/deviceos-expert/HAL_MODULES.md` - Available HAL modules
- `.claude/agents/deviceos-expert/WIRING_TO_HAL.md` - Wiring to HAL mapping
- `.claude/agents/deviceos-expert/DYNALIB_PATTERN.md` - Dynalib architecture

## Source Code Reference

DeviceOS source at `third_party/particle/third_party/device-os/`:
- HAL headers: `hal/inc/*.h`
- P2 implementations: `hal/src/rtl872x/*.cpp`
- Dynalib exports: `hal/inc/hal_dynalib_*.h`

## Planning Process

1. **Understand the requirement** - What feature needs to be implemented?

2. **Identify HAL modules needed** - Which HAL APIs are required?
   - Check HAL_MODULES.md for available modules
   - Research the HAL headers for function signatures
   - Verify functions are exported via dynalib

3. **Check for Pigweed integration** - Can we wrap HAL in a Pigweed abstraction?
   - Consider pw::i2c, pw::spi, etc. backends
   - Look at existing backends in `third_party/particle/`

4. **Plan the implementation**
   - Initialization sequence
   - Runtime operations
   - Error handling
   - Resource cleanup

5. **Identify P2-specific considerations**
   - Platform limitations
   - Pin mappings
   - Hardware quirks

## Output Format

Provide a plan with:

```markdown
## Feature: [Name]

### HAL Modules Required
- `module_hal.h` - For [purpose]

### HAL Functions to Use
| Function | Purpose |
|----------|---------|
| `hal_xxx_init()` | Initialize peripheral |
| `hal_xxx_operation()` | Perform operation |

### Implementation Steps
1. [Step 1]
2. [Step 2]

### Pigweed Integration
[How to integrate with Pigweed patterns]

### P2 Considerations
[Any platform-specific notes]

### Files to Create/Modify
- `path/to/file.cpp` - [changes]
```

## Constraints

- **No Wiring APIs** - Use HAL directly
- **Pigweed patterns** - Integrate with existing architecture
- **P2 platform** - Focus on RTL872x unless otherwise specified

$ARGUMENTS
