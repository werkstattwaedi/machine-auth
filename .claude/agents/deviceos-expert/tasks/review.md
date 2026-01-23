# DeviceOS Review Task

Review code for Wiring API usage that should be replaced with HAL calls.

## Context

Read the knowledge base first:
- `.claude/agents/deviceos-expert/HAL_MODULES.md` - Available HAL modules
- `.claude/agents/deviceos-expert/WIRING_TO_HAL.md` - Wiring to HAL mapping

## Review Scope

Examine the specified files or changes for:

1. **Wiring API Usage** - Any use of Arduino-style APIs
2. **Global Instances** - Wire, Serial, SPI, etc.
3. **Missing HAL Opportunities** - Code that could use HAL directly

## Patterns to Flag

### Critical (Must Fix)

```cpp
// DON'T: Global Wiring instances
Wire.begin();
Serial.begin(115200);
SPI.begin();

// DON'T: Arduino-style function calls
pinMode(D0, OUTPUT);
digitalWrite(D0, HIGH);
delay(100);
```

### Recommended HAL Alternatives

```cpp
// DO: Direct HAL calls
hal_i2c_init(HAL_I2C_INTERFACE1, nullptr);
hal_usart_init(HAL_USART_SERIAL1, &config);
hal_spi_init(HAL_SPI_INTERFACE1);

// DO: HAL GPIO
hal_gpio_mode(D0, OUTPUT);
hal_gpio_write(D0, 1);
hal_delay_milliseconds(100);
```

## Output Format

```markdown
## DeviceOS Code Review

### Summary
[Brief summary of findings]

### Violations Found

#### 1. [File:Line] - [Issue Type]
**Current Code:**
```cpp
[code snippet]
```

**Issue:** [Description]

**HAL Alternative:**
```cpp
[replacement code]
```

---

### Recommendations
[Any architectural recommendations for HAL integration]
```

## Research When Needed

If unsure how a Wiring API maps to HAL:

1. Check the Wiring implementation in `device-os/wiring/src/`
2. Find the HAL calls it makes
3. Document the mapping in your review
