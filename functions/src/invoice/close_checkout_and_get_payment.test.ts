// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the server-side bill recompute helpers.
 *
 * These pure functions are the structural defense against client-supplied
 * prices: closeCheckoutAndGetPayment writes the bill using the value
 * returned by recomputeSummary(), never the client-supplied summary.
 */

import { expect } from "chai";
import {
  entryFeeFor,
  isValidItem,
  recomputeSummary,
} from "./close_checkout_and_get_payment";
import type {
  CheckoutPersonEntity,
  ItemOrigin,
} from "../types/firestore_entities";

const adultPerson: CheckoutPersonEntity = {
  name: "Test User",
  email: "test@example.com",
  userType: "erwachsen",
};

const childPerson: CheckoutPersonEntity = {
  name: "Test Kid",
  email: "kid@example.com",
  userType: "kind",
};

function item(origin: ItemOrigin, totalPrice: number) {
  return { origin, totalPrice };
}

describe("entryFeeFor", () => {
  it("returns config fee when present", () => {
    const config = { erwachsen: { regular: 17.5, materialbezug: 0, intern: 0, hangenmoos: 17.5 } };
    expect(entryFeeFor("erwachsen", "regular", config)).to.equal(17.5);
  });

  it("preserves explicit zero (not coerced)", () => {
    const config = { erwachsen: { regular: 0, materialbezug: 0, intern: 0, hangenmoos: 0 } };
    expect(entryFeeFor("erwachsen", "regular", config)).to.equal(0);
  });

  // Issue #149: previously the function silently substituted hardcoded
  // fallback prices (15/7.5/30 CHF) when the config row was missing. Those
  // numbers diverged from the seeded production prices (5/2.5/5 CHF), so
  // a misconfigured `config/pricing` would have silently misbilled every
  // checkout. The new contract throws failed-precondition so the failure
  // surfaces in Cloud Functions logs and to the client immediately.
  describe("issue #149: fail loud on missing config row", () => {
    function expectThrows(fn: () => unknown, codeContains = "failed-precondition") {
      try {
        fn();
        throw new Error("expected throw, got success");
      } catch (err: any) {
        expect(err.code ?? "").to.contain(codeContains);
      }
    }

    it("throws when configFees is null", () => {
      expectThrows(() => entryFeeFor("erwachsen", "regular", null));
    });

    it("throws when userType absent in config", () => {
      const config = { kind: { regular: 8, materialbezug: 0, intern: 0, hangenmoos: 8 } };
      expectThrows(() => entryFeeFor("erwachsen", "regular", config));
    });

    it("throws when usageType absent in user-type row", () => {
      const config = { erwachsen: { regular: 5 } } as Record<string, Record<string, number>>;
      expectThrows(() => entryFeeFor("erwachsen", "materialbezug", config));
    });

    it("throws for unknown userType (no silent zero fallback)", () => {
      expectThrows(() => entryFeeFor("alien", "regular", null));
    });
  });
});

describe("isValidItem", () => {
  it("accepts a normal item", () => {
    expect(isValidItem({ quantity: 1, unitPrice: 5, totalPrice: 5 })).to.be.true;
  });

  it("rejects zero quantity", () => {
    expect(isValidItem({ quantity: 0, unitPrice: 5, totalPrice: 0 })).to.be.false;
  });

  it("rejects negative quantity", () => {
    expect(isValidItem({ quantity: -1, unitPrice: 5, totalPrice: -5 })).to.be.false;
  });

  it("rejects negative unitPrice (the discount-mint attack)", () => {
    expect(isValidItem({ quantity: 1, unitPrice: -100, totalPrice: -100 })).to.be.false;
  });

  it("rejects negative totalPrice", () => {
    expect(isValidItem({ quantity: 1, unitPrice: 5, totalPrice: -5 })).to.be.false;
  });

  it("accepts zero unitPrice (free item)", () => {
    expect(isValidItem({ quantity: 1, unitPrice: 0, totalPrice: 0 })).to.be.true;
  });

  it("rejects items with non-numeric fields", () => {
    expect(isValidItem({})).to.be.false;
    expect(isValidItem({ quantity: "5" as unknown as number, unitPrice: 1, totalPrice: 5 })).to.be.false;
  });

  it("rejects Infinity in any field (would otherwise pass `>= 0`)", () => {
    expect(isValidItem({ quantity: Infinity, unitPrice: 5, totalPrice: 100 })).to.be.false;
    expect(isValidItem({ quantity: 1, unitPrice: Infinity, totalPrice: 100 })).to.be.false;
    expect(isValidItem({ quantity: 1, unitPrice: 5, totalPrice: Infinity })).to.be.false;
    expect(isValidItem({ quantity: 1, unitPrice: 5, totalPrice: -Infinity })).to.be.false;
  });

  it("rejects NaN in any field (NaN comparisons are always false)", () => {
    expect(isValidItem({ quantity: NaN, unitPrice: 5, totalPrice: 100 })).to.be.false;
    expect(isValidItem({ quantity: 1, unitPrice: NaN, totalPrice: 100 })).to.be.false;
    expect(isValidItem({ quantity: 1, unitPrice: 5, totalPrice: NaN })).to.be.false;
  });
});

describe("recomputeSummary", () => {
  it("sums entry fees + items + tip with config-supplied fees", () => {
    const config = {
      erwachsen: { regular: 15, materialbezug: 0, intern: 0, hangenmoos: 15 },
    };
    const summary = recomputeSummary(
      [adultPerson],
      "regular",
      [item("nfc", 12.5), item("manual", 4.5)],
      config,
      2,
    );
    expect(summary.entryFees).to.equal(15);
    expect(summary.machineCost).to.equal(12.5);
    expect(summary.materialCost).to.equal(4.5);
    expect(summary.tip).to.equal(2);
    expect(summary.totalPrice).to.equal(34);
  });

  it("throws when pricing config missing (issue #149)", () => {
    // Previously this returned a hardcoded-fallback summary; the new
    // contract is to fail loud so a misconfigured `config/pricing` doc
    // surfaces immediately rather than silently misbilling.
    try {
      recomputeSummary([adultPerson, childPerson], "regular", [], null, 0);
      throw new Error("expected throw, got success");
    } catch (err: any) {
      expect(err.code ?? "").to.contain("failed-precondition");
    }
  });

  it("clamps negative tip to zero", () => {
    const config = {
      erwachsen: { regular: 15, materialbezug: 0, intern: 0, hangenmoos: 15 },
    };
    const summary = recomputeSummary([adultPerson], "regular", [], config, -50);
    expect(summary.tip).to.equal(0);
    expect(summary.totalPrice).to.equal(15);
  });

  it("ignores client summary entirely (the discount-mint defense)", () => {
    // Even if the client posted summary.totalPrice = 0.01 elsewhere, this
    // function only sees items + persons. The bill amount is whatever this
    // returns. There is no way for the client's number to influence it.
    const config = {
      erwachsen: { regular: 15, materialbezug: 0, intern: 0, hangenmoos: 15 },
    };
    const summary = recomputeSummary(
      [adultPerson],
      "regular",
      [item("manual", 100)],
      config,
      0,
    );
    expect(summary.totalPrice).to.equal(115);
  });

  it("returns zero summary for an empty checkout (no persons, no items)", () => {
    // No persons → no entryFeeFor lookup, so config can stay null without
    // tripping the new fail-loud check.
    const summary = recomputeSummary([], "regular", [], null, 0);
    expect(summary.totalPrice).to.equal(0);
    expect(summary.entryFees).to.equal(0);
  });

  it("rounds totals to centimes", () => {
    const config = {
      erwachsen: { regular: 12.345, materialbezug: 0, intern: 0, hangenmoos: 0 },
    };
    const summary = recomputeSummary([adultPerson], "regular", [], config, 0);
    // Per-person fee not rounded; total rounded to 2dp.
    expect(summary.totalPrice).to.equal(12.35);
  });

  it("treats nfc-origin items as machine cost and others as material cost", () => {
    const summary = recomputeSummary(
      [adultPerson],
      "intern",
      [
        item("nfc", 30),
        item("manual", 5),
        item("qr", 7),
      ],
      { erwachsen: { regular: 0, materialbezug: 0, intern: 0, hangenmoos: 0 } },
      0,
    );
    expect(summary.machineCost).to.equal(30);
    expect(summary.materialCost).to.equal(12);
    expect(summary.totalPrice).to.equal(42);
  });
});
