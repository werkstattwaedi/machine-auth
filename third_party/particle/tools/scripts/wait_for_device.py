#!/usr/bin/env python3
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Wait for a Particle device to appear on USB.

Replacement for wait_for_device.sh using the particle_tools Python library.

Usage:
    bazel run @particle_bazel//tools:wait_for_device
"""

import argparse
import logging
import os
import sys

from tools.usb.serial_port import (
    wait_for_serial_port,
    list_particle_ports,
)


def main():
    parser = argparse.ArgumentParser(
        description="Wait for a Particle device to appear on USB"
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=15.0,
        help="Maximum time to wait in seconds (default: 15)",
    )
    parser.add_argument(
        "--serial",
        help="Wait for device with specific USB serial number",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List currently connected devices and exit",
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
        format="%(message)s",
    )

    # List mode
    if args.list:
        ports = list_particle_ports()
        if not ports:
            print("No Particle devices found")
            sys.exit(1)

        print("Connected Particle devices:")
        for port in ports:
            serial = port.serial_number or "unknown"
            print(f"  {port.port} - {port.device_type} (serial: {serial})")
        sys.exit(0)

    # Wait mode
    print(f"Waiting for Particle device (timeout: {args.timeout}s)...")

    port = wait_for_serial_port(
        timeout=args.timeout,
        serial_number=args.serial,
    )

    if port:
        print(f"Device found at {port}")
        sys.exit(0)
    else:
        print(f"Error: Device did not appear within {args.timeout}s", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
