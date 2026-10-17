// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the pure parts of the admin correction (ADR-0042): payload
 * validation and the `savedPersonId` carry-over (issue #605).
 */

import { expect } from "chai";
import { HttpsError } from "firebase-functions/v2/https";
import type { CorrectCheckoutReplacement } from "@oww/shared";
import {
  keepOriginalSavedPersonIds,
  parseCorrectCheckoutsRequest,
} from "./correct_checkouts";
import type { CheckoutPersonEntity } from "../types/firestore_entities";

function replacement(overrides: Partial<CorrectCheckoutReplacement> = {}): CorrectCheckoutReplacement {
  return {
    persons: [{
      name: "Alice Adult",
      email: "alice@example.com",
      userType: "erwachsen",
      userId: null,
      entryFeeWaivedToday: false,
      usageType: "regular",
    }],
    items: [],
    tip: 0,
    ...overrides,
  };
}

function parse(r: unknown) {
  return parseCorrectCheckoutsRequest({ reason: "Falsch", corrections: [{ checkoutId: "x", replacement: r }] });
}

describe("parseCorrectCheckoutsRequest persons", () => {
  it("requires a valid usage type on every person", () => {
    const { usageType: _omitted, ...noType } = replacement().persons[0];
    expect(() => parse(replacement({ persons: [noType as never] }))).to.throw(HttpsError, /persons/);
    expect(() =>
      parse(replacement({ persons: [{ ...replacement().persons[0], usageType: "gratis" as never }] })),
    ).to.throw(HttpsError, /persons/);
  });

  it("ignores a stray top-level usageType", () => {
    const parsed = parse({ ...replacement(), usageType: "intern" });
    expect(parsed.corrections[0].replacement).to.not.have.property("usageType");
  });

  it("accepts and keeps a savedPersonId", () => {
    const parsed = parse(replacement({ persons: [{ ...replacement().persons[0], savedPersonId: "sp-1" }] }));
    expect(parsed.corrections[0].replacement?.persons[0].savedPersonId).to.equal("sp-1");
  });

  it("rejects an empty, non-string or overlong savedPersonId", () => {
    for (const bad of ["", 42, null, "x".repeat(129)]) {
      expect(() =>
        parse(replacement({ persons: [{ ...replacement().persons[0], savedPersonId: bad as never }] })),
      ).to.throw(HttpsError, /persons/);
    }
  });
});

describe("keepOriginalSavedPersonIds", () => {
  const guest = (name: string, savedPersonId?: string): CheckoutPersonEntity => ({
    name,
    email: "",
    userType: "erwachsen",
    usageType: "regular",
    ...(savedPersonId ? { savedPersonId } : {}),
  });
  const original = { persons: [guest("Owner"), guest("Bea", "sp-bea"), guest("Carl", "sp-carl")] };

  it("keeps ids the original checkout carried", () => {
    const out = keepOriginalSavedPersonIds([guest("Bea", "sp-bea"), guest("Carl", "sp-carl")], original);
    expect(out.map((p) => p.savedPersonId)).to.deep.equal(["sp-bea", "sp-carl"]);
  });

  it("drops an id the original did not carry", () => {
    const out = keepOriginalSavedPersonIds([guest("Dora", "sp-dora")], original);
    expect(out[0]).to.not.have.property("savedPersonId");
    expect(out[0].name).to.equal("Dora");
  });

  it("drops everything when the original has no saved persons (legacy doc)", () => {
    const out = keepOriginalSavedPersonIds([guest("Bea", "sp-bea")], { persons: [guest("Owner")] });
    expect(out[0]).to.not.have.property("savedPersonId");
  });

  it("drops an id on a line with a userRef", () => {
    const owner = { ...guest("Owner", "sp-bea"), userRef: { id: "owner" } as never };
    const out = keepOriginalSavedPersonIds([owner], original);
    expect(out[0]).to.not.have.property("savedPersonId");
    expect(out[0].userRef).to.exist;
  });

  it("keeps a repeated id on its first line only", () => {
    const out = keepOriginalSavedPersonIds([guest("Bea", "sp-bea"), guest("Bea 2", "sp-bea")], original);
    expect(out.map((p) => p.savedPersonId)).to.deep.equal(["sp-bea", undefined]);
  });

  it("leaves persons without an id untouched", () => {
    const persons = [guest("Eva")];
    expect(keepOriginalSavedPersonIds(persons, original)).to.deep.equal(persons);
  });
});
