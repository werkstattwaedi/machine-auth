# Particle Documentation Index

Local documentation is available in `third_party/particle/third_party/docs/`.

## Key Documentation Files

### Wiring/Firmware API Reference

**Primary file:** `src/content/reference/device-os/firmware.md` (~32,000 lines)

This file contains the complete Wiring API reference including:
- Cloud functions (Particle.variable, Particle.function, Particle.publish)
- WiFi, Ethernet, Cellular networking
- GPIO, ADC, DAC, PWM
- Serial (UART), SPI, I2C
- Timers, interrupts, sleep modes
- File system, EEPROM
- BLE, NFC
- Threading, synchronization

**How to use:** When you need to understand a Wiring API, grep for the function/class name:
```bash
grep -n "Wire\." third_party/particle/third_party/docs/src/content/reference/device-os/firmware.md
grep -n "SPI\." third_party/particle/third_party/docs/src/content/reference/device-os/firmware.md
```

### Datasheets

| Device | Documentation Path |
|--------|-------------------|
| Photon 2 | `src/content/reference/datasheets/wi-fi/photon-2-datasheet.md` |
| P2 | `src/content/reference/datasheets/wi-fi/p2-datasheet.md` |
| Argon | `src/content/reference/datasheets/wi-fi/argon-datasheet.md` |
| Boron | `src/content/reference/datasheets/cellular/boron-datasheet.md` |

### Other Useful References

| Topic | Path |
|-------|------|
| Device OS versions | `src/content/reference/device-os/versions.md` |
| Pin information | `src/content/reference/device-os/pin-info.md` |
| Sleep modes | `src/content/reference/device-os/sleep.md` |
| BLE | `src/content/reference/device-os/bluetooth-le.md` |
| File system | `src/content/reference/device-os/file-system.md` |
| EEPROM | `src/content/reference/device-os/eeprom.md` |

## Documentation Structure

```
third_party/particle/third_party/docs/
└── src/content/
    ├── reference/
    │   ├── device-os/
    │   │   ├── firmware.md          # Wiring API reference (main)
    │   │   ├── bluetooth-le.md      # BLE details
    │   │   ├── sleep.md             # Sleep modes
    │   │   └── ...
    │   └── datasheets/
    │       ├── wi-fi/
    │       │   ├── photon-2-datasheet.md
    │       │   └── p2-datasheet.md
    │       └── cellular/
    │           └── boron-datasheet.md
    ├── tutorials/                   # How-to guides
    └── troubleshooting/            # Debugging guides
```

## Common Research Patterns

### Find Wiring API implementation details

```bash
# Search for a specific API
grep -n "beginTransmission" third_party/particle/third_party/docs/src/content/reference/device-os/firmware.md

# Search for a class
grep -n "^### Wire" third_party/particle/third_party/docs/src/content/reference/device-os/firmware.md
```

### Find pin capabilities

```bash
# Check what D2 can do
grep -n "D2" third_party/particle/third_party/docs/src/content/reference/datasheets/wi-fi/photon-2-datasheet.md
```

### Cross-reference with HAL

1. Find the Wiring API in `firmware.md`
2. Look at the source in `device-os/wiring/src/`
3. Find the HAL functions it calls
4. Check the HAL implementation in `device-os/hal/src/rtl872x/`
