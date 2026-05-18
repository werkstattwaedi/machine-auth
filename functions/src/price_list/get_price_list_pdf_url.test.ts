// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the price-list QR URL helpers (issue #248).
 *
 * Regression net: a previous implementation read `process.env.CHECKOUT_DOMAIN`
 * with a hardcoded `localhost:5173` fallback. The env var was never plumbed
 * through generate-env.ts, so production PDFs silently encoded
 * `https://localhost:5173/material/add?priceList=…` in their QR codes.
 *
 * These tests pin both halves of the fix:
 *   - `buildPriceListQrUrl` is a pure string builder with no env lookups.
 *   - `assertCheckoutDomainConfigured` fails loud in production when the
 *     param is unset, so a future refactor cannot silently reintroduce a
 *     localhost fallback.
 */

import { expect } from "chai";
import { HttpsError } from "firebase-functions/v2/https";
import {
  assertCheckoutDomainConfigured,
  buildPriceListQrUrl,
} from "./get_price_list_pdf_url";

describe("buildPriceListQrUrl", () => {
  it("encodes the canonical production URL", () => {
    expect(
      buildPriceListQrUrl("checkout.werkstattwaedi.ch", "abc123")
    ).to.equal("https://checkout.werkstattwaedi.ch/material/add?priceList=abc123");
  });

  it("preserves an emulator-style host so dev flows still work", () => {
    expect(buildPriceListQrUrl("localhost:5173", "x")).to.equal(
      "https://localhost:5173/material/add?priceList=x"
    );
  });
});

describe("assertCheckoutDomainConfigured", () => {
  // The helper reads `process.env.FUNCTIONS_EMULATOR` at call time, so each
  // test can toggle the flag without touching module state.
  const originalEmulator = process.env.FUNCTIONS_EMULATOR;
  afterEach(() => {
    if (originalEmulator === undefined) {
      delete process.env.FUNCTIONS_EMULATOR;
    } else {
      process.env.FUNCTIONS_EMULATOR = originalEmulator;
    }
  });

  it("throws failed-precondition in production when the domain is empty", () => {
    delete process.env.FUNCTIONS_EMULATOR;
    let thrown: unknown;
    try {
      assertCheckoutDomainConfigured("");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).to.be.instanceOf(HttpsError);
    expect((thrown as HttpsError).code).to.equal("failed-precondition");
  });

  it("also rejects whitespace-only values in production", () => {
    delete process.env.FUNCTIONS_EMULATOR;
    expect(() => assertCheckoutDomainConfigured("   ")).to.throw(HttpsError);
  });

  it("accepts a configured production domain", () => {
    delete process.env.FUNCTIONS_EMULATOR;
    expect(() =>
      assertCheckoutDomainConfigured("checkout.werkstattwaedi.ch")
    ).to.not.throw();
  });

  it("tolerates an empty value in emulator mode", () => {
    process.env.FUNCTIONS_EMULATOR = "true";
    expect(() => assertCheckoutDomainConfigured("")).to.not.throw();
  });
});
