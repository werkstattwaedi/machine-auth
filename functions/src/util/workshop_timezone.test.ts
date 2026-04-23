// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import {
  formatWorkshopDateTime,
  getWorkshopTimezone,
} from "./workshop_timezone";

describe("Workshop Timezone Formatting", () => {
  beforeEach(() => {
    // Ensure each test starts from a clean slate so the default
    // timezone (Europe/Zurich) is exercised unless overridden.
    delete process.env.WORKSHOP_TIMEZONE;
  });

  afterEach(() => {
    delete process.env.WORKSHOP_TIMEZONE;
  });

  describe("formatWorkshopDateTime", () => {
    it("renders UTC timestamps in Zurich summer time (CEST) by default", () => {
      // 23:30 UTC on 15 Jul 2025 = 01:30 local on 16 Jul 2025 (UTC+2).
      // Exercises both the hour shift and the day rollover that are
      // the symptoms of the invoice email bug.
      const utc = new Date("2025-07-15T23:30:00Z");
      expect(formatWorkshopDateTime(utc, "dd.MM.yyyy HH:mm")).to.equal(
        "16.07.2025 01:30",
      );
    });

    it("renders UTC timestamps in Zurich winter time (CET) by default", () => {
      // 23:30 UTC on 15 Jan 2025 = 00:30 local on 16 Jan 2025 (UTC+1).
      const utc = new Date("2025-01-15T23:30:00Z");
      expect(formatWorkshopDateTime(utc, "dd.MM.yyyy HH:mm")).to.equal(
        "16.01.2025 00:30",
      );
    });

    it("uses German month names for MMMM patterns", () => {
      // Matches the pattern used for the CHECKOUT_DATE email variable.
      const utc = new Date("2025-07-15T12:00:00Z");
      expect(
        formatWorkshopDateTime(utc, "dd. MMMM yyyy, HH:mm"),
      ).to.equal("15. Juli 2025, 14:00");
    });

    it("respects the WORKSHOP_TIMEZONE environment override", () => {
      process.env.WORKSHOP_TIMEZONE = "America/New_York";

      // 12:00 UTC in July is 08:00 local in New York (EDT, UTC-4).
      const summerUtc = new Date("2025-07-15T12:00:00Z");
      expect(
        formatWorkshopDateTime(summerUtc, "dd.MM.yyyy HH:mm"),
      ).to.equal("15.07.2025 08:00");

      // 12:00 UTC in January is 07:00 local in New York (EST, UTC-5).
      const winterUtc = new Date("2025-01-15T12:00:00Z");
      expect(
        formatWorkshopDateTime(winterUtc, "dd.MM.yyyy HH:mm"),
      ).to.equal("15.01.2025 07:00");
    });
  });

  describe("getWorkshopTimezone", () => {
    it("defaults to Europe/Zurich when WORKSHOP_TIMEZONE is unset", () => {
      expect(getWorkshopTimezone()).to.equal("Europe/Zurich");
    });

    it("returns the WORKSHOP_TIMEZONE environment variable when set", () => {
      process.env.WORKSHOP_TIMEZONE = "America/New_York";
      expect(getWorkshopTimezone()).to.equal("America/New_York");
    });
  });
});
