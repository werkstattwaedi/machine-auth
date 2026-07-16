// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the stale-checkout reminder decision logic (#531).
 *
 * These pin the two pure pieces the cron leans on:
 *   - `parseReminderOffsets` — config parsing (sorted, de-duped, fail-loud).
 *   - `selectDueReminderOffset` — which reminder is due, derived purely from
 *     stale-age + the `remindersSent` history, so the cadence is config-only
 *     and a same-day re-run is a no-op.
 *   - `buildCheckoutReminderLink` — the `/checkout/<id>` deep link.
 */

import { expect } from "chai";
import { HttpsError } from "firebase-functions/v2/https";
import {
  parseReminderOffsets,
  selectDueReminderOffset,
  buildCheckoutReminderLink,
} from "./stale_checkout_reminders";

// A checkout opened at 18:00 Zurich on 2026-06-01. `now` values below are
// chosen to land N whole business days later (03:00 boundary).
const CREATED = new Date("2026-06-01T16:00:00Z"); // 18:00 Zurich 06-01

/** 18:00 Zurich on 2026-06-(01+days). */
function nowDaysLater(days: number): Date {
  const d = new Date(CREATED);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

const OFFSETS = [1, 7];

describe("parseReminderOffsets", () => {
  it("parses, sorts, and de-dups a comma list", () => {
    expect(parseReminderOffsets("7, 1, 7")).to.deep.equal([1, 7]);
  });

  it("accepts the default single-day cadence", () => {
    expect(parseReminderOffsets("1")).to.deep.equal([1]);
  });

  it("throws on a non-positive-integer entry", () => {
    expect(() => parseReminderOffsets("1,0")).to.throw(HttpsError);
    expect(() => parseReminderOffsets("1,-2")).to.throw(HttpsError);
    expect(() => parseReminderOffsets("1,x")).to.throw(HttpsError);
    expect(() => parseReminderOffsets("1.5")).to.throw(HttpsError);
  });

  it("throws when empty", () => {
    expect(() => parseReminderOffsets("")).to.throw(HttpsError);
    expect(() => parseReminderOffsets("  ,  ")).to.throw(HttpsError);
  });
});

describe("selectDueReminderOffset", () => {
  it("returns null before the checkout is even one business day stale", () => {
    expect(
      selectDueReminderOffset({
        now: nowDaysLater(0),
        created: CREATED,
        remindersSent: [],
        offsets: OFFSETS,
      }),
    ).to.equal(null);
  });

  it("fires the first offset once the checkout is 1 business day stale", () => {
    expect(
      selectDueReminderOffset({
        now: nowDaysLater(1),
        created: CREATED,
        remindersSent: [],
        offsets: OFFSETS,
      }),
    ).to.equal(1);
  });

  it("is a no-op on a same-business-day re-run (already reminded today)", () => {
    const now = nowDaysLater(1);
    expect(
      selectDueReminderOffset({
        now,
        created: CREATED,
        remindersSent: [now], // stamped earlier in this same run/day
        offsets: OFFSETS,
      }),
    ).to.equal(null);
  });

  it("does not fire the second offset until its threshold is reached", () => {
    // Day 3: first reminder already sent (on day 1), second offset is 7.
    expect(
      selectDueReminderOffset({
        now: nowDaysLater(3),
        created: CREATED,
        remindersSent: [nowDaysLater(1)],
        offsets: OFFSETS,
      }),
    ).to.equal(null);
  });

  it("fires the second offset once its threshold is reached", () => {
    expect(
      selectDueReminderOffset({
        now: nowDaysLater(7),
        created: CREATED,
        remindersSent: [nowDaysLater(1)],
        offsets: OFFSETS,
      }),
    ).to.equal(7);
  });

  it("fires at most one reminder per run even when jumping past offset 7", () => {
    // A checkout that never got a day-1 reminder and is now 7 days stale:
    // this run fires the *first* offset only; the next day's run fires the
    // second. Ordered, never double-sent in one pass.
    expect(
      selectDueReminderOffset({
        now: nowDaysLater(7),
        created: CREATED,
        remindersSent: [],
        offsets: OFFSETS,
      }),
    ).to.equal(1);
  });

  it("returns null once every configured offset has been sent", () => {
    expect(
      selectDueReminderOffset({
        now: nowDaysLater(30),
        created: CREATED,
        remindersSent: [nowDaysLater(1), nowDaysLater(7)],
        offsets: OFFSETS,
      }),
    ).to.equal(null);
  });
});

describe("buildCheckoutReminderLink", () => {
  it("builds the /checkout/<id> deep link", () => {
    expect(
      buildCheckoutReminderLink("checkout.werkstattwaedi.ch", "co123"),
    ).to.equal("https://checkout.werkstattwaedi.ch/checkout/co123");
  });
});
