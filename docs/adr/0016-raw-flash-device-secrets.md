# ADR-0016: Raw Flash Storage for Device Secrets

**Status:** Accepted

**Date:** 2026-02-14

**Applies to:** `maco_firmware/modules/device_secrets/device_secrets_eeprom.*`

## Context

Device secrets (gateway master secret, NTAG terminal key) must be stored persistently on the P2's external flash. The initial implementation used the Device OS EEPROM HAL (`HAL_EEPROM_Get`/`HAL_EEPROM_Put`), which stores data in a file on the LittleFS filesystem.

During factory provisioning via pw_rpc, EEPROM writes deadlocked the device. Investigation revealed:

1. `HAL_EEPROM_Put` opens a LittleFS file in write mode, which triggers `lfs_deorphan` — a full filesystem scan that holds `FsLock` (`s_lfs_mutex`) for an extended period.
2. The Device OS system thread also holds `FsLock` for cloud operations (ledger sync, WiFi config persistence, etc.).
3. When the RPC handler (running on the application thread) tries to acquire `FsLock` while the system thread holds it, permanent deadlock occurs.
4. EEPROM reads worked because `LFS_O_RDONLY` skips `lfs_deorphan`, making the lock acquisition fast enough to avoid collision.

A 1-byte `HAL_EEPROM_Put` test confirmed the deadlock is inherent to any LittleFS write from the application thread, not specific to our usage pattern.

## Decision

Bypass LittleFS entirely. Use `hal_storage_read`/`hal_storage_write`/`hal_storage_erase` with `HAL_STORAGE_ID_EXTERNAL_FLASH` to access raw external flash. These functions call `hal_exflash_*` directly, using only `ExFlashLock` (`s_exflash_mutex`) — a short-lived mutex for SPI bus arbitration that does not conflict with the system thread.

### Flash Address Allocation

One 4KB sector at raw flash offset `0x3E0000`:

```
0x260000 - 0x3E0000   OTA Staging Area (1.5MB)
0x3E0000               Device Secrets (4KB sector)
0x3E1000 - 0x480000   Unused gap
0x480000 - 0x600000   User Part (modular firmware)
0x600000 - 0x800000   LittleFS Filesystem (2MB)
```

This address sits in the gap between the OTA staging area and the user firmware module. It is safe because:

- **LittleFS** operates at 0x600000+, never touches this region.
- **OTA staging** ends at 0x3E0000 (exclusive), so our sector is the first byte after.
- **User firmware** starts at 0x480000, well above our sector.
- **DCT, WiFi config, ledger data** all reside inside the LittleFS region.

**Constraint:** This layout assumes **modular firmware** (`MODULAR_FIRMWARE=1`). In monolithic mode, the firmware image spans 0x060000–0x460000 which would overlap. Our Pigweed build uses modular mode.

### Storage Format

```
Offset 0x00: Magic (4B) "MAC0"
Offset 0x04: Version (1B)
Offset 0x05: Length (2B, LE)
Offset 0x07: Reserved (1B)
Offset 0x08: Nanopb-encoded proto
After proto: CRC32 (4B)
```

Sector must be erased (all 0xFF) before writing. Erased state = invalid magic = not provisioned.

### API Access

The `hal_storage_*` functions are guarded by `PARTICLE_USER_MODULE` in `storage_hal.h`. User firmware must define `PARTICLE_USE_UNSTABLE_API` before including the header to access these declarations. The dynalib mechanism provides the actual function implementations at runtime.

## Consequences

- Device secrets provisioning no longer deadlocks.
- Raw flash bypasses all filesystem integrity guarantees (wear leveling, journaling). Acceptable because we write once during factory provisioning and rarely clear.
- The flash address is hardcoded. If the P2 flash map changes in a future Device OS version, this address must be re-validated.
- Hardware tests use the adjacent sector (0x3E1000) to avoid overwriting real secrets.
