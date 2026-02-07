#!/usr/bin/env python3
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Serial console monitor for Particle devices.

Connects to a Particle device's USB serial port and displays output.

Usage:
    bazel run @particle_bazel//tools:serial_monitor
"""

import argparse
import logging
import os
import sys
import time

import serial

from tools.usb.serial_port import (
    find_particle_port,
    wait_for_serial_port,
    list_particle_ports,
)


def main():
    parser = argparse.ArgumentParser(
        description="Serial console monitor for Particle devices"
    )
    parser.add_argument(
        "--port",
        help="Serial port path (auto-detects if not specified)",
    )
    parser.add_argument(
        "--baud",
        type=int,
        default=115200,
        help="Baud rate (default: 115200)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=15.0,
        help="Device detection timeout in seconds (default: 15)",
    )
    parser.add_argument(
        "--reconnect",
        action="store_true",
        help="Automatically reconnect if device disconnects",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List connected devices and exit",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )

    args = parser.parse_args()

    # Configure logging
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s: %(message)s",
    )

    # List mode
    if args.list:
        ports = list_particle_ports()
        if not ports:
            print("No Particle devices found")
            sys.exit(1)

        print("Connected Particle devices:")
        for port in ports:
            serial_num = port.serial_number or "unknown"
            print(f"  {port.port} - {port.device_type} (serial: {serial_num})")
        sys.exit(0)

    # Find or wait for device
    port = args.port
    if not port:
        print(f"Waiting for device (timeout: {args.timeout}s)...")
        port = wait_for_serial_port(timeout=args.timeout)
        if not port:
            print("Error: No Particle device found", file=sys.stderr)
            sys.exit(1)

    print(f"Connecting to {port} at {args.baud} baud...")
    print("Press Ctrl+C to exit")
    print("-" * 40)

    while True:
        try:
            with serial.Serial(port, args.baud, timeout=1) as ser:
                while True:
                    if ser.in_waiting:
                        data = ser.read(ser.in_waiting)
                        try:
                            text = data.decode("utf-8", errors="replace")
                            sys.stdout.write(text)
                            sys.stdout.flush()
                        except Exception:
                            # Fallback for binary data
                            sys.stdout.write(data.hex())
                            sys.stdout.flush()
                    else:
                        time.sleep(0.01)

        except serial.SerialException as e:
            if args.reconnect:
                print(f"\n--- Disconnected: {e} ---", file=sys.stderr)
                print("Waiting for device to reconnect...", file=sys.stderr)
                port = wait_for_serial_port(timeout=60.0)
                if port:
                    print(f"--- Reconnected at {port} ---", file=sys.stderr)
                    continue
                else:
                    print("Error: Device did not reconnect", file=sys.stderr)
                    sys.exit(1)
            else:
                print(f"\nError: {e}", file=sys.stderr)
                sys.exit(1)

        except KeyboardInterrupt:
            print("\n--- Disconnected ---")
            sys.exit(0)


if __name__ == "__main__":
    main()
