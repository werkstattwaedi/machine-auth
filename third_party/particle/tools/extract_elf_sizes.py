#!/usr/bin/env python3
"""Extract section sizes and symbols from ELF for two-pass linking.

This tool analyzes an intermediate ELF file from the first linking pass
and generates a precise memory_platform_user.ld file for the second pass.
This matches the behavior of Particle's Make-based build_linker_script.mk.
"""

import subprocess
import argparse
import json
import sys
from pathlib import Path


def get_section_size(objdump: str, elf: str, section: str) -> int:
    """Extract section size from ELF using objdump -h.

    Args:
        objdump: Path to objdump binary
        elf: Path to ELF file
        section: Section name (e.g., ".data", ".bss")

    Returns:
        Section size in bytes, or 0 if section not found
    """
    result = subprocess.run(
        [objdump, "-h", "--section=" + section, elf],
        capture_output=True, text=True
    )
    for line in result.stdout.split('\n'):
        # Skip header lines and find the actual section line
        if section in line and not line.strip().startswith("Idx"):
            parts = line.split()
            # objdump -h output format:
            # Idx Name          Size      VMA       LMA       File off  Algn
            #   0 .text         00001234  08060000  08060000  00000034  2**2
            if len(parts) >= 3:
                try:
                    return int(parts[2], 16)
                except ValueError:
                    continue
    return 0


def get_symbol_address(objdump: str, elf: str, symbol: str) -> int:
    """Extract symbol address from ELF using objdump -t.

    Args:
        objdump: Path to objdump binary
        elf: Path to ELF file
        symbol: Symbol name to find

    Returns:
        Symbol address, or 0 if not found
    """
    result = subprocess.run([objdump, "-t", elf], capture_output=True, text=True)
    for line in result.stdout.split('\n'):
        # Symbol table format:
        # 08060000 g     O .module_start  00000000 link_module_start
        if symbol in line and not line.startswith("SYMBOL"):
            parts = line.split()
            if parts:
                try:
                    return int(parts[0], 16)
                except ValueError:
                    continue
    return 0


def align_4k(value: int) -> int:
    """Align value up to 4KB boundary."""
    return ((value + 4095) // 4096) * 4096


def align_8(value: int) -> int:
    """Align value up to 8-byte boundary with safety margin.

    Add 64 bytes slack to account for linker alignment variance between
    Pass 1 and Pass 2. The linker may align sections differently when
    the memory region size changes, causing small size differences.
    """
    return ((value + 64 + 7) // 8) * 8


def main():
    parser = argparse.ArgumentParser(
        description="Extract section sizes from ELF for two-pass linking"
    )
    parser.add_argument("--objdump", required=True,
                        help="Path to objdump binary")
    parser.add_argument("--elf", required=True,
                        help="Path to intermediate ELF file")
    parser.add_argument("--output-json", required=True,
                        help="Path to output JSON file with size info")
    parser.add_argument("--output-ld", required=True,
                        help="Path to output linker script")
    args = parser.parse_args()

    # Verify ELF exists
    if not Path(args.elf).exists():
        print(f"Error: ELF file not found: {args.elf}", file=sys.stderr)
        sys.exit(1)

    # Extract section sizes (matching build_linker_script.mk)
    data_size = get_section_size(args.objdump, args.elf, ".data")
    bss_size = get_section_size(args.objdump, args.elf, ".bss")
    psram_text = get_section_size(args.objdump, args.elf, ".psram_text")
    data_alt = get_section_size(args.objdump, args.elf, ".data_alt")
    bss_alt = get_section_size(args.objdump, args.elf, ".bss_alt")
    dynalib = get_section_size(args.objdump, args.elf, ".dynalib")

    # Extract linker symbols
    module_start = get_symbol_address(args.objdump, args.elf, "link_module_start")
    module_end = get_symbol_address(args.objdump, args.elf, "link_module_info_crc_end")
    suffix_start = get_symbol_address(args.objdump, args.elf, "link_module_info_static_start")

    # Validate we found the required symbols
    if module_start == 0 or module_end == 0:
        print("Warning: Could not find module start/end symbols", file=sys.stderr)
        print(f"  link_module_start = {hex(module_start)}", file=sys.stderr)
        print(f"  link_module_info_crc_end = {hex(module_end)}", file=sys.stderr)

    # Calculate sizes (matching build_linker_script.mk formulas)
    # Add alignment padding to account for linker section placement
    sram_size = align_8(data_size + bss_size)
    psram_size = align_8(psram_text + data_alt + bss_alt + dynalib)

    # Flash size: (module_end - module_start + 16), aligned to 4KB
    # The +16 accounts for module metadata overhead
    flash_raw = module_end - module_start + 16 if module_end > module_start else 0
    flash_size = align_4k(flash_raw) if flash_raw > 0 else 4096  # Minimum 4KB

    # Suffix size for module info
    suffix_size = module_end - suffix_start if module_end > suffix_start else 0

    # Output JSON for debugging and size reporting
    sizes = {
        "sram": {
            "used": sram_size,
            "sections": {"data": data_size, "bss": bss_size}
        },
        "psram": {
            "used": psram_size,
            "sections": {
                "psram_text": psram_text,
                "data_alt": data_alt,
                "bss_alt": bss_alt,
                "dynalib": dynalib
            }
        },
        "flash": {
            "used": flash_raw,
            "allocated": flash_size
        },
        "module": {
            "start": hex(module_start),
            "end": hex(module_end),
            "suffix_start": hex(suffix_start),
            "suffix_size": suffix_size
        }
    }

    with open(args.output_json, 'w') as f:
        json.dump(sizes, f, indent=2)

    # Output linker script (matching build_linker_script.mk output)
    ld_content = f"""/* Generated by extract_elf_sizes.py - DO NOT EDIT
 * This file is regenerated during each build based on actual section sizes.
 * See: third_party/particle/device-os/modules/shared/rtl872x/build_linker_script.mk
 */

/* Calculated memory sizes for user part */
platform_user_part_flash_size = {flash_size};
platform_user_part_static_ram_size = {sram_size};
platform_user_part_secure_ram_size = 4K;
platform_user_part_psram_size = {psram_size};

/* Enable trimmed mode for precise module boundaries (required for OTA) */
platform_user_part_trimmed = 1;
platform_module_info_suffix_size = {suffix_size};
"""

    with open(args.output_ld, 'w') as f:
        f.write(ld_content)

    # Print size report to stdout
    print(f"\n{'='*60}")
    print("PARTICLE P2 FIRMWARE SIZE REPORT")
    print(f"{'='*60}")
    print(f"Flash:  {flash_raw:>8,} bytes used, {flash_size:>8,} bytes allocated (4KB aligned)")
    print(f"SRAM:   {sram_size:>8,} bytes (.data={data_size}, .bss={bss_size})")
    print(f"PSRAM:  {psram_size:>8,} bytes (code={psram_text}, data={data_alt+bss_alt}, dynalib={dynalib})")
    print(f"Module: {hex(module_start)} - {hex(module_end)}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
