#!/usr/bin/env python3
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""On-site power probe — measure Shelly readings to pick thresholds (ADR-0054).

Polls each given Shelly component once a second and prints its watts (and a
switch's output), so a few real jobs show where idle, moving and cutting sit.
Read-only: it never switches anything.

Usage:
    bazel run //maco_gateway:probe_power -- \\
        cnc-gantry.internal:switch:0 cnc-spindle.internal:em1:0 --password …
    # or directly, from the maco_gateway/ directory:
    python3 tools/probe_power.py localhost:8101:switch:0 --seconds 60

Each target is HOST[:PORT]:COMPONENT; the component is the Gen2+ key in
Shelly.GetStatus ("switch:0", "pm1:0", "em1:0"). The password defaults to
$SHELLY_PASSWORD.
"""

import argparse
import asyncio
import os
import sys
import time

from maco_gateway.sensing.shelly import (
    ShellyDevice,
    ShellyError,
    power_w,
    switch_output,
)


def _parse_target(text: str):
    # The component itself contains a colon ("switch:0"), so split from the right.
    host, sep, rest = text.rpartition(":")
    host, sep2, kind = host.rpartition(":")
    if not sep or not sep2 or not host:
        raise argparse.ArgumentTypeError(
            f"{text!r}: want HOST[:PORT]:COMPONENT, e.g. cnc-spindle.internal:em1:0")
    return host, f"{kind}:{rest}"


async def _run(targets, password: str, seconds: int) -> None:
    devices = {host: ShellyDevice(host, password) for host, _ in targets}
    print("time      " + "  ".join(f"{h} {c}" for h, c in targets))
    try:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + seconds
        while loop.time() < deadline:
            hosts = list(devices)
            results = await asyncio.gather(
                *(devices[h].get_status() for h in hosts), return_exceptions=True)
            by_host = dict(zip(hosts, results))
            cells = []
            for host, comp in targets:
                status = by_host[host]
                if isinstance(status, BaseException):
                    cells.append(f"[{type(status).__name__}]")
                    continue
                try:
                    cell = f"{power_w(status, comp):8.1f} W"
                except ShellyError as err:
                    cell = f"[{err}]"
                output = switch_output(status, comp)
                if output is not None:
                    cell += " on " if output else " off"
                cells.append(cell)
            print(time.strftime("%H:%M:%S  ") + "  ".join(cells), flush=True)
            await asyncio.sleep(1.0)
    finally:
        for dev in devices.values():
            await dev.aclose()


def main() -> int:
    parser = argparse.ArgumentParser(description="Print live Shelly power readings")
    parser.add_argument("targets", nargs="+", type=_parse_target,
                        help="HOST[:PORT]:COMPONENT, e.g. cnc-spindle.internal:em1:0")
    parser.add_argument("--password", default=os.environ.get("SHELLY_PASSWORD", ""),
                        help="Shelly auth password (default: $SHELLY_PASSWORD; empty = none)")
    parser.add_argument("--seconds", type=int, default=3600, help="how long to watch")
    args = parser.parse_args()
    try:
        asyncio.run(_run(args.targets, args.password, args.seconds))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
