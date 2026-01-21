# ADR-0008: P2 Memory Layout and Allocation Strategy

**Status:** Accepted

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

### Current Memory Breakdown (P2 firmware)

**From `dev.elf_sizes.json`:**
- SRAM: 138 KB (.data=12KB, .bss=125KB)
- PSRAM: 264 KB (code + const data)
- Flash: 277 KB (module binary)

**SRAM Consumers (verified by address):**

| Size | Symbol | Description |
|------|--------|-------------|
| 64 KB | `work_mem_int` | LVGL memory pool (LV_MEM_SIZE) |
| 30 KB | `PicoRes28LcdDriver::draw_buf{1,2}_` | Display double buffers |
| 8 KB | `pw::system::AsyncCore::allocator()::buffer` | pw_system allocator |
| 4 KB | `maco::system::Init()::channel_buffer` | Communication channel |
| 4 KB | `pw::system::log_buffer` | Log ring buffer |
| 4 KB | `pw::system::packet_io_` | Packet I/O buffer |
| ~8 KB | Thread stacks (4x ~2KB) | log, transfer, rpc, dispatcher |
| 0.5 KB | `lv_global` | LVGL global state |

**Already in PSRAM (not consuming SRAM):**

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
| User part static RAM      | ← .data + .bss (~138KB)
| - LVGL pool (64KB)        |
| - Display buffers (30KB)  |
| - pw_system (~20KB)       |
+~~~~~~~~~~~~~~~~~~~~~~~~~~~+
| Heap                      | ← Runtime malloc()
+~~~~~~~~~~~~~~~~~~~~~~~~~~~+
| System part 1 static RAM  | ← Device OS
+---------------------------+ 0x10005000
| Non-secure stack (8KB)    |
+---------------------------+ 0x10004000
```

### What Goes Where

**SRAM (.data, .bss):**
- `static` local variables in functions
- Global variables
- Static class member arrays (like display buffers)

**PSRAM (.psram_text):**
- `const` data (automatically by linker)
- Code that doesn't fit in Flash
- Large lookup tables

**Key insight:** `const` data goes to PSRAM automatically. The old firmware used `malloc()` for display buffers (heap), while our new driver embeds them as member arrays (static SRAM). This is intentional for DMA performance.

### LVGL Memory Options

**Current: LV_STDLIB_BUILTIN (TLSF allocator)**

LVGL uses a 64KB static pool with TLSF (Two-Level Segregated Fit):
- O(1) allocation/deallocation (deterministic, real-time safe)
- Low fragmentation by design
- Small per-allocation overhead (~4 bytes)
- Memory monitoring available (`LV_USE_MEM_MONITOR`)

**Alternative: LV_STDLIB_CLIB (system malloc)**

Would use Device OS heap instead of static pool:
- No 64KB static allocation
- But: fragmentation unpredictable over time
- Competes with Device OS heap
- No built-in monitoring

**Recommendation:** Keep BUILTIN. The 64KB predictable pool is better than unpredictable heap fragmentation for a UI library with many small allocations.

## Decision

### 1. Keep Draw Buffers in SRAM (Static)

The 30KB display buffers are embedded in `PicoRes28LcdDriver` as member arrays. This provides:
- Fastest memory access during SPI DMA transfers
- Predictable allocation at startup
- No heap fragmentation from buffer allocation

### 2. Use LVGL Builtin Allocator

Continue with `LV_USE_STDLIB_MALLOC = LV_STDLIB_BUILTIN` and 64KB pool:
- Deterministic allocation times
- Isolated from Device OS heap
- Can monitor usage with `LV_USE_MEM_MONITOR`

### 3. Let Linker Place Const Data in PSRAM

Font bitmaps and other `const` data automatically go to PSRAM. No action needed.

### 4. Pass 1 Default at 256KB

As documented in ADR-0007, the two-pass linker default is 256KB. The old firmware used ~74KB SRAM; the new firmware uses ~138KB due to:
- Display buffers now static (30KB) vs heap-allocated in old firmware
- pw_system overhead (~20KB for allocator, log buffer, threads)

## Consequences

**Pros:**
- Predictable memory layout at compile time
- Fast display updates with SRAM buffers
- LVGL memory is isolated and monitorable
- Const data automatically in PSRAM (fonts, tables)

**Cons:**
- 138KB static SRAM usage (29% of 476KB total)
- Limited headroom for additional static allocations

**Future Optimizations (if needed):**

1. **Move LVGL pool to PSRAM**: Define `LV_MEM_ADR` to PSRAM address (0x02xxxxxx). Saves 64KB SRAM, slight latency increase.

2. **Reduce LVGL pool size**: Currently 64KB, could reduce if UI is simple. Enable `LV_USE_MEM_MONITOR` to measure actual peak usage.

3. **Dynamic draw buffers**: Allocate via `malloc()` like old firmware. Trades 30KB SRAM for heap fragmentation risk and slight DMA setup overhead.

4. **Reduce pw_system buffers**: Tune `pw::system` buffer sizes if 20KB overhead is too high.

## References

- ADR-0007: Particle Binary Linking Strategy
- `third_party/particle/third_party/device-os/build/arm/linker/rtl872x/platform_ram.ld`
- `third_party/lvgl/src/stdlib/builtin/lv_mem_core_builtin.c` (TLSF allocator)
- TLSF paper: http://www.gii.upv.es/tlsf/
