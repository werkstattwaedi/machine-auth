#!/usr/bin/env python3
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Flash Particle firmware via USB.

Replacement for flash.sh using the particle_tools Python library.

Usage:
    bazel run @particle_bazel//tools:flash_firmware -- firmware.bin
    bazel run //path/to:flash  # via particle_flash_binary macro
"""

import argparse
import logging
import os
import sys
from pathlib import Path

from tools.usb.flash import ParticleFlasher, FlashError
from tools.cli.wrapper import ParticleCli, ParticleCliError


def main():
    parser = argparse.ArgumentParser(
        description="Flash Particle firmware via USB"
    )
    parser.add_argument(
        "firmware",
        help="Path to firmware binary (.bin)",
    )
    parser.add_argument(
        "--device-timeout",
        type=float,
        default=20.0,
        help="Timeout for device detection (default: 20s)",
    )
    parser.add_argument(
        "--flash-timeout",
        type=float,
        default=120.0,
        help="Timeout for flash operation (default: 120s)",
    )
    parser.add_argument(
        "--wait-for-cloud",
        action="store_true",
        help="Wait for cloud connection after flash",
    )
    parser.add_argument(
        "--cloud-timeout",
        type=float,
        default=60.0,
        help="Timeout for cloud connection (default: 60s)",
    )
    parser.add_argument(
        "--retry",
        type=int,
        default=0,
        help="Number of retry attempts on failure (default: 0)",
    )
    parser.add_argument(
        "--device-name",
        help="Device name for cloud operations",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )

    args = parser.parse_args()

    # Configure logging
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    # Resolve firmware path
    firmware_path = args.firmware
    runfiles = os.environ.get("RUNFILES_DIR")
    if runfiles and not os.path.isabs(firmware_path):
        # Try to resolve from runfiles
        runfiles_path = os.path.join(runfiles, "_main", firmware_path)
        if os.path.exists(runfiles_path):
            firmware_path = runfiles_path

    if not os.path.exists(firmware_path):
        print(f"Error: Firmware file not found: {firmware_path}", file=sys.stderr)
        sys.exit(1)

    print(f"=== Flashing firmware: {firmware_path} ===")

    try:
        cli = ParticleCli()
        flasher = ParticleFlasher(cli=cli, device_name=args.device_name)

        if args.retry > 0:
            device = flasher.flash_with_retry(
                firmware_path,
                max_retries=args.retry,
                device_timeout=args.device_timeout,
                flash_timeout=args.flash_timeout,
            )
        elif args.wait_for_cloud:
            device = flasher.flash_and_verify(
                firmware_path,
                wait_for_cloud=True,
                cloud_timeout=args.cloud_timeout,
                device_timeout=args.device_timeout,
                flash_timeout=args.flash_timeout,
            )
        else:
            device = flasher.flash_local(
                firmware_path,
                device_timeout=args.device_timeout,
                flash_timeout=args.flash_timeout,
            )

        print("=== Flash successful ===")
        if device.port:
            print(f"Device at: {device.port}")

    except FlashError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except ParticleCliError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nAborted", file=sys.stderr)
        sys.exit(130)


if __name__ == "__main__":
    main()
