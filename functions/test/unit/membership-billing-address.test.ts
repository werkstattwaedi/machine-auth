// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { assertMembershipBillingAddress } from "../../src/invoice/close_checkout_and_get_payment";
import type { CheckoutPersonEntity } from "../../src/types/firestore_entities";

function person(
  billingAddress?: CheckoutPersonEntity["billingAddress"]
): CheckoutPersonEntity {
  return {
    name: "Test Person",
    email: "test@example.com",
    userType: "erwachsen",
    ...(billingAddress ? { billingAddress } : {}),
  };
}

describe("assertMembershipBillingAddress (unit)", () => {
  it("passes when the primary person has a complete address", () => {
    expect(() =>
      assertMembershipBillingAddress(
        person({ company: "", street: "Seestrasse 12", zip: "8820", city: "Wädenswil" })
      )
    ).to.not.throw();
  });

  it("throws when there is no address", () => {
    expect(() => assertMembershipBillingAddress(person())).to.throw(
      /Rechnungsadresse/
    );
  });

  it("throws when there is no primary person", () => {
    expect(() => assertMembershipBillingAddress(undefined)).to.throw(
      /Rechnungsadresse/
    );
  });

  for (const missing of ["street", "zip", "city"] as const) {
    it(`throws when ${missing} is blank`, () => {
      const addr = { company: "", street: "Seestrasse 12", zip: "8820", city: "Wädenswil" };
      addr[missing] = "   ";
      expect(() => assertMembershipBillingAddress(person(addr))).to.throw(
        /Rechnungsadresse/
      );
    });
  }
});
