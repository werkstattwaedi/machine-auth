import { expect } from "chai";
import * as sinon from "sinon";
import { calculateSessionExpiration, isSessionExpired } from "./session_expiration";
import { Timestamp } from "firebase-admin/firestore";

describe("Session Expiration", () => {
  // Helper to create a timestamp from a date string
  const createTimestamp = (dateStr: string): Timestamp => {
    return Timestamp.fromDate(new Date(dateStr));
  };

  // Helper to format timestamp for debugging
  const formatTimestamp = (ts: Timestamp, tz?: string): string => {
    return ts.toDate().toLocaleString("en-US", {
      timeZone: tz || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  beforeEach(() => {
    // Clear environment variable before each test
    delete process.env.SESSION_TIMEZONE;
  });

  describe("calculateSessionExpiration", () => {
    it("should expire at 3am the next day in default timezone (Europe/Zurich)", () => {
      // Test with a session starting on a Tuesday at 10:30 AM
      const startTime = createTimestamp("2024-03-12T09:30:00.000Z"); // 10:30 AM in Zurich (UTC+1)
      const expiration = calculateSessionExpiration(startTime);
      
      // Should expire at 3:00 AM Zurich time on March 13th
      // Which is 2:00 AM UTC (Zurich is UTC+1 in March)
      const expectedExpiration = createTimestamp("2024-03-13T02:00:00.000Z");
      
      console.log(`Start: ${formatTimestamp(startTime, "Europe/Zurich")} (Zurich)`);
      console.log(`Expiration: ${formatTimestamp(expiration, "Europe/Zurich")} (Zurich)`);
      console.log(`Expected: ${formatTimestamp(expectedExpiration, "Europe/Zurich")} (Zurich)`);
      
      expect(expiration.toMillis()).to.equal(expectedExpiration.toMillis());
    });

    it("should expire at 3am the next day even for late night sessions", () => {
      // Test with a session starting late at night (11:45 PM)
      const startTime = createTimestamp("2024-03-12T22:45:00.000Z"); // 11:45 PM in Zurich
      const expiration = calculateSessionExpiration(startTime);
      
      // Should expire at 3:00 AM Zurich time on March 13th
      const expectedExpiration = createTimestamp("2024-03-13T02:00:00.000Z");
      
      expect(expiration.toMillis()).to.equal(expectedExpiration.toMillis());
    });

    it("should handle early morning sessions (expire same day)", () => {
      // Test with a session starting at 1:00 AM
      const startTime = createTimestamp("2024-03-13T00:00:00.000Z"); // 1:00 AM in Zurich
      const expiration = calculateSessionExpiration(startTime);
      
      // Should expire at 3:00 AM Zurich time on March 13th (same day)
      const expectedExpiration = createTimestamp("2024-03-13T02:00:00.000Z");
      
      expect(expiration.toMillis()).to.equal(expectedExpiration.toMillis());
    });

    it("should handle sessions starting exactly at 3am", () => {
      // Test with a session starting exactly at 3:00 AM
      const startTime = createTimestamp("2024-03-13T02:00:00.000Z"); // 3:00 AM in Zurich
      const expiration = calculateSessionExpiration(startTime);
      
      // Should expire at 3:00 AM Zurich time the NEXT day
      const expectedExpiration = createTimestamp("2024-03-14T02:00:00.000Z");
      
      expect(expiration.toMillis()).to.equal(expectedExpiration.toMillis());
    });

    it("should use custom timezone from environment variable", () => {
      process.env.SESSION_TIMEZONE = "America/New_York";
      
      // Test with a session starting at 10:30 AM EST (UTC-5 in winter)
      const startTime = createTimestamp("2024-01-12T15:30:00.000Z"); // 10:30 AM EST
      const expiration = calculateSessionExpiration(startTime);
      
      // Should expire at 3:00 AM EST on January 13th
      // Which is 8:00 AM UTC (EST is UTC-5)
      const expectedExpiration = createTimestamp("2024-01-13T08:00:00.000Z");
      
      console.log(`Start: ${formatTimestamp(startTime, "America/New_York")} (EST)`);
      console.log(`Expiration: ${formatTimestamp(expiration, "America/New_York")} (EST)`);
      console.log(`Expected: ${formatTimestamp(expectedExpiration, "America/New_York")} (EST)`);
      
      expect(expiration.toMillis()).to.equal(expectedExpiration.toMillis());
    });

    it("should handle daylight saving time transitions", () => {
      // Test around spring DST transition in Europe/Zurich (last Sunday in March)
      // March 31, 2024 is when clocks spring forward from 2:00 AM to 3:00 AM
      
      // Session starting before DST transition
      const startTime = createTimestamp("2024-03-30T22:00:00.000Z"); // 11:00 PM CET (UTC+1)
      const expiration = calculateSessionExpiration(startTime);
      
      // Should expire at 3:00 AM CEST on March 31st
      // But note: 2:00 AM doesn't exist on this day due to DST!
      // Clock jumps from 2:00 AM to 3:00 AM
      // So 3:00 AM CEST = 1:00 AM UTC (CEST is UTC+2)
      const expectedExpiration = createTimestamp("2024-03-31T01:00:00.000Z");
      
      expect(expiration.toMillis()).to.equal(expectedExpiration.toMillis());
    });
  });

  describe("isSessionExpired", () => {
    it("should return false for a session that hasn't expired yet", () => {
      // Create a session that started 1 hour ago
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const startTime = Timestamp.fromDate(oneHourAgo);
      
      expect(isSessionExpired(startTime)).to.equal(false);
    });

    it("should return true for a session that has expired", () => {
      // Create a session that started yesterday at 10 AM
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(10, 0, 0, 0);
      const startTime = Timestamp.fromDate(yesterday);
      
      expect(isSessionExpired(startTime)).to.equal(true);
    });

    it("should return false for a session that started after 3am today", () => {
      // Create a session that started at 4 AM today
      const today = new Date();
      today.setHours(4, 0, 0, 0);
      const startTime = Timestamp.fromDate(today);
      
      expect(isSessionExpired(startTime)).to.equal(false);
    });

    it("should handle edge case around 3am", () => {
      // Mock the current time to be exactly 3:00 AM
      const mockNow = new Date();
      mockNow.setHours(3, 0, 0, 0);
      
      const timestampStub = sinon.stub(Timestamp, 'now').returns(Timestamp.fromDate(mockNow));
      
      // Session started yesterday at 4 PM
      const yesterday = new Date(mockNow);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(16, 0, 0, 0);
      const startTime = Timestamp.fromDate(yesterday);
      
      // Should be expired (expiration was at 3:00 AM today)
      expect(isSessionExpired(startTime)).to.equal(true);
      
      timestampStub.restore();
    });
  });

  describe("edge cases and robustness", () => {
    it("should handle leap years correctly", () => {
      // Test session on Feb 28, 2024 (leap year)
      const startTime = createTimestamp("2024-02-28T15:00:00.000Z");
      const expiration = calculateSessionExpiration(startTime);
      
      // Should expire at 3:00 AM on Feb 29, 2024
      const expectedExpiration = createTimestamp("2024-02-29T02:00:00.000Z");
      
      expect(expiration.toMillis()).to.equal(expectedExpiration.toMillis());
    });

    it("should handle year boundary", () => {
      // Test session on New Year's Eve
      const startTime = createTimestamp("2023-12-31T20:00:00.000Z");
      const expiration = calculateSessionExpiration(startTime);
      
      // Should expire at 3:00 AM on January 1, 2024
      const expectedExpiration = createTimestamp("2024-01-01T02:00:00.000Z");
      
      expect(expiration.toMillis()).to.equal(expectedExpiration.toMillis());
    });

    it("should handle different timezones consistently", () => {
      const timezones = ["Europe/Zurich", "America/New_York", "Asia/Tokyo", "UTC"];
      const startTime = createTimestamp("2024-06-15T12:00:00.000Z");
      
      timezones.forEach(tz => {
        const expiration = calculateSessionExpiration(startTime, tz);
        
        // All should expire at 3:00 AM the next day in their respective timezone
        // The actual UTC time will differ, but the local time should be 3:00 AM
        const localExpiration = expiration.toDate().toLocaleString("en-US", {
          timeZone: tz,
          hour12: false,
          hour: "2-digit",
          minute: "2-digit"
        });
        
        expect(localExpiration).to.equal("03:00");
      });
    });
  });

  describe("integration with Firestore Timestamp", () => {
    it("should work with Firestore Timestamp objects", () => {
      // Test that we can round-trip through Firestore-style operations
      const originalDate = new Date("2024-06-15T14:30:00.000Z");
      const firestoreTimestamp = Timestamp.fromDate(originalDate);
      
      // Simulate storing and retrieving from Firestore
      const serialized = {
        seconds: firestoreTimestamp.seconds,
        nanoseconds: firestoreTimestamp.nanoseconds
      };
      
      const restored = new Timestamp(serialized.seconds, serialized.nanoseconds);
      const expiration = calculateSessionExpiration(restored);
      
      expect(expiration).to.be.instanceOf(Timestamp);
      expect(typeof expiration.seconds).to.equal("number");
      expect(typeof expiration.nanoseconds).to.equal("number");
    });
  });
});