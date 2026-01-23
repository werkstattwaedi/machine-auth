# DeviceOS HAL Modules Reference

Complete catalog of HAL modules available in DeviceOS. All headers in `hal/inc/`, implementations in `hal/src/rtl872x/` for P2.

## Core/System

| Module | Header | Key Functions | Notes |
|--------|--------|---------------|-------|
| Core | `core_hal.h` | `hal_core_init()`, `hal_core_enter_*_mode()` | Boot, reset, system modes |
| Timer | `timer_hal.h` | `hal_timer_millis()`, `hal_timer_micros()` | System timing |
| RTC | `rtc_hal.h` | `hal_rtc_get_time()`, `hal_rtc_set_time()` | Real-time clock |
| Delay | `delay_hal.h` | `hal_delay_us()`, `hal_delay_ms()` | Blocking delays |
| Watchdog | `watchdog_hal.h` | `hal_watchdog_start()`, `hal_watchdog_refresh()` | Hardware watchdog |
| Power | `power_hal.h` | `hal_power_*()` | Power management, sleep |
| Interrupts | `interrupts_hal.h` | `hal_interrupt_attach()`, `hal_interrupt_detach()` | Interrupt handlers |
| Concurrent | `concurrent_hal.h` | `os_mutex_*()`, `os_semaphore_*()`, `os_thread_*()` | FreeRTOS primitives |

## Digital I/O

| Module | Header | Key Functions | Notes |
|--------|--------|---------------|-------|
| GPIO | `gpio_hal.h` | `hal_gpio_mode()`, `hal_gpio_write()`, `hal_gpio_read()` | Pin I/O |
| Pin Map | `pinmap_hal.h` | `hal_pin_map()` | Pin configuration lookup |
| PWM | `pwm_hal.h` | `hal_pwm_write()`, `hal_pwm_set_resolution()` | Pulse width modulation |

## Analog

| Module | Header | Key Functions | Notes |
|--------|--------|---------------|-------|
| ADC | `adc_hal.h` | `hal_adc_read()`, `hal_adc_set_resolution()` | Analog input |
| DAC | `dac_hal.h` | `hal_dac_write()` | Analog output |

## Communication

| Module | Header | Key Functions | Notes |
|--------|--------|---------------|-------|
| USART | `usart_hal.h` | `hal_usart_init()`, `hal_usart_write()`, `hal_usart_read()` | Serial/UART |
| SPI | `spi_hal.h` | `hal_spi_init()`, `hal_spi_transfer()` | SPI bus |
| I2C | `i2c_hal.h` | `hal_i2c_init()`, `hal_i2c_begin_transmission()`, `hal_i2c_write()` | I2C bus |
| CAN | `can_hal.h` | `hal_can_init()`, `hal_can_transmit()` | CAN bus (if available) |

## Wireless

| Module | Header | Key Functions | Notes |
|--------|--------|---------------|-------|
| BLE | `ble_hal.h` | `hal_ble_*()` | Bluetooth Low Energy |
| WLAN | `wlan_hal.h` | `hal_wlan_*()` | WiFi |
| NFC | `nfc_hal.h` | `hal_nfc_type2_*()` | NFC Type 2 emulation only |
| Cellular | `cellular_hal.h` | `hal_cellular_*()` | Cellular modem |

## Storage

| Module | Header | Key Functions | Notes |
|--------|--------|---------------|-------|
| Flash | `flash_hal.h` | `hal_flash_read()`, `hal_flash_write()`, `hal_flash_erase()` | Internal flash |
| External Flash | `exflash_hal.h` | `hal_exflash_*()` | External SPI flash |
| EEPROM | `eeprom_hal.h` | `hal_eeprom_read()`, `hal_eeprom_write()` | Emulated EEPROM |
| OTA | `ota_flash_hal.h` | `hal_ota_*()` | OTA update management |

## Other

| Module | Header | Key Functions | Notes |
|--------|--------|---------------|-------|
| RGB LED | `rgbled_hal.h` | `hal_led_*()` | Status LED control |
| Button | `button_hal.h` | `hal_button_*()` | Hardware button |
| Backup RAM | `backup_ram_hal.h` | `hal_backup_ram_*()` | Retained memory |
| Device ID | `deviceid_hal.h` | `hal_get_device_id()` | Unique device identification |
| RNG | `rng_hal.h` | `hal_rng_get_random_number()` | Random number generator |

## Dynalib Modules

HAL functions are exported via dynalib in these modules (see `hal/inc/hal_dynalib_*.h`):

| Dynalib | Functions Exported |
|---------|-------------------|
| `hal` | RNG, Delay, Timer, RTC, EEPROM, Core |
| `hal_gpio` | GPIO, ADC, DAC, PWM |
| `hal_usart` | USART/Serial |
| `hal_spi` | SPI |
| `hal_i2c` | I2C |
| `hal_ble` | BLE |
| `hal_nfc` | NFC |
| `hal_can` | CAN |
| `hal_concurrent` | Threading, mutex, semaphore |
| `hal_rgbled` | RGB LED |

## P2 (RTL872x) Specific Notes

1. **NFC** - Supports Type 2 tag emulation only (via `hal_nfc_type2_*`)
2. **Audio Pins** - S0/S1 (pins 22-25) require caching for GPIO read
3. **BLE** - Full BLE support via RTL8721D radio
4. **WiFi** - 2.4GHz + 5GHz support
5. **Dual Core** - KM0 (low power) + KM4 (main) cores

## Finding HAL Implementations

To find how a HAL function is implemented for P2:

```bash
# Find the header
grep -r "function_name" third_party/particle/third_party/device-os/hal/inc/

# Find P2 implementation
grep -r "function_name" third_party/particle/third_party/device-os/hal/src/rtl872x/
```
