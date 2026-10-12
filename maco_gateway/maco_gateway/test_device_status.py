# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Tests for the heartbeat + terminal status reporter (ADR-0045)."""

import asyncio
import tempfile
import unittest
from pathlib import Path

from maco_gateway.device_status import (
    HEARTBEAT_INTERVAL_S,
    MIN_URGENT_GAP_S,
    OFFLINE_AFTER_S,
    DeviceStatusReporter,
    default_gateway_id,
    read_version,
    valid_gateway_id,
)

DEVICE = bytes.fromhex("0a10aced202194944a042f04")


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class _StubClient:
    def __init__(self, ok: bool = True) -> None:
        self.ok = ok
        self.reports = []

    async def post_device_status(self, report: dict) -> bool:
        self.reports.append(report)
        return self.ok


class ReporterTest(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = _Clock()
        self.client = _StubClient()
        self.reporter = DeviceStatusReporter(self.client, "workshop", "2026.10.3", clock=self.clock)

    def tick(self) -> None:
        asyncio.run(self.reporter.tick())

    def ping(self, uptime_ms: int = 60_000, version: str = "2026.10.3") -> None:
        self.reporter.on_ping(DEVICE, version=version, uptime_ms=uptime_ms, reset_reason=3, boot_count=1)

    def advance(self, seconds: float) -> None:
        self.clock.now += seconds

    def test_reports_at_start_then_every_five_minutes(self):
        self.tick()
        self.assertEqual(len(self.client.reports), 1)
        self.advance(HEARTBEAT_INTERVAL_S - 1)
        self.tick()
        self.assertEqual(len(self.client.reports), 1)
        self.advance(1)
        self.tick()
        self.assertEqual(len(self.client.reports), 2)

    def test_payload_carries_gateway_and_terminal_status(self):
        self.advance(10)
        self.ping()
        self.advance(2)
        report = self.reporter.payload()
        self.assertEqual(report["gateway"], {"id": "workshop", "version": "2026.10.3", "uptimeMs": 12_000})
        self.assertEqual(
            report["terminals"],
            [
                {
                    "deviceId": DEVICE.hex(),
                    "version": "2026.10.3",
                    "online": True,
                    "uptimeMs": 60_000,
                    "lastPingAgoMs": 2_000,
                    "resetReason": 3,
                    "bootCount": 1,
                }
            ],
        )

    def test_a_new_terminal_is_reported_without_waiting_for_the_heartbeat(self):
        self.tick()
        self.advance(MIN_URGENT_GAP_S)
        self.ping()
        self.tick()
        self.assertEqual(len(self.client.reports), 2)

    def test_a_silent_terminal_goes_offline_and_is_reported_at_once(self):
        self.ping()
        self.tick()
        self.advance(OFFLINE_AFTER_S + 1)
        self.tick()
        self.assertEqual(len(self.client.reports), 2)
        self.assertFalse(self.client.reports[-1]["terminals"][0]["online"])

    def test_a_reboot_is_reported_at_once(self):
        self.ping(uptime_ms=600_000)
        self.tick()
        self.advance(MIN_URGENT_GAP_S)
        self.ping(uptime_ms=5_000)
        self.tick()
        self.assertEqual(len(self.client.reports), 2)

    def test_steady_pings_dont_trigger_extra_reports(self):
        self.ping(uptime_ms=60_000)
        self.tick()
        for i in range(1, 10):
            self.advance(15)
            self.ping(uptime_ms=60_000 + i * 15_000)
            self.tick()
        self.assertEqual(len(self.client.reports), 1)

    def test_extra_reports_are_spaced_out(self):
        # A crash-looping terminal must not flood the function.
        self.tick()
        for _ in range(10):
            self.advance(5)
            self.ping(uptime_ms=1_000)  # rebooted again
            self.tick()
        self.assertLessEqual(len(self.client.reports), 1 + int(50 / MIN_URGENT_GAP_S) + 1)

    def test_a_failed_report_is_retried_and_never_raises(self):
        self.client.ok = False
        self.ping()
        self.tick()
        self.advance(MIN_URGENT_GAP_S)
        self.tick()  # still urgent: retried
        self.assertEqual(len(self.client.reports), 2)

    def test_old_firmware_fields_are_reported_as_unknown(self):
        self.reporter.on_ping(DEVICE, version="", uptime_ms=0, reset_reason=0, boot_count=0)
        t = self.reporter.payload()["terminals"][0]
        self.assertEqual((t["version"], t["uptimeMs"], t["resetReason"], t["bootCount"]), (None, None, None, None))


class HelpersTest(unittest.TestCase):
    def test_version_file(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "VERSION"
            self.assertEqual(read_version(path), "dev")
            path.write_text("2026.10.3\n")
            self.assertEqual(read_version(path), "2026.10.3")

    def test_gateway_ids(self):
        self.assertTrue(valid_gateway_id(default_gateway_id()))
        self.assertTrue(valid_gateway_id("maco-gateway"))
        self.assertFalse(valid_gateway_id("../users"))
        self.assertFalse(valid_gateway_id("Workshop"))


if __name__ == "__main__":
    unittest.main()
