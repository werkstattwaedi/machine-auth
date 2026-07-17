# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Tests for the keep-warm pinger (ADR-0037)."""

import asyncio
import unittest
from datetime import datetime

from maco_gateway.warm import FunctionWarmer, WarmConfig, parse_warm_schedule


class _StubClient:
    def __init__(self, ok: bool = True, raises: bool = False):
        self.ok = ok
        self.raises = raises
        self.pings = 0

    async def ping(self) -> bool:
        self.pings += 1
        if self.raises:
            raise RuntimeError("boom")
        return self.ok


class ParseWarmScheduleTest(unittest.TestCase):
    def test_empty_disables(self):
        self.assertIsNone(parse_warm_schedule(""))
        self.assertIsNone(parse_warm_schedule("   "))

    def test_full_week(self):
        config = parse_warm_schedule("Mon-Sun 08-22")
        self.assertEqual(config.weekdays, set(range(1, 8)))
        self.assertEqual(config.start_hour, 8)
        self.assertEqual(config.end_hour, 22)

    def test_single_day_and_case(self):
        config = parse_warm_schedule("sat 09-18")
        self.assertEqual(config.weekdays, {6})

    def test_wrapping_day_range(self):
        config = parse_warm_schedule("Sat-Tue 08-22")
        self.assertEqual(config.weekdays, {6, 7, 1, 2})

    def test_rejects_garbage(self):
        for spec in [
            "whenever",
            "Mon-Sun",
            "Mon-Sun 22-08",
            "Mon-Sun 0-25",
            "Frey-Sun 08-22",
            "Mon-Sun aa-bb",
        ]:
            with self.assertRaises(ValueError, msg=spec):
                parse_warm_schedule(spec)


class FunctionWarmerTest(unittest.TestCase):
    CONFIG = WarmConfig(weekdays={1, 2, 3, 4, 5}, start_hour=8, end_hour=18)

    def _tick(self, warmer: FunctionWarmer) -> None:
        asyncio.run(warmer.tick())

    def test_pings_inside_window(self):
        client = _StubClient()
        # Wednesday 2026-07-15 10:00 local.
        warmer = FunctionWarmer(
            client, self.CONFIG, now=lambda: datetime(2026, 7, 15, 10, 0)
        )
        self._tick(warmer)
        self.assertEqual(client.pings, 1)

    def test_no_ping_outside_hours(self):
        client = _StubClient()
        warmer = FunctionWarmer(
            client, self.CONFIG, now=lambda: datetime(2026, 7, 15, 22, 0)
        )
        self._tick(warmer)
        self.assertEqual(client.pings, 0)

    def test_no_ping_outside_weekdays(self):
        client = _StubClient()
        # Sunday 2026-07-19.
        warmer = FunctionWarmer(
            client, self.CONFIG, now=lambda: datetime(2026, 7, 19, 10, 0)
        )
        self._tick(warmer)
        self.assertEqual(client.pings, 0)

    def test_end_hour_exclusive(self):
        client = _StubClient()
        warmer = FunctionWarmer(
            client, self.CONFIG, now=lambda: datetime(2026, 7, 15, 18, 0)
        )
        self._tick(warmer)
        self.assertEqual(client.pings, 0)

    def test_failed_ping_does_not_raise(self):
        client = _StubClient(ok=False)
        warmer = FunctionWarmer(
            client, self.CONFIG, now=lambda: datetime(2026, 7, 15, 10, 0)
        )
        self._tick(warmer)  # must not raise
        self.assertEqual(client.pings, 1)


if __name__ == "__main__":
    unittest.main()
