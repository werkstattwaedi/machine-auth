# Copyright Offene Werkstatt Wädenswil
# SPDX-License-Identifier: MIT

"""Keep-warm pinger for the Firebase `api` function (ADR-0037).

Cloud Run function instances idle out ~15 minutes after their last request,
so the first tag check-in of the day pays a cold start. During workshop
opening hours the gateway pings the (otherwise no-op) /api/ping route every
few minutes so the instance is warm when a visitor badges in.

The schedule is a simple weekly window (`WARM_SCHEDULE`, e.g.
"Mon-Sun 08-22"); vacations are deliberately not modeled — pings are
effectively free, and when the workshop Pi is off they stop anyway.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Callable, Optional, Set

if TYPE_CHECKING:
    from .firebase_client import FirebaseClient

logger = logging.getLogger(__name__)

# Ping cadence inside the window. Instances stay warm noticeably longer
# than this, so one lost ping doesn't cool the instance.
DEFAULT_INTERVAL_S = 600

_WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


@dataclass
class WarmConfig:
    """Weekly warm window: ISO weekdays (1=Mon..7=Sun) and local hours."""

    weekdays: Set[int]
    start_hour: int  # inclusive, local time
    end_hour: int  # exclusive, local time
    interval_s: int = DEFAULT_INTERVAL_S

    def in_window(self, now: datetime) -> bool:
        return (
            now.isoweekday() in self.weekdays
            and self.start_hour <= now.hour < self.end_hour
        )


def parse_warm_schedule(spec: str) -> Optional[WarmConfig]:
    """Parse a "Mon-Sun 08-22" style schedule; empty/None disables warming.

    Grammar: "<Day>[-<Day>] <HH>-<HH>" with day names Mon..Sun (case
    insensitive) and hours 0..24 (end exclusive). Day ranges wrap
    (e.g. "Sat-Tue"). Raises ValueError on malformed input so a typo in the
    env config fails loudly at startup instead of silently never warming.
    """
    if not spec or not spec.strip():
        return None
    parts = spec.strip().split()
    if len(parts) != 2:
        raise ValueError(f"Invalid WARM_SCHEDULE {spec!r}: expected 'Days HH-HH'")
    days_part, hours_part = parts

    def day_index(name: str) -> int:
        try:
            return _WEEKDAYS.index(name.lower()) + 1
        except ValueError:
            raise ValueError(
                f"Invalid WARM_SCHEDULE {spec!r}: unknown day {name!r}"
            ) from None

    if "-" in days_part:
        start_name, end_name = days_part.split("-", 1)
        start, end = day_index(start_name), day_index(end_name)
        if start <= end:
            weekdays = set(range(start, end + 1))
        else:  # wrap around the week, e.g. Sat-Tue
            weekdays = set(range(start, 8)) | set(range(1, end + 1))
    else:
        weekdays = {day_index(days_part)}

    hour_bounds = hours_part.split("-", 1)
    if len(hour_bounds) != 2:
        raise ValueError(f"Invalid WARM_SCHEDULE {spec!r}: expected hours 'HH-HH'")
    try:
        start_hour, end_hour = int(hour_bounds[0]), int(hour_bounds[1])
    except ValueError:
        raise ValueError(
            f"Invalid WARM_SCHEDULE {spec!r}: hours must be integers"
        ) from None
    if not (0 <= start_hour < end_hour <= 24):
        raise ValueError(
            f"Invalid WARM_SCHEDULE {spec!r}: need 0 <= start < end <= 24"
        )

    return WarmConfig(weekdays=weekdays, start_hour=start_hour, end_hour=end_hour)


class FunctionWarmer:
    """Background task pinging /api/ping inside the configured window."""

    def __init__(
        self,
        client: "FirebaseClient",
        config: WarmConfig,
        now: Callable[[], datetime] = datetime.now,
    ) -> None:
        self._client = client
        self._config = config
        self._now = now
        # Log a warm failure once per streak, not every tick.
        self._last_ok: Optional[bool] = None

    async def tick(self) -> None:
        """One scheduling step: ping if the local time is inside the window."""
        if not self._config.in_window(self._now()):
            return
        ok = await self._client.ping()
        if ok and self._last_ok is not True:
            logger.info("warm: api ping ok")
        elif not ok and self._last_ok is not False:
            logger.warning("warm: api ping failed (will keep retrying)")
        self._last_ok = ok

    async def run(self) -> None:
        logger.info(
            "warm: pinger started (interval %ds)", self._config.interval_s
        )
        while True:
            await self.tick()
            await asyncio.sleep(self._config.interval_s)
