#!/usr/bin/env python3
"""Analyze ELF memory layout for Particle P2 firmware debugging.

Dumps section VMAs (runtime addresses), LMAs (flash storage addresses),
and sizes to help diagnose Bus Fault crashes during module_user_pre_init().

Usage:
    python3 tools/elf_memory_analysis.py --objdump <path> --elf <path>
    python3 tools/elf_memory_analysis.py --objdump <path> --elf1 <good> --elf2 <bad>
"""

import subprocess
import argparse
import sys
import json
from dataclasses import dataclass


@dataclass
class Section:
    name: str
    size: int
    vma: int
    lma: int
    file_off: int
    align: int


@dataclass
class Symbol:
    name: str
    address: int
    section: str


# P2 memory regions (from platform_ram.ld / platform_flash.ld)
PSRAM_START = 0x02000000
PSRAM_END = 0x02400000
SRAM_START = 0x10005000
SRAM_END = 0x1007F000  # includes backup RAM + secure stack
SRAM_USER_END = 0x1007B000  # backup RAM starts here
FLASH_START = 0x08000000
FLASH_END = 0x08800000
USER_FLASH_END = 0x08600000  # reserved FS starts here
SYSTEM_PART1_END = 0x081E0000  # system part 1 = 1536K from 0x08060000


def get_sections(objdump: str, elf: str) -> list[Section]:
    """Extract all sections from ELF."""
    result = subprocess.run(
        [objdump, "-h", elf], capture_output=True, text=True
    )
    sections = []
    for line in result.stdout.split('\n'):
        parts = line.split()
        if len(parts) >= 7 and parts[0].isdigit():
            try:
                sections.append(Section(
                    name=parts[1],
                    size=int(parts[2], 16),
                    vma=int(parts[3], 16),
                    lma=int(parts[4], 16),
                    file_off=int(parts[5], 16),
                    align=int(parts[6].replace("2**", "")) if "2**" in parts[6] else 0,
                ))
            except (ValueError, IndexError):
                continue
    return sections


def get_symbols(objdump: str, elf: str, names: list[str]) -> dict[str, Symbol]:
    """Extract specific symbols from ELF."""
    result = subprocess.run(
        [objdump, "-t", elf], capture_output=True, text=True
    )
    symbols = {}
    for line in result.stdout.split('\n'):
        for name in names:
            if name in line and not line.startswith("SYMBOL"):
                parts = line.split()
                if len(parts) >= 2:
                    try:
                        addr = int(parts[0], 16)
                        # Find section name (usually field 3)
                        sect = parts[3] if len(parts) > 3 else "?"
                        symbols[name] = Symbol(name=name, address=addr, section=sect)
                    except (ValueError, IndexError):
                        continue
    return symbols


def region_name(addr: int) -> str:
    """Identify which memory region an address belongs to."""
    if PSRAM_START <= addr < PSRAM_END:
        return "PSRAM"
    elif SRAM_START <= addr < SRAM_END:
        return "SRAM"
    elif FLASH_START <= addr < FLASH_END:
        return "FLASH"
    elif addr == 0:
        return "(zero)"
    else:
        return f"INVALID(0x{addr:08X})"


def analyze_elf(objdump: str, elf: str, label: str = ""):
    """Full analysis of one ELF file."""
    if label:
        print(f"\n{'='*70}")
        print(f"  {label}")
        print(f"{'='*70}")

    sections = get_sections(objdump, elf)

    # Key linker symbols used by module_user_pre_init()
    key_symbols = [
        "link_global_data_initial_values",  # .data source (flash LMA)
        "link_global_data_start",            # .data dest (SRAM VMA)
        "link_global_data_end",
        "link_bss_location",                 # .bss start (SRAM)
        "link_bss_end",
        "link_dynalib_flash_start",          # .dynalib source (flash LMA)
        "link_dynalib_start",                # .dynalib dest (PSRAM VMA)
        "link_dynalib_end",
        "link_psram_code_flash_start",       # .psram_text source (flash LMA)
        "link_psram_code_start",             # .psram_text dest (PSRAM VMA)
        "link_psram_code_end",
        "link_constructors_location",
        "link_constructors_end",
        "link_module_start",
        "link_module_info_crc_end",
        "link_module_info_static_start",
        "platform_user_part_flash_start",
        "platform_user_part_psram_start",
        "platform_user_part_static_ram_start",
    ]
    symbols = get_symbols(objdump, elf, key_symbols)

    # Section table
    print(f"\n--- Sections ---")
    print(f"{'Name':<25} {'Size':>10} {'VMA':>12} {'LMA':>12} {'Region VMA':<10} {'Region LMA':<10}")
    print("-" * 85)
    for s in sections:
        if s.size > 0:
            print(f"{s.name:<25} {s.size:>10,} {s.vma:>#12x} {s.lma:>#12x} {region_name(s.vma):<10} {region_name(s.lma):<10}")

    # Memory usage summary
    psram_sections = [s for s in sections if PSRAM_START <= s.vma < PSRAM_END and s.size > 0]
    sram_sections = [s for s in sections if SRAM_START <= s.vma < SRAM_END and s.size > 0]
    flash_sections = [s for s in sections if FLASH_START <= s.vma < FLASH_END and s.size > 0]

    print(f"\n--- Memory Usage ---")
    if psram_sections:
        psram_min = min(s.vma for s in psram_sections)
        psram_max = max(s.vma + s.size for s in psram_sections)
        psram_total = sum(s.size for s in psram_sections)
        print(f"PSRAM:  {psram_total:>10,} bytes  range: 0x{psram_min:08X} - 0x{psram_max:08X}  ({psram_max - psram_min:,} span)")
        print(f"        Available: 0x{PSRAM_START:08X} - 0x{PSRAM_END:08X} (4MB)")
        if psram_min < PSRAM_START or psram_max > PSRAM_END:
            print(f"  *** PSRAM OUT OF BOUNDS! ***")

    if sram_sections:
        sram_min = min(s.vma for s in sram_sections)
        sram_max = max(s.vma + s.size for s in sram_sections)
        sram_total = sum(s.size for s in sram_sections)
        print(f"SRAM:   {sram_total:>10,} bytes  range: 0x{sram_min:08X} - 0x{sram_max:08X}  ({sram_max - sram_min:,} span)")
        print(f"        Available: 0x{SRAM_START:08X} - 0x{SRAM_USER_END:08X} (464KB for user)")
        if sram_min < SRAM_START or sram_max > SRAM_USER_END:
            print(f"  *** SRAM OUT OF BOUNDS! ***")

    if flash_sections:
        flash_min = min(s.vma for s in flash_sections)
        flash_max = max(s.vma + s.size for s in flash_sections)
        flash_total = sum(s.size for s in flash_sections)
        print(f"FLASH:  {flash_total:>10,} bytes  range: 0x{flash_min:08X} - 0x{flash_max:08X}  ({flash_max - flash_min:,} span)")
        if flash_min < SYSTEM_PART1_END:
            print(f"  *** FLASH OVERLAPS SYSTEM PART 1! ***")

    # Key symbols analysis
    print(f"\n--- Linker Symbols (module_user_pre_init addresses) ---")
    for name in key_symbols:
        if name in symbols:
            s = symbols[name]
            print(f"  {name:<45} = 0x{s.address:08X}  [{region_name(s.address)}]")

    # Validate memcpy operations
    print(f"\n--- module_user_pre_init() Operations ---")

    # .data copy: flash → SRAM
    if "link_global_data_start" in symbols and "link_global_data_end" in symbols:
        data_start = symbols["link_global_data_start"].address
        data_end = symbols["link_global_data_end"].address
        data_size = data_end - data_start
        src = symbols.get("link_global_data_initial_values")
        print(f"  memcpy(.data):  src=0x{src.address:08X} [{region_name(src.address)}] → "
              f"dst=0x{data_start:08X} [{region_name(data_start)}]  size={data_size:,}")
        if src and region_name(src.address) != "FLASH":
            print(f"    *** .data source NOT in FLASH! ***")
        if region_name(data_start) != "SRAM":
            print(f"    *** .data dest NOT in SRAM! ***")

    # .bss zero: SRAM
    if "link_bss_location" in symbols and "link_bss_end" in symbols:
        bss_start = symbols["link_bss_location"].address
        bss_end = symbols["link_bss_end"].address
        bss_size = bss_end - bss_start
        print(f"  memset(.bss):   dst=0x{bss_start:08X} [{region_name(bss_start)}]  size={bss_size:,}")
        if region_name(bss_start) != "SRAM":
            print(f"    *** .bss NOT in SRAM! ***")
        if bss_start + bss_size > SRAM_USER_END:
            print(f"    *** .bss OVERFLOWS SRAM! end=0x{bss_start+bss_size:08X} > 0x{SRAM_USER_END:08X} ***")

    # .dynalib copy: flash → PSRAM
    if "link_dynalib_start" in symbols and "link_dynalib_end" in symbols:
        dyn_start = symbols["link_dynalib_start"].address
        dyn_end = symbols["link_dynalib_end"].address
        dyn_size = dyn_end - dyn_start
        src = symbols.get("link_dynalib_flash_start")
        print(f"  memcpy(.dynalib): src=0x{src.address:08X} [{region_name(src.address)}] → "
              f"dst=0x{dyn_start:08X} [{region_name(dyn_start)}]  size={dyn_size:,}")
        if src and region_name(src.address) != "FLASH":
            print(f"    *** .dynalib source NOT in FLASH! ***")
        if region_name(dyn_start) != "PSRAM":
            print(f"    *** .dynalib dest NOT in PSRAM! ***")

    # .psram_text copy: flash → PSRAM
    if "link_psram_code_start" in symbols and "link_psram_code_end" in symbols:
        psram_start = symbols["link_psram_code_start"].address
        psram_end_addr = symbols["link_psram_code_end"].address
        psram_size = psram_end_addr - psram_start
        src = symbols.get("link_psram_code_flash_start")
        print(f"  memcpy(.psram): src=0x{src.address:08X} [{region_name(src.address)}] → "
              f"dst=0x{psram_start:08X} [{region_name(psram_start)}]  size={psram_size:,}")
        if src and region_name(src.address) != "FLASH":
            print(f"    *** .psram_text source NOT in FLASH! ***")
        if region_name(psram_start) != "PSRAM":
            print(f"    *** .psram_text dest NOT in PSRAM! ***")
        if psram_start + psram_size > PSRAM_END:
            print(f"    *** .psram_text OVERFLOWS PSRAM! end=0x{psram_start+psram_size:08X} > 0x{PSRAM_END:08X} ***")

    # Check flash source bounds
    if "link_module_start" in symbols and "link_module_info_crc_end" in symbols:
        mod_start = symbols["link_module_start"].address
        mod_end = symbols["link_module_info_crc_end"].address
        print(f"\n  Module flash: 0x{mod_start:08X} - 0x{mod_end:08X}  ({mod_end - mod_start:,} bytes)")

        # Check if PSRAM code flash source is within module bounds
        if "link_psram_code_flash_start" in symbols:
            psram_flash = symbols["link_psram_code_flash_start"].address
            psram_size_val = (symbols["link_psram_code_end"].address -
                             symbols["link_psram_code_start"].address)
            psram_flash_end = psram_flash + psram_size_val
            if psram_flash_end > mod_end:
                print(f"    *** .psram_text flash source EXCEEDS module! "
                      f"0x{psram_flash:08X}+{psram_size_val:,} = 0x{psram_flash_end:08X} > 0x{mod_end:08X} ***")
            else:
                print(f"    .psram_text flash: 0x{psram_flash:08X} - 0x{psram_flash_end:08X}  (within module ✓)")

    # Constructors
    if "link_constructors_location" in symbols and "link_constructors_end" in symbols:
        ctor_start = symbols["link_constructors_location"].address
        ctor_end = symbols["link_constructors_end"].address
        ctor_count = (ctor_end - ctor_start) // 4
        print(f"\n  Constructors: {ctor_count} entries at 0x{ctor_start:08X} [{region_name(ctor_start)}]")

    return sections, symbols


def main():
    parser = argparse.ArgumentParser(
        description="Analyze P2 firmware ELF memory layout"
    )
    parser.add_argument("--objdump", required=True, help="Path to objdump")
    parser.add_argument("--elf", help="Single ELF to analyze")
    parser.add_argument("--elf1", help="First ELF (good/non-crashing)")
    parser.add_argument("--elf2", help="Second ELF (bad/crashing)")
    args = parser.parse_args()

    if args.elf:
        analyze_elf(args.objdump, args.elf, label=args.elf)
    elif args.elf1 and args.elf2:
        analyze_elf(args.objdump, args.elf1, label=f"GOOD: {args.elf1}")
        analyze_elf(args.objdump, args.elf2, label=f"BAD:  {args.elf2}")
    else:
        print("Provide --elf for single analysis or --elf1/--elf2 for comparison")
        sys.exit(1)


if __name__ == "__main__":
    main()
