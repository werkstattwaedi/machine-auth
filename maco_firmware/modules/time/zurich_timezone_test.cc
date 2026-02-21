// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "maco_firmware/modules/time/zurich_timezone.h"

#include "pw_unit_test/framework.h"

namespace maco::time {
namespace {

// Helper: build a UTC Unix timestamp from date/time components.
std::time_t MakeUtc(int year, int month, int day, int hour, int min) {
  std::tm t{};
  t.tm_year = year - 1900;
  t.tm_mon = month - 1;
  t.tm_mday = day;
  t.tm_hour = hour;
  t.tm_min = min;
  t.tm_sec = 0;
  t.tm_isdst = 0;
  return timegm(&t);
}

// --- IsZurichDst ---

TEST(IsZurichDst, WinterMonthsAreCet) {
  // January 15, 2026 12:00 UTC → CET
  EXPECT_FALSE(IsZurichDst(MakeUtc(2026, 1, 15, 12, 0)));
  // February 1, 2026 00:00 UTC → CET
  EXPECT_FALSE(IsZurichDst(MakeUtc(2026, 2, 1, 0, 0)));
  // December 25, 2025 18:00 UTC → CET
  EXPECT_FALSE(IsZurichDst(MakeUtc(2025, 12, 25, 18, 0)));
}

TEST(IsZurichDst, SummerMonthsAreCest) {
  // June 15, 2026 12:00 UTC → CEST
  EXPECT_TRUE(IsZurichDst(MakeUtc(2026, 6, 15, 12, 0)));
  // August 1, 2026 00:00 UTC → CEST
  EXPECT_TRUE(IsZurichDst(MakeUtc(2026, 8, 1, 0, 0)));
}

TEST(IsZurichDst, SpringTransition2026) {
  // 2026: last Sunday of March = March 29
  // Transition at 01:00 UTC → clocks go forward to 03:00 CEST

  // March 29, 2026 00:59 UTC → still CET
  EXPECT_FALSE(IsZurichDst(MakeUtc(2026, 3, 29, 0, 59)));
  // March 29, 2026 01:00 UTC → CEST
  EXPECT_TRUE(IsZurichDst(MakeUtc(2026, 3, 29, 1, 0)));
  // March 29, 2026 02:00 UTC → CEST
  EXPECT_TRUE(IsZurichDst(MakeUtc(2026, 3, 29, 2, 0)));
}

TEST(IsZurichDst, AutumnTransition2026) {
  // 2026: last Sunday of October = October 25
  // Transition at 01:00 UTC → clocks go back to 02:00 CET

  // October 25, 2026 00:59 UTC → still CEST
  EXPECT_TRUE(IsZurichDst(MakeUtc(2026, 10, 25, 0, 59)));
  // October 25, 2026 01:00 UTC → CET
  EXPECT_FALSE(IsZurichDst(MakeUtc(2026, 10, 25, 1, 0)));
}

TEST(IsZurichDst, BeforeTransitionSundayInMarch) {
  // March 28, 2026 (Saturday before transition) → CET
  EXPECT_FALSE(IsZurichDst(MakeUtc(2026, 3, 28, 23, 0)));
}

TEST(IsZurichDst, AfterTransitionSundayInOctober) {
  // October 26, 2026 (Monday after transition) → CET
  EXPECT_FALSE(IsZurichDst(MakeUtc(2026, 10, 26, 12, 0)));
}

// --- ZurichUtcOffsetSeconds ---

TEST(ZurichUtcOffsetSeconds, CetIs3600) {
  EXPECT_EQ(ZurichUtcOffsetSeconds(MakeUtc(2026, 1, 15, 12, 0)), 3600);
}

TEST(ZurichUtcOffsetSeconds, CestIs7200) {
  EXPECT_EQ(ZurichUtcOffsetSeconds(MakeUtc(2026, 6, 15, 12, 0)), 7200);
}

// --- ToZurichLocalTime ---

TEST(ToZurichLocalTime, WinterTime) {
  // 2026-01-15 14:30 UTC → 15:30 CET
  auto lt = ToZurichLocalTime(MakeUtc(2026, 1, 15, 14, 30));
  EXPECT_EQ(lt.year, 2026);
  EXPECT_EQ(lt.month, 1);
  EXPECT_EQ(lt.day, 15);
  EXPECT_EQ(lt.hour, 15);
  EXPECT_EQ(lt.minute, 30);
}

TEST(ToZurichLocalTime, SummerTime) {
  // 2026-07-20 14:30 UTC → 16:30 CEST
  auto lt = ToZurichLocalTime(MakeUtc(2026, 7, 20, 14, 30));
  EXPECT_EQ(lt.year, 2026);
  EXPECT_EQ(lt.month, 7);
  EXPECT_EQ(lt.day, 20);
  EXPECT_EQ(lt.hour, 16);
  EXPECT_EQ(lt.minute, 30);
}

TEST(ToZurichLocalTime, MidnightCrossover) {
  // 2026-01-15 23:30 UTC → 2026-01-16 00:30 CET (next day)
  auto lt = ToZurichLocalTime(MakeUtc(2026, 1, 15, 23, 30));
  EXPECT_EQ(lt.year, 2026);
  EXPECT_EQ(lt.month, 1);
  EXPECT_EQ(lt.day, 16);
  EXPECT_EQ(lt.hour, 0);
  EXPECT_EQ(lt.minute, 30);
}

TEST(ToZurichLocalTime, SpringTransitionMoment) {
  // 2026-03-29 01:00 UTC → 03:00 CEST (skip 02:00)
  auto lt = ToZurichLocalTime(MakeUtc(2026, 3, 29, 1, 0));
  EXPECT_EQ(lt.hour, 3);
  EXPECT_EQ(lt.minute, 0);
}

TEST(ToZurichLocalTime, JustBeforeSpringTransition) {
  // 2026-03-29 00:59 UTC → 01:59 CET
  auto lt = ToZurichLocalTime(MakeUtc(2026, 3, 29, 0, 59));
  EXPECT_EQ(lt.hour, 1);
  EXPECT_EQ(lt.minute, 59);
}

TEST(ToZurichLocalTime, AutumnTransitionMoment) {
  // 2026-10-25 01:00 UTC → 02:00 CET (clocks fell back)
  auto lt = ToZurichLocalTime(MakeUtc(2026, 10, 25, 1, 0));
  EXPECT_EQ(lt.hour, 2);
  EXPECT_EQ(lt.minute, 0);
}

TEST(ToZurichLocalTime, NewYearsEveCrossover) {
  // 2025-12-31 23:30 UTC → 2026-01-01 00:30 CET
  auto lt = ToZurichLocalTime(MakeUtc(2025, 12, 31, 23, 30));
  EXPECT_EQ(lt.year, 2026);
  EXPECT_EQ(lt.month, 1);
  EXPECT_EQ(lt.day, 1);
  EXPECT_EQ(lt.hour, 0);
  EXPECT_EQ(lt.minute, 30);
}

}  // namespace
}  // namespace maco::time
