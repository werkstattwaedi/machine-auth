// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the invoice recipient resolution order (issue #658).
 *
 * Production persons never carry a `userRef` (the close path stores the
 * wire persons), so every case below seeds persons WITHOUT one — the
 * shape that made the #269 resolver silently return no address.
 */

import { expect } from "chai";
import { pickRecipient } from "./resolve_recipient";
import type { CheckoutPersonEntity } from "../types/firestore_entities";

const address = {
  company: "",
  street: "Bahnhofstrasse 7",
  zip: "8820",
  city: "Wädenswil",
};

const guest: CheckoutPersonEntity = {
  name: "Anon User",
  email: "anon@example.com",
  userType: "erwachsen",
};

describe("pickRecipient (#658)", () => {
  it("account holder with stored address: doc name + address, no userRef needed", () => {
    const result = pickRecipient({
      persons: [guest],
      holder: { firstName: "Mike", lastName: "Schneider", billingAddress: address },
    });
    expect(result.recipientName).to.equal("Mike Schneider");
    expect(result.billingAddress).to.deep.equal(address);
  });

  it("account holder without stored address: doc name only", () => {
    const result = pickRecipient({
      persons: [guest],
      holder: { firstName: "Mike", lastName: "Schneider", billingAddress: null },
    });
    expect(result.recipientName).to.equal("Mike Schneider");
    expect(result.billingAddress).to.be.null;
  });

  it("account holder with a partial address: treated as no address", () => {
    const result = pickRecipient({
      persons: [guest],
      holder: {
        firstName: "Mike",
        lastName: "Schneider",
        billingAddress: { company: "", street: "Bahnhofstrasse 7", zip: "", city: "" },
      },
    });
    expect(result.billingAddress).to.be.null;
  });

  it("firma person-level address wins over the holder: company block", () => {
    const firmaAddress = {
      company: "Muster AG",
      street: "Industriestrasse 42",
      zip: "8001",
      city: "Zürich",
    };
    const result = pickRecipient({
      persons: [
        guest,
        { name: "Firma Kontakt", email: "f@example.com", userType: "firma", billingAddress: firmaAddress },
      ],
      holder: { firstName: "Mike", lastName: "Schneider", billingAddress: address },
    });
    expect(result.recipientName).to.equal("Muster AG");
    expect(result.billingAddress).to.deep.equal(firmaAddress);
  });

  it("firma holder without person-level address: company carried through from the user doc", () => {
    const result = pickRecipient({
      persons: [guest],
      holder: {
        firstName: "Mike",
        lastName: "Schneider",
        billingAddress: { ...address, company: "Schneider GmbH" },
      },
    });
    expect(result.billingAddress?.company).to.equal("Schneider GmbH");
  });

  it("guest with person-level address (no holder): check-in name + address", () => {
    const result = pickRecipient({
      persons: [{ ...guest, billingAddress: address }],
      holder: null,
    });
    expect(result.recipientName).to.equal("Anon User");
    expect(result.billingAddress).to.deep.equal(address);
  });

  it("anonymous walk-in (no holder, no address): check-in name only", () => {
    const result = pickRecipient({ persons: [guest], holder: null });
    expect(result.recipientName).to.equal("Anon User");
    expect(result.billingAddress).to.be.null;
  });

  it("NFC cart with persons: [] and a holder: holder's name", () => {
    const result = pickRecipient({
      persons: [],
      holder: { firstName: "Mira", lastName: "Mitglied", billingAddress: null },
    });
    expect(result.recipientName).to.equal("Mira Mitglied");
    expect(result.billingAddress).to.be.null;
  });

  it("no persons and no holder: Unbekannt", () => {
    const result = pickRecipient({ persons: [], holder: null });
    expect(result.recipientName).to.equal("Unbekannt");
    expect(result.billingAddress).to.be.null;
  });
});
