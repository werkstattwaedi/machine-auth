# Wiring API to HAL Mapping

This document maps common Wiring (Arduino-compatible) APIs to their underlying HAL functions. **Wiring will not compile in this project** - use this reference to find the equivalent HAL calls.

## Why Wiring Is Unavailable

The Wiring layer is part of Particle's Arduino-compatible SDK, which is not included in our Bazel/Pigweed build. All hardware access must go through direct HAL calls.

## GPIO

| Wiring | HAL Equivalent | Notes |
|--------|----------------|-------|
| `pinMode(pin, mode)` | `hal_gpio_mode(pin, mode)` | Direct mapping |
| `digitalWrite(pin, val)` | `hal_gpio_write(pin, val)` | Direct mapping |
| `digitalRead(pin)` | `hal_gpio_read(pin)` | Direct mapping |
| `analogRead(pin)` | `hal_adc_read(pin)` | Uses ADC HAL |
| `analogWrite(pin, val)` | `hal_pwm_write(pin, val)` | Uses PWM HAL |

**Wiring Implementation** (`wiring/src/spark_wiring.cpp`):
```cpp
void pinMode(uint16_t pin, PinMode setMode) {
    hal_gpio_mode(pin, setMode);
}
```

## I2C (Wire)

| Wiring | HAL Equivalent | Notes |
|--------|----------------|-------|
| `Wire.begin()` | `hal_i2c_init(HAL_I2C_INTERFACE1, nullptr)` | Init with defaults |
| `Wire.beginTransmission(addr)` | `hal_i2c_begin_transmission(i2c, addr, nullptr)` | Start transaction |
| `Wire.write(data)` | `hal_i2c_write(i2c, data)` | Queue data |
| `Wire.endTransmission()` | `hal_i2c_end_transmission(i2c, true)` | Execute transfer |
| `Wire.requestFrom(addr, n)` | `hal_i2c_request_ex(i2c, addr, n, ...)` | Read from device |
| `Wire.read()` | `hal_i2c_read(i2c)` | Get received byte |

**HAL Types:**
- `hal_i2c_interface_t` - I2C interface handle (HAL_I2C_INTERFACE1, etc.)
- `hal_i2c_transmission_config_t` - Configuration struct
- `hal_i2c_config_t` - Init configuration

**Wiring Implementation** (`wiring/src/spark_wiring_i2c.cpp`):
```cpp
void TwoWire::begin() {
    hal_i2c_init(i2c_, nullptr);
}

void TwoWire::beginTransmission(uint8_t address) {
    hal_i2c_begin_transmission(i2c_, address, nullptr);
}
```

## SPI

| Wiring | HAL Equivalent | Notes |
|--------|----------------|-------|
| `SPI.begin()` | `hal_spi_init(HAL_SPI_INTERFACE1)` | Init SPI |
| `SPI.transfer(data)` | `hal_spi_transfer(spi, data)` | Single byte |
| `SPI.beginTransaction(settings)` | `hal_spi_begin_transaction(spi)` | Acquire bus |
| `SPI.endTransaction()` | `hal_spi_end_transaction(spi)` | Release bus |

**HAL Types:**
- `hal_spi_interface_t` - SPI interface handle
- `hal_spi_config_t` - Configuration struct

## Serial (USART)

| Wiring | HAL Equivalent | Notes |
|--------|----------------|-------|
| `Serial.begin(baud)` | `hal_usart_init(HAL_USART_SERIAL1, ...)` | Init UART |
| `Serial.write(data)` | `hal_usart_write(usart, data)` | Send byte |
| `Serial.read()` | `hal_usart_read(usart)` | Receive byte |
| `Serial.available()` | `hal_usart_available(usart)` | Check RX buffer |

**HAL Types:**
- `hal_usart_interface_t` - USART interface handle
- `hal_usart_config_t` - Configuration struct

## NFC

| Wiring | HAL Equivalent | Notes |
|--------|----------------|-------|
| `NFC.setPayload(data, len)` | `hal_nfc_type2_set_payload(data, len)` | Set NDEF |
| `NFC.startEmulation()` | `hal_nfc_type2_start_emulation()` | Begin emulation |
| `NFC.stopEmulation()` | `hal_nfc_type2_stop_emulation()` | Stop emulation |

**Note:** P2 only supports NFC Type 2 tag emulation, not reader mode.

## Timing

| Wiring | HAL Equivalent | Notes |
|--------|----------------|-------|
| `delay(ms)` | `hal_delay_milliseconds(ms)` | Blocking delay |
| `delayMicroseconds(us)` | `hal_delay_microseconds(us)` | Microsecond delay |
| `millis()` | `hal_timer_millis(nullptr)` | System uptime ms |
| `micros()` | `hal_timer_micros(nullptr)` | System uptime us |

## Interrupts

| Wiring | HAL Equivalent | Notes |
|--------|----------------|-------|
| `attachInterrupt(pin, fn, mode)` | `hal_interrupt_attach(pin, fn, ctx, mode, nullptr)` | HAL adds context |
| `detachInterrupt(pin)` | `hal_interrupt_detach(pin)` | Direct mapping |

## Finding Implementations

To understand how Wiring implements something:

```bash
# Find Wiring header
grep -r "className" third_party/particle/third_party/device-os/wiring/inc/

# Find Wiring implementation
grep -r "className::" third_party/particle/third_party/device-os/wiring/src/

# Find underlying HAL
grep -r "hal_function" third_party/particle/third_party/device-os/hal/inc/
```

## Migration Pattern

When you see Wiring usage like this:

```cpp
// DON'T: Wiring style
Wire.begin();
Wire.beginTransmission(0x50);
Wire.write(reg);
Wire.endTransmission();
```

Replace with HAL:

```cpp
// DO: HAL style
hal_i2c_init(HAL_I2C_INTERFACE1, nullptr);
hal_i2c_begin_transmission(HAL_I2C_INTERFACE1, 0x50, nullptr);
hal_i2c_write(HAL_I2C_INTERFACE1, reg);
hal_i2c_end_transmission(HAL_I2C_INTERFACE1, true);
```

Or better, wrap in a Pigweed-compatible abstraction if needed.
