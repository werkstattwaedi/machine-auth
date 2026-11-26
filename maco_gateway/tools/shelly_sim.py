#!/usr/bin/env python3
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Fake Shelly devices on localhost, for end-to-end runs with the host sim.

Each ``--device NAME:PORT:COMPONENT[,COMPONENT…]`` serves a Gen2+ RPC subset
(Shelly.GetStatus, Switch.Set, Switch.GetStatus) on 127.0.0.1:PORT. Point the
machine's ShellyEndpoint hosts at ``localhost:PORT``. Type ``NAME WATTS`` to
set a device's draw (a switch reports it only while its output is on); switch
changes from the gateway are printed.

Usage:
    bazel run //maco_gateway:shelly_sim -- \\
        --device gantry:8101:switch:0 --device spindle:8102:em1:0
    > spindle 900
    > gantry 100
    > status
"""

import argparse
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from maco_gateway.sensing.shelly_fake import FakeShelly

_lock = threading.Lock()


def _parse_device(text: str):
    name, sep, rest = text.partition(":")
    port, sep2, comps = rest.partition(":")
    if not sep or not sep2 or not port.isdigit() or not comps:
        raise argparse.ArgumentTypeError(
            f"{text!r}: want NAME:PORT:COMPONENT[,COMPONENT…], e.g. spindle:8102:em1:0")
    return name, int(port), comps.split(",")


def _serve(name: str, port: int, fake: FakeShelly) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 — http.server naming
            with _lock:
                code, headers, body = fake.handle(
                    "GET", self.path, self.headers.get("Authorization"))
            payload = json.dumps(body).encode()
            self.send_response(code)
            for k, v in headers.items():
                self.send_header(k, v)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass  # one line per 2 s poll would drown the prompt

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main() -> int:
    parser = argparse.ArgumentParser(description="Fake Shelly devices on localhost")
    parser.add_argument("--device", action="append", type=_parse_device, required=True,
                        help="NAME:PORT:COMPONENT[,COMPONENT…] (repeatable)")
    parser.add_argument("--password", default="",
                        help="require SHA-256 digest auth with this password")
    args = parser.parse_args()

    fakes = {}
    for name, port, comps in args.device:
        fake = FakeShelly(
            comps, args.password,
            on_switch=lambda comp, on, name=name: print(
                f"\n[{name}] {comp} switched {'ON' if on else 'OFF'}\n> ",
                end="", flush=True))
        _serve(name, port, fake)
        fakes[name] = fake
        print(f"  {name}: http://localhost:{port}  ({', '.join(comps)})")

    print("Commands: NAME WATTS [COMPONENT] | NAME on|off | status | quit")
    while True:
        try:
            line = input("> ").split()
        except (EOFError, KeyboardInterrupt):
            break
        if not line:
            continue
        if line[0] in ("quit", "exit"):
            break
        if line[0] == "status":
            with _lock:
                for name, fake in fakes.items():
                    print(f"  {name}: {json.dumps(fake.status())}")
            continue
        fake = fakes.get(line[0])
        if fake is None or len(line) < 2:
            print("  unknown device or missing value")
            continue
        with _lock:
            if line[1] in ("on", "off"):
                for comp in fake.output:
                    fake.output[comp] = line[1] == "on"
                print(f"  {line[0]} switched {line[1]} by hand")
                continue
            comp = line[2] if len(line) > 2 else next(iter(fake.watts))
            if comp not in fake.watts:
                print(f"  {line[0]} has no {comp}")
                continue
            try:
                fake.watts[comp] = float(line[1])
            except ValueError:
                print("  watts must be a number")
                continue
        print(f"  {line[0]} {comp} = {fake.watts[comp]} W")
    return 0


if __name__ == "__main__":
    sys.exit(main())
