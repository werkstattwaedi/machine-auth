#!/usr/bin/env python3
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""On-site laser probe — validate the xTool WS-V2 sensing backend live.

Connects the real ``XToolLaserBackend`` to a laser over TLS and prints its
``SensingState`` each second. Start a cut and watch it flip to RUNNING. This is
the fastest way to re-confirm the protocol at the makerspace, independent of the
firmware / gateway RPC path.

Usage:
    bazel run //maco_gateway:probe_laser -- laser.internal
    # or directly, from the maco_gateway/ directory:
    python3 tools/probe_laser.py laser.internal [--port 28900] [--seconds 120]
"""

import argparse
import asyncio
import sys

from maco_gateway.sensing.backends import XToolLaserBackend


async def _run(host: str, port: int, seconds: int) -> None:
    backend = XToolLaserBackend(host, port)
    print(f"Connecting xTool backend to {host}:{backend._port} … "
          f"(watching {seconds}s; start a cut to see RUNNING)")
    await backend.start()
    try:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + seconds
        last = None
        while loop.time() < deadline:
            state = backend.state()
            if state != last:
                last = state
                mark = "🔴 CUTTING" if state.name == "RUNNING" else state.name
                print(f"  state = {mark}")
            await asyncio.sleep(1.0)
    finally:
        await backend.stop()


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe an xTool laser's live sensing state")
    parser.add_argument("host", nargs="?", default="laser.internal",
                        help="laser hostname/IP (default: laser.internal)")
    parser.add_argument("--port", type=int, default=0, help="laser port (default 28900)")
    parser.add_argument("--seconds", type=int, default=120, help="how long to watch")
    args = parser.parse_args()
    try:
        asyncio.run(_run(args.host, args.port, args.seconds))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
