# ADR-0008: P2 Memory Layout and Allocation Strategy

**Status:** Accepted (updated 2026-02-14)

**Date:** 2026-01-02

## Context

The Particle P2 (RTL8721DM Cortex-M33) has multiple memory regions with different characteristics. Understanding and controlling memory placement is critical for:

1. Fitting within SRAM constraints during two-pass linking (see ADR-0007)
2. Optimizing performance by placing hot data in fast SRAM
3. Making informed trade-offs between static allocation and fragmentation

### Memory Regions

| Region | Size | Address Range | Speed | Use Case |
|--------|------|---------------|-------|----------|
| SRAM | 476 KB | 0x10005000 - 0x1007B000 | Fastest | Static variables, stacks, critical buffers |
| PSRAM | 4 MB | 0x02000000 - 0x02400000 | Fast | Code, large const data, heap |
| Flash | 8 MB | 0x08000000+ | Slow | User module storage |

**Hard limit:** Device OS reserves ~128 KB of SRAM for its own use. User module SRAM must stay well below the total 476 KB to avoid corrupting the Device OS heap (which causes Bus Faults at runtime, not link-time errors).

### Investigation Methodology

To analyze memory usage, use these tools:

```bash
# View generated size report
cat bazel-bin/maco_firmware/apps/dev/dev.elf_sizes.json

# Find largest static allocations with addresses
readelf -sW bazel-bin/maco_firmware/apps/dev/dev.elf | \
  awk '$4 == "OBJECT" && $3 > 500 {print $3, $2, $8}' | \
  sort -rn | head -30

# Demangle C++ symbols
echo '_ZZN4maco6system16GetDisplayDriverEvE6driver' | c++filt
# Output: maco::system::GetDisplayDriver()::driver

# Check section addresses
readelf -SW bazel-bin/maco_firmware/apps/dev/dev.elf | grep -E '\.text|\.data|\.bss|\.psram'
```

Address ranges to identify memory region:
- `0x1005xxxx - 0x1007xxxx` → SRAM (.data, .bss)
- `0x023xxxxx` → PSRAM (.psram_text, .data_alt, .bss_alt)
- `0x084xxxxx` → Flash (module code)

### Current Memory Breakdown (P2 dev firmware)

**From memory budget golden file:**
- SRAM: ~80 KB (.data=15KB, .bss=65KB)
- PSRAM: ~438 KB (code + const data + LVGL pool + channel buffer)
- Flash: ~455 KB (module binary)

**SRAM Consumers (verified by address):**

| Size | Symbol | Description |
|------|--------|-------------|
| 30 KB | `PicoRes28LcdDriver::driver` | Display driver + double buffers |
| 8 KB | `pw::system::AsyncCore::allocator()::buffer` | pw_system allocator |
| 4 KB | `pw::system::log_buffer` | Log ring buffer |
| 4 KB | `pw::system::packet_io_` | Packet I/O buffer |
| 4 KB | `pb::cloud::ParticleLedgerBackend::Instance()::instance` | Cloud ledger backend |
| ~16 KB | Thread stacks (4x ~4KB + 2x ~2KB) | dispatcher, log, rx/tx, transfer, rpc, work_queue |
| 0.5 KB | `lv_global` | LVGL global state |

**Moved to PSRAM (`.psram.bss` section):**

| Size | Symbol | Description |
|------|--------|-------------|
| 64 KB | LVGL memory pool | Via `LV_MEM_POOL_ALLOC` + `lvgl_psram_pool.h` |
| 16 KB | `channel_buffer` | pw_system communication channel |

**Already in PSRAM (const data, automatically placed by linker):**

| Size | Symbol | Description |
|------|--------|-------------|
| 18 KB | `glyph_bitmap` | Font bitmap data |
| 1.5 KB | `glyph_dsc` | Font glyph descriptors |
| 1.5 KB | CRC tables | Checksum lookup tables |

### SRAM Layout (Linker Perspective)

From `platform_ram.ld`:

```
Total SRAM: 476KB (0x10005000 - 0x1007B000)

+---------------------------+ 0x1007B000
| User backup RAM (3KB)     |
+---------------------------+ 0x1007B380
| System backup RAM (1KB)   |
+---------------------------+ 0x1007B000
| User part static RAM      | ← .data + .bss (~80KB)
| - Display driver (30KB)   |
| - pw_system (~20KB)       |
| - Thread stacks (~16KB)   |
+~~~~~~~~~~~~~~~~~~~~~~~~~~~+
| Heap                      | ← Runtime malloc()
+~~~~~~~~~~~~~~~~~~~~~~~~~~~+
| System part 1 static RAM  | ← Device OS (~128KB reserved)
+---------------------------+ 0x10005000
| Non-secure stack (8KB)    |
+---------------------------+ 0x10004000
```

### What Goes Where

**SRAM (.data, .bss):**
- `static` local variables in functions
- Global variables
- Static class member arrays (like display buffers)

**PSRAM (.psram.bss — explicit placement):**
- LVGL memory pool (64KB) — via `__attribute__((section(".psram.bss")))`
- `channel_buffer` (16KB) — sequential I/O, latency-insensitive

**Note:** `.psram.bss` is NOT zeroed by `module_user_pre_init()` (it only zeroes SRAM `.bss`). This is safe for the LVGL pool because TLSF initializes its own metadata, and safe for `channel_buffer` because pw_system initializes it. Other variables placed here may contain stale data.

**PSRAM (.psram_text — automatic):**
- `const` data (automatically by linker)
- Code that doesn't fit in Flash
- Large lookup tables

**Key insight:** `const` data goes to PSRAM automatically. The old firmware used `malloc()` for display buffers (heap), while our new driver embeds them as member arrays (static SRAM). This is intentional for DMA performance.

### LVGL Memory Options

**Current: LV_STDLIB_BUILTIN (TLSF allocator) in PSRAM**

LVGL uses a 64KB static pool with TLSF (Two-Level Segregated Fit), placed in PSRAM via `LV_MEM_POOL_ALLOC`:
- O(1) allocation/deallocation (deterministic, real-time safe)
- Low fragmentation by design
- Small per-allocation overhead (~4 bytes)
- Memory monitoring available (`LV_USE_MEM_MONITOR`)
- Slight latency increase vs SRAM, acceptable for UI allocations

**Alternative: LV_STDLIB_CLIB (system malloc)**

Would use Device OS heap instead of static pool:
- No 64KB static allocation
- But: fragmentation unpredictable over time
- Competes with Device OS heap
- No built-in monitoring

**Recommendation:** Keep BUILTIN in PSRAM. The 64KB predictable pool is better than unpredictable heap fragmentation for a UI library with many small allocations.

## Decision

### 1. Keep Draw Buffers in SRAM (Static)

The 30KB display buffers are embedded in `PicoRes28LcdDriver` as member arrays. This provides:
- Fastest memory access during SPI DMA transfers
- Predictable allocation at startup
- No heap fragmentation from buffer allocation

### 2. Use LVGL Builtin Allocator in PSRAM

Use `LV_USE_STDLIB_MALLOC = LV_STDLIB_BUILTIN` with 64KB pool placed in PSRAM via `LV_MEM_POOL_ALLOC`:
- Deterministic allocation times
- Isolated from Device OS heap
- Can monitor usage with `LV_USE_MEM_MONITOR`
- Frees 64KB of SRAM for stacks and other static allocations

### 3. Let Linker Place Const Data in PSRAM

Font bitmaps and other `const` data automatically go to PSRAM. No action needed.

### 4. Move Large Buffers to PSRAM

Sequential-access buffers like `channel_buffer` are placed in `.psram.bss` to free SRAM. Only latency-critical buffers (display DMA) remain in SRAM.

### 5. Dispatcher Stack at 4KB

The pw_system dispatcher thread stack is 4KB (up from the 2KB default). This accommodates deeper call chains from RPC handlers and async coroutines.

### 6. Stack Monitor Thread

A low-priority stack monitor thread periodically logs stack watermarks for all threads. This adds one thread (~2KB stack) but provides early warning when any thread's headroom drops below 20%.

### 7. Pass 1 Default at 256KB

As documented in ADR-0007, the two-pass linker default is 256KB. Current SRAM usage of ~80KB is well within this budget.

## Consequences

**Pros:**
- Predictable memory layout at compile time
- Fast display updates with SRAM buffers
- LVGL memory is isolated and monitorable
- Const data automatically in PSRAM (fonts, tables)
- SRAM reduced from ~138KB to ~80KB by moving LVGL pool and channel buffer to PSRAM
- Stack monitor provides runtime visibility into thread headroom

**Cons:**
- Slight latency increase for LVGL allocations (PSRAM vs SRAM)
- `.psram.bss` not auto-zeroed — requires awareness when placing new variables there

**Future Optimizations (if needed):**

1. ~~**Move LVGL pool to PSRAM**~~ — **Done.** Saves 64KB SRAM.

2. **Reduce LVGL pool size**: Currently 64KB, could reduce if UI is simple. Enable `LV_USE_MEM_MONITOR` to measure actual peak usage.

3. **Dynamic draw buffers**: Allocate via `malloc()` like old firmware. Trades 30KB SRAM for heap fragmentation risk and slight DMA setup overhead.

4. **Reduce pw_system buffers**: Tune `pw::system` buffer sizes if overhead is too high.

## References

- ADR-0007: Particle Binary Linking Strategy
- `third_party/particle/third_party/device-os/build/arm/linker/rtl872x/platform_ram.ld`
- `third_party/lvgl/src/stdlib/builtin/lv_mem_core_builtin.c` (TLSF allocator)
- `maco_firmware/targets/p2/lvgl_psram_pool.h` (PSRAM pool placement)
- `maco_firmware/modules/stack_monitor/` (stack watermark monitoring)
- TLSF paper: http://www.gii.upv.es/tlsf/
