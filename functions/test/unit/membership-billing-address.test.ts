// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { assertMembershipBillingAddress } from "../../src/invoice/close_checkout_and_get_payment";

describe("assertMembershipBillingAddress (unit)", () => {
  it("passes for a complete address", () => {
    expect(() =>
      assertMembershipBillingAddress({
        street: "Seestrasse 12",
        zip: "8820",
        city: "Wädenswil",
      })
    ).to.not.throw();
  });

  it("throws when the address is null", () => {
    expect(() => assertMembershipBillingAddress(null)).to.throw(/Rechnungsadresse/);
  });

  it("throws when the address is undefined", () => {
    expect(() => assertMembershipBillingAddress(undefined)).to.throw(
      /Rechnungsadresse/
    );
  });

  for (const missing of ["street", "zip", "city"] as const) {
    it(`throws when ${missing} is blank`, () => {
      const addr: { street?: string; zip?: string; city?: string } = {
        street: "Seestrasse 12",
        zip: "8820",
        city: "Wädenswil",
      };
      addr[missing] = "   ";
      expect(() => assertMembershipBillingAddress(addr)).to.throw(
        /Rechnungsadresse/
      );
    });
  }
});
