# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Analyze P2 firmware ELF memory usage and enforce budget limits.

Runs objdump to extract section headers and symbol tables, classifies
symbols by memory region (SRAM, PSRAM, Flash), prints a detailed report,
and optionally compares against a golden baseline on failure.

Usage:
    python3 memory_budget.py \
        --objdump arm-none-eabi-objdump \
        --elf firmware.elf \
        --sram-limit 100000 \
        --psram-limit 300000 \
        --flash-limit 320000 \
        --golden testdata/memory_budget.txt
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path


# P2 (RTL8721DM) memory map — address ranges for classification.
# Ranges are intentionally generous to cover all linker placements.
# SRAM:  KM4 SRAM region (user .data and .bss)
# PSRAM: External PSRAM (user code, data_alt, bss_alt)
# Flash: XIP flash region (module info, text stubs)
SRAM_START = 0x10000000
SRAM_END = 0x100FFFFF
PSRAM_START = 0x02000000
PSRAM_END = 0x03FFFFFF
FLASH_START = 0x08000000
FLASH_END = 0x08FFFFFF


def classify_address(addr):
    """Classify an address into a memory region."""
    if SRAM_START <= addr <= SRAM_END:
        return "sram"
    if PSRAM_START <= addr <= PSRAM_END:
        return "psram"
    if FLASH_START <= addr <= FLASH_END:
        return "flash"
    return None


def get_section_sizes(objdump, elf):
    """Extract section sizes and addresses from ELF headers."""
    result = subprocess.run(
        [objdump, "-h", elf], capture_output=True, text=True, check=True
    )
    sections = {}
    for line in result.stdout.split("\n"):
        parts = line.split()
        # objdump -h format:
        #  Idx Name          Size      VMA       LMA       File off  Algn
        #    0 .text         00001234  08060000  08060000  00000034  2**2
        if len(parts) >= 6 and parts[0].isdigit():
            name = parts[1]
            try:
                size = int(parts[2], 16)
                vma = int(parts[3], 16)
                lma = int(parts[4], 16)
                sections[name] = {"size": size, "vma": vma, "lma": lma}
            except ValueError:
                continue
    return sections


def get_symbols(objdump, elf):
    """Extract OBJECT symbols with demangled names from ELF."""
    result = subprocess.run(
        [objdump, "-tC", elf], capture_output=True, text=True, check=True
    )
    symbols = []
    for line in result.stdout.split("\n"):
        # Symbol table format (demangled with -C):
        # 10070000 l     O .bss   0000fa00 work_mem_int
        # 10080000 l     O .data  00000058 some_data
        parts = line.split()
        if len(parts) < 6:
            continue
        # Format: addr flags... section size name...
        # e.g.: 1006d3f0 l     O .bss   00000004 my_symbol
        # Flags span parts[1:] until the section name (starts with '.')
        try:
            addr = int(parts[0], 16)
        except ValueError:
            continue

        # Find the section name and check for 'O' (OBJECT) flag before it
        has_object_flag = False
        section_idx = None
        for i, p in enumerate(parts[1:], start=1):
            if p == "O":
                has_object_flag = True
            if p.startswith("."):
                section_idx = i
                break
        if not has_object_flag or section_idx is None:
            continue

        section = parts[section_idx]
        try:
            size = int(parts[section_idx + 1], 16)
        except (ValueError, IndexError):
            continue

        # Symbol name is everything after the size field
        name = " ".join(parts[section_idx + 2 :])
        if not name or size == 0:
            continue

        region = classify_address(addr)
        if region:
            symbols.append(
                {
                    "name": name,
                    "section": section,
                    "size": size,
                    "addr": addr,
                    "region": region,
                    "source": "",  # Will be set from object file if available
                }
            )
    return symbols


def get_symbols_with_source(objdump, elf):
    """Get symbols enriched with source object file names."""
    # First get basic symbols
    symbols = get_symbols(objdump, elf)

    # Try to get per-object source info from nm
    # Use objdump -t (without -C for raw names) to get object file info
    result = subprocess.run(
        [objdump, "-t", elf], capture_output=True, text=True, check=True
    )

    # Build a mapping from (addr, size) to source file
    addr_to_source = {}
    current_file = None
    for line in result.stdout.split("\n"):
        # Look for file markers: "path/to/file.o:     file format elf32..."
        if "file format" in line and line.strip().endswith("..."):
            continue
        if line.endswith(":") and ("/" in line or line.endswith(".o:")):
            current_file = line.rstrip(":")
            # Extract just the basename
            current_file = Path(current_file).name
            continue
        parts = line.split()
        if len(parts) >= 5:
            try:
                addr = int(parts[0], 16)
                # Find section and size
                for i, p in enumerate(parts[2:], start=2):
                    if p.startswith("."):
                        size = int(parts[i + 1], 16)
                        if current_file:
                            addr_to_source[(addr, size)] = current_file
                        break
            except (ValueError, IndexError):
                continue

    # Enrich symbols with source info
    for sym in symbols:
        key = (sym["addr"], sym["size"])
        if key in addr_to_source:
            sym["source"] = addr_to_source[key]

    return symbols


def compute_region_totals(sections):
    """Compute total SRAM, PSRAM, Flash usage from section headers.

    SRAM and PSRAM are computed from VMA (runtime address).
    Flash is computed from the LMA span of the module — the total image
    size stored in flash, including PSRAM code loaded from flash at boot.
    """
    sram_total = 0
    psram_total = 0

    sram_detail = {}
    psram_detail = {}

    # Track flash LMA range for module span calculation
    flash_lma_min = None
    flash_lma_max = None

    for name, info in sections.items():
        size = info["size"]
        vma = info["vma"]
        lma = info.get("lma", vma)
        if size == 0:
            continue

        # Skip debug/metadata sections
        if name.startswith(".debug") or name.startswith(".pw_tokenizer"):
            continue

        # SRAM and PSRAM: classify by VMA (runtime address)
        region = classify_address(vma)
        if region == "sram":
            sram_total += size
            sram_detail[name] = size
        elif region == "psram":
            psram_total += size
            psram_detail[name] = size

        # Flash: track LMA range for all ALLOC sections stored in flash
        if classify_address(lma) == "flash":
            end = lma + size
            if flash_lma_min is None or lma < flash_lma_min:
                flash_lma_min = lma
            if flash_lma_max is None or end > flash_lma_max:
                flash_lma_max = end

    flash_total = (flash_lma_max - flash_lma_min) if flash_lma_min is not None else 0

    return {
        "sram": sram_total,
        "psram": psram_total,
        "flash": flash_total,
        "sram_detail": sram_detail,
        "psram_detail": psram_detail,
    }


def make_bar(pct, width=20):
    """Create a progress bar string."""
    filled = int(pct / 100.0 * width)
    return "\u2588" * filled + "\u2591" * (width - filled)


def format_report(totals, symbols, sram_limit, psram_limit, flash_limit, min_symbol_size=512):
    """Format the memory budget report."""
    lines = []
    lines.append("PARTICLE P2 MEMORY BUDGET")
    lines.append("=" * 60)

    # Summary bars
    for label, used, limit in [
        ("SRAM", totals["sram"], sram_limit),
        ("PSRAM", totals["psram"], psram_limit),
        ("Flash", totals["flash"], flash_limit),
    ]:
        if limit > 0:
            pct = 100.0 * used / limit
            bar = make_bar(pct)
            lines.append(f"{label:>5s}: {used:>9,} / {limit:>9,} bytes ({pct:3.0f}%)  {bar}")
        else:
            lines.append(f"{label:>5s}: {used:>9,} bytes (no limit set)")

    # SRAM breakdown
    sram_symbols = [s for s in symbols if s["region"] == "sram" and s["size"] >= min_symbol_size]
    sram_symbols.sort(key=lambda s: s["size"], reverse=True)

    if sram_symbols:
        lines.append("")
        lines.append(f"SRAM breakdown (symbols > {min_symbol_size} bytes):")
        lines.append(f"  {'SIZE':>7s}   {'SECTION':<8s} {'SOURCE':<32s} SYMBOL")
        for sym in sram_symbols:
            source = sym["source"] or "(unknown)"
            lines.append(
                f"  {sym['size']:>7,}   {sym['section']:<8s} {source:<32s} {sym['name']}"
            )

        # Summary line
        data_total = totals["sram_detail"].get(".data", 0)
        bss_total = totals["sram_detail"].get(".bss", 0)
        lines.append(f"  {'─' * 5}")
        lines.append(f"  {totals['sram']:>7,}   total (.data={data_total:,}, .bss={bss_total:,})")

    lines.append("=" * 60)
    return "\n".join(lines)


def parse_golden(golden_path):
    """Parse a golden report file into a dict of symbol name → size."""
    symbols = {}
    if not golden_path or not Path(golden_path).exists():
        return symbols

    in_breakdown = False
    for line in Path(golden_path).read_text().split("\n"):
        if "SRAM breakdown" in line:
            in_breakdown = True
            continue
        if in_breakdown and line.strip().startswith("─"):
            break
        if in_breakdown and line.strip():
            parts = line.split()
            if len(parts) >= 4:
                try:
                    size = int(parts[0].replace(",", ""))
                    # Symbol name is the last part(s)
                    section = parts[1]
                    source = parts[2]
                    name = " ".join(parts[3:])
                    symbols[name] = {"size": size, "section": section, "source": source}
                except (ValueError, IndexError):
                    continue
    return symbols


def format_golden_diff(current_symbols, golden_symbols):
    """Format a diff between current and golden symbol sets."""
    lines = []
    lines.append("\nChanges since last baseline (golden):")

    all_names = set(list(current_symbols.keys()) + list(golden_symbols.keys()))

    changes = []
    for name in sorted(all_names):
        cur = current_symbols.get(name)
        old = golden_symbols.get(name)

        if cur and not old:
            changes.append(
                f"  + {cur['size']:>7,}   {cur['section']:<8s} {cur['source']:<32s} {name}    \u2190 NEW"
            )
        elif old and not cur:
            changes.append(
                f"  - {old['size']:>7,}   {old['section']:<8s} {old['source']:<32s} {name}    \u2190 REMOVED"
            )
        elif cur and old and cur["size"] != old["size"]:
            delta = cur["size"] - old["size"]
            sign = "+" if delta > 0 else ""
            changes.append(
                f"  ~ {cur['size']:>7,}   {cur['section']:<8s} {cur['source']:<32s} {name}    ({sign}{delta:,})"
            )

    if changes:
        lines.extend(changes)
    else:
        lines.append("  (no changes)")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Analyze P2 firmware ELF memory usage and enforce budget limits"
    )
    parser.add_argument("--objdump", required=True, help="Path to objdump binary")
    parser.add_argument("--elf", required=True, help="Path to ELF file")
    parser.add_argument(
        "--sram-limit", type=int, default=0, help="SRAM budget limit in bytes"
    )
    parser.add_argument(
        "--psram-limit", type=int, default=0, help="PSRAM budget limit in bytes"
    )
    parser.add_argument(
        "--flash-limit", type=int, default=0, help="Flash budget limit in bytes"
    )
    parser.add_argument(
        "--golden", default="", help="Path to golden baseline file"
    )
    args = parser.parse_args()

    # Verify ELF exists
    if not Path(args.elf).exists():
        print(f"Error: ELF file not found: {args.elf}", file=sys.stderr)
        sys.exit(1)

    # Analyze ELF
    sections = get_section_sizes(args.objdump, args.elf)
    totals = compute_region_totals(sections)
    symbols = get_symbols_with_source(args.objdump, args.elf)

    # Build current symbol dict for golden comparison
    current_sram_symbols = {}
    for sym in symbols:
        if sym["region"] == "sram" and sym["size"] >= 512:
            current_sram_symbols[sym["name"]] = {
                "size": sym["size"],
                "section": sym["section"],
                "source": sym["source"] or "(unknown)",
            }

    # Format and print report (always visible)
    report = format_report(
        totals, symbols, args.sram_limit, args.psram_limit, args.flash_limit
    )
    print(report)

    # Check if UPDATE_GOLDENS is set — write golden file
    if os.environ.get("UPDATE_GOLDENS"):
        workspace_dir = os.environ.get("BUILD_WORKSPACE_DIRECTORY", "")
        if workspace_dir and args.golden:
            golden_path = Path(workspace_dir) / args.golden
            golden_path.parent.mkdir(parents=True, exist_ok=True)
            golden_path.write_text(report + "\n")
            print(f"\nGolden updated: {golden_path}")
        elif args.golden:
            # Fallback: write relative to current dir
            golden_path = Path(args.golden)
            golden_path.parent.mkdir(parents=True, exist_ok=True)
            golden_path.write_text(report + "\n")
            print(f"\nGolden updated: {golden_path}")
        return

    # Check budget limits
    failures = []
    if args.sram_limit > 0 and totals["sram"] > args.sram_limit:
        failures.append(
            f"SRAM {totals['sram']:,} bytes exceeds budget of {args.sram_limit:,} bytes"
        )
    if args.psram_limit > 0 and totals["psram"] > args.psram_limit:
        failures.append(
            f"PSRAM {totals['psram']:,} bytes exceeds budget of {args.psram_limit:,} bytes"
        )
    if args.flash_limit > 0 and totals["flash"] > args.flash_limit:
        failures.append(
            f"Flash {totals['flash']:,} bytes exceeds budget of {args.flash_limit:,} bytes"
        )

    if failures:
        print()
        for f in failures:
            print(f"FAIL: {f}")

        # Show golden diff if available
        if args.golden and Path(args.golden).exists():
            golden_symbols = parse_golden(args.golden)
            diff = format_golden_diff(current_sram_symbols, golden_symbols)
            print(diff)
        elif args.golden:
            print(f"\n(No golden file at {args.golden} — run UPDATE_GOLDENS=1 to create)")

        sys.exit(1)
    else:
        print("\nPASS: all sections within budget")


if __name__ == "__main__":
    main()
