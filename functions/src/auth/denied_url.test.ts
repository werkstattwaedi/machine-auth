// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the /denied deep-link builder (issue #535).
 *
 * These pin the canonical URL shape the MaCo renders as a QR code and the
 * web landing page parses back. The domain-config guard itself is covered by
 * price_list/get_price_list_pdf_url.test.ts (shared `checkout-domain` helper).
 */

import { expect } from "chai";
import { buildDeniedUrl, zurichDateKey } from "./denied_url";

describe("buildDeniedUrl", () => {
  it("encodes cause + uid for a missing-permission denial (no checkout)", () => {
    expect(
      buildDeniedUrl("checkout.werkstattwaedi.ch", {
        cause: "missing_permission",
        uid: "user123",
      })
    ).to.equal(
      "https://checkout.werkstattwaedi.ch/denied?cause=missing_permission&uid=user123"
    );
  });

  it("encodes cause + uid + checkout + since for a stale checkout", () => {
    expect(
      buildDeniedUrl("checkout.werkstattwaedi.ch", {
        cause: "stale_checkout",
        uid: "user123",
        checkoutId: "co_abc",
        since: "2026-07-14",
      })
    ).to.equal(
      "https://checkout.werkstattwaedi.ch/denied?cause=stale_checkout&uid=user123&checkout=co_abc&since=2026-07-14"
    );
  });

  it("URL-encodes reserved characters in params", () => {
    const url = buildDeniedUrl("localhost:5173", {
      cause: "stale_checkout",
      uid: "a b/c",
    });
    expect(url).to.contain("uid=a+b%2Fc");
  });
});

describe("zurichDateKey", () => {
  it("formats a date as YYYY-MM-DD in Europe/Zurich", () => {
    // 2026-07-14 10:00 UTC → still 14 July in Zurich (summer, UTC+2).
    expect(zurichDateKey(new Date("2026-07-14T10:00:00Z"))).to.equal(
      "2026-07-14"
    );
  });

  it("resolves the local day across the UTC midnight boundary", () => {
    // 2026-07-14 23:30 UTC = 2026-07-15 01:30 Zurich → next calendar day.
    expect(zurichDateKey(new Date("2026-07-14T23:30:00Z"))).to.equal(
      "2026-07-15"
    );
  });
});
