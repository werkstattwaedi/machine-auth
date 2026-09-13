#!/usr/bin/env python3
# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""xTool WS-V2 diagnostic dump — investigate cut-vs-engrave billing signals.

Connects to the laser, polls a set of instruction-channel endpoints, and dumps
every response + every unsolicited push verbatim, so we can see whether the
protocol exposes a live laser-power / `S` value, the current G-code line, feed
rate, or anything else that could distinguish cutting from engraving.

To reduce noise, repeated identical responses per endpoint are suppressed — you
only see an endpoint when its payload *changes*. Pushes are always printed.
Fields whose key hints at power/line/speed/energy are flagged with `>>>`.

Run it during a real, **mixed cut + engrave** job at the makerspace:
    bazel run //maco_gateway:laser_diag -- laser.internal
    # or, from the maco_gateway/ directory:
    python3 tools/laser_diag.py laser.internal [--seconds 180]

Then eyeball the `>>>` lines and the /processing/progress payloads.
"""

import argparse
import asyncio
import json
import sys
import time

from maco_gateway.sensing.wsv2 import WSV2Connection

PARITY_USER_KEY = "bWFrZWJsb2NrLXh0b29s"  # base64("makeblock-xtool")
PING_TXN = 65510

# Endpoints to poll. P2S-known ones first; a few F1/F2 names are included in
# case the P2S also answers them (a non-zero `code` just means "not supported"
# and is harmless).
QUERY_ENDPOINTS = [
    "/v1/device/runningStatus",   # P2S live status (curMode)
    "/v1/processing/progress",    # progress %, workingTime, current G-code line
    "/v1/device/workingInfo",     # P2S lifetime/statistics counters
    "/v1/device/alarms",          # active alarms
    "/v1/device/runtime-infos",   # F1/F2 status name — try anyway
    "/v1/device/statistics",      # F1/F2 stats name — try anyway
]

# Key substrings worth flagging when they appear anywhere in a payload.
INTERESTING = ("power", "pwm", "laser", "energy", "watt", "line", "gcode",
               "speed", "feed", "current", "duty", "s_value", "intensity")


def _flag_interesting(obj, path=""):
    """Yield 'path = value' for keys whose name hints at power/line/speed."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else k
            if any(tok in k.lower() for tok in INTERESTING) and not isinstance(v, (dict, list)):
                yield f"{p} = {v!r}"
            yield from _flag_interesting(v, p)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _flag_interesting(v, f"{path}[{i}]")


def _ts():
    return time.strftime("%H:%M:%S")


async def run(host: str, port: int, seconds: int, query_interval: float) -> None:
    conn = await WSV2Connection.connect(
        host, port, connect_id=int(time.time() * 1000), timeout=6.0)
    print(f"{_ts()} connected to {host}:{port}; sending parity handshake")
    txn = [0]

    def req(url, t=None, data=None):
        txn[0] = (txn[0] % 60000) + 1
        return {"type": "request", "method": "GET", "url": url, "params": {},
                "data": data or {}, "timestamp": int(time.time() * 1000),
                "transactionId": t if t is not None else txn[0]}

    await conn.send_json(req("/v1/user/parity",
                             data={"userID": "mk-guest",
                                   "userKey": PARITY_USER_KEY,
                                   "timezone": "Europe/Zurich"}))
    print(f"{_ts()} >>> START A MIXED CUT + ENGRAVE JOB NOW. Watching {seconds}s.\n")

    pending = {}         # txn -> url (to label responses)
    last_seen = {}       # url -> last json string (dedup)
    loop = asyncio.get_running_loop()
    deadline = loop.time() + seconds
    next_query = loop.time()
    next_ping = loop.time()

    while loop.time() < deadline:
        now = loop.time()
        if now >= next_ping:
            await conn.send_json(req("/v1/user/ping", t=PING_TXN))
            next_ping = now + 3.0
        if now >= next_query:
            for url in QUERY_ENDPOINTS:
                txn[0] = (txn[0] % 60000) + 1
                pending[txn[0]] = url
                await conn.send_json(req(url, t=txn[0]))
            next_query = now + query_interval
        wake = min(next_ping, next_query, deadline)
        while True:
            remaining = wake - loop.time()
            if remaining <= 0:
                break
            try:
                objs = await asyncio.wait_for(conn.recv_json(), timeout=remaining)
            except asyncio.TimeoutError:
                break
            for obj in objs:
                _dump(obj, pending, last_seen)
    await conn.close()
    print(f"\n{_ts()} done. Look for `>>>` flags and the /processing/progress payloads above.")


def _dump(obj, pending, last_seen):
    if not isinstance(obj, dict):
        return
    if obj.get("type") == "response":
        t = obj.get("transactionId")
        if t == PING_TXN:
            return  # heartbeat pong
        url = pending.pop(t, "?")
        data = obj.get("data")
        blob = json.dumps(data, sort_keys=True)
        if last_seen.get(url) == blob:
            return  # unchanged since last time — suppress
        last_seen[url] = blob
        code = obj.get("code")
        print(f"{_ts()} [RESP {url}] code={code} {json.dumps(data)}")
        for hit in _flag_interesting(data):
            print(f"           >>> {hit}")
    else:  # unsolicited push
        url = obj.get("url", "?")
        data = obj.get("data")
        print(f"{_ts()} [PUSH {url}] {json.dumps(data)}")
        for hit in _flag_interesting(data):
            print(f"           >>> {hit}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Dump xTool WS-V2 endpoints during a job")
    parser.add_argument("host", nargs="?", default="laser.internal")
    parser.add_argument("--port", type=int, default=28900)
    parser.add_argument("--seconds", type=int, default=180)
    parser.add_argument("--interval", type=float, default=2.0,
                        help="seconds between endpoint polls (default 2)")
    args = parser.parse_args()
    try:
        asyncio.run(run(args.host, args.port, args.seconds, args.interval))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
