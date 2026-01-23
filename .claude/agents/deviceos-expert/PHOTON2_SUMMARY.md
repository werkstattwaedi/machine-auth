# Photon 2 / P2 Hardware Summary

Quick reference for Photon 2 and P2 module hardware. For full details, see:
`third_party/particle/third_party/docs/src/content/reference/datasheets/wi-fi/photon-2-datasheet.md`

## MCU Overview

| Property | Value |
|----------|-------|
| MCU | Realtek RTL8721DM |
| Core | ARM Cortex M33, 200 MHz |
| User App Size | 2048 KB (2 MB) max |
| RAM | 3072 KB (3 MB) available to user |
| Flash FS | 2 MB file system |
| Device OS | 5.0.0 or later required |

## Pin Mapping (Photon 2 / P2)

### GPIO and Peripherals

| Pin | Alternate | MCU | Functions |
|-----|-----------|-----|-----------|
| D0 | A3 | PB[6] | GPIO, I2C SDA, ADC_2 |
| D1 | A4 | PB[5] | GPIO, I2C SCL, ADC_1, PWM |
| D2 | - | PA[16] | GPIO, SPI1 MOSI, Serial2 RTS |
| D3 | - | PA[17] | GPIO, SPI1 MISO, Serial2 CTS |
| D4 | - | PA[18] | GPIO, SPI1 SCK, Serial2 TX |
| D5 | - | PA[19] | GPIO, SPI1 SS, Serial2 RX |
| D6 | - | PB[3] | GPIO, SWCLK (40K pull-down at boot) |
| D7 | - | PA[27] | GPIO, Blue LED, SWDIO (40K pull-up at boot) |
| TX/D8 | - | PA[7] | GPIO, Serial1 TX (low at boot = ISP mode) |
| RX/D9 | - | PA[8] | GPIO, Serial1 RX |
| D10/WKP | - | PA[15] | GPIO, Serial3 CTS, Wake pin |
| A0 | D11 | PB[1] | GPIO, ADC_4, PDM CLK |
| A1 | D12 | PB[2] | GPIO, ADC_5, PDM DAT |
| A2 | D13 | PB[7] | GPIO, ADC_3, PWM |
| A5 | D14 | PB[4] | GPIO, ADC_0, PWM |
| MOSI | D15 | PA[12] | GPIO, SPI MOSI, Serial3 TX, PWM |
| MISO | D16 | PA[13] | GPIO, SPI MISO, Serial3 RX, PWM |
| SCK | D17 | PA[14] | GPIO, SPI SCK, Serial3 RTS |
| S3 | D18 | PB[26] | GPIO, SPI SS |
| S4 | D19 | PA[0] | GPIO (no internal pull in HIBERNATE) |

### Peripheral Interfaces

#### I2C
- **Wire**: D0 (SDA), D1 (SCL)
- Max speed: 400 kHz
- External pull-ups required (1.5K-10K)

#### SPI
- **SPI**: MOSI/D15, MISO/D16, SCK/D17, SS/S3/D18
- **SPI1**: D2 (MOSI), D3 (MISO), D4 (SCK), D5 (SS)
- SPI max: 25 MHz, SPI1 max: 50 MHz

#### UART
- **Serial1**: TX/D8, RX/D9 (UART_LOG peripheral)
- **Serial2**: D4 (TX), D5 (RX), D2 (RTS), D3 (CTS) (HS_UART0)
- **Serial3**: MOSI/D15 (TX), MISO/D16 (RX), SCK/D17 (RTS), D10 (CTS) (LP_UART)

#### ADC
- 6 channels: A0-A2, A5, D0/A3, D1/A4
- 12-bit resolution, 0-3.3V range
- A6 (internal): Battery voltage, 0-5V range

#### PWM
- 5 pins: D1, A2, A5, MOSI/D15, MISO/D16

### Power Pins

| Pin | Description |
|-----|-------------|
| 3V3 | 3.3V output, 500mA max (cannot power device) |
| VUSB | USB power out (5V when USB connected) or in |
| LI+ | LiPo battery connection (3.6-4.2V) |
| EN | Enable pin (pull low to power down, 100K internal pull-up) |

### Boot Mode Pins

| Pin | Boot Behavior |
|-----|---------------|
| TX/D8 | Low at boot triggers ISP flash download |
| D6 | 40K pull-down at boot (SWCLK) |
| D7 | 40K pull-up at boot, low triggers MCU test mode (SWDIO) |

## HAL Interface to MCU Pin Mapping

When using HAL functions, the pin constants (D0, D1, A0, etc.) map to MCU pins:

```cpp
// Examples of HAL pin usage
hal_gpio_mode(D0, OUTPUT);      // PB[6]
hal_gpio_mode(A0, INPUT);       // PB[1]
hal_i2c_init(HAL_I2C_INTERFACE1, nullptr);  // Uses D0/D1
hal_spi_init(HAL_SPI_INTERFACE1);           // Uses MOSI/MISO/SCK
hal_usart_init(HAL_USART_SERIAL1, &config); // Uses TX/RX
```

## RTL872x-Specific Notes

1. **Dual Core**: KM0 (low power) + KM4 (main application)
2. **PSRAM**: Uses pseudo-static RAM for larger heap
3. **Retained Memory**: 3068 bytes, requires `System.backupRamSync()` (Device OS 5.3.1+)
4. **5V Tolerance**: GPIO is NOT 5V tolerant
5. **Drive Strength**: 4mA normal, 12mA high (configurable in Device OS 5.5.0+)

## Sleep and Wake

- **STOP/ULTRA_LOW_POWER**: Any GPIO can wake, RISING/FALLING/CHANGE
- **HIBERNATE**: Only specific pins can wake: D2-D5, D10/WKP, MISO, MOSI, SCK
- S4/D19 has no internal pull in HIBERNATE (needs external pull)

## Differences from P1/Photon (Gen 2)

- Different MCU (RTL8721D vs STM32F205)
- More RAM (3MB vs 128KB)
- Larger user app (2MB vs 128KB)
- 5 GHz WiFi support
- BLE support
- Different pin assignments for some functions
