// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Unit tests for the bill-mail recipient resolvers (issue #651).
 *
 * `resolveGuestEmail` is the fallback for a walk-in guest checkout
 * (`userId` null); it must never win over an account holder (#471).
 */

import { expect } from "chai";
import type { DocumentReference } from "firebase-admin/firestore";
import {
  resolveBillRecipientEmail,
  resolveGuestEmail,
  resolveRecipientEmail,
} from "./checkout_recipient";
import type {
  CheckoutEntity,
  CheckoutPersonEntity,
} from "../types/firestore_entities";

/** Minimal stand-in for `checkout.userId.get()` — no Firestore needed. */
function fakeUserRef(email: string | null, exists = true): DocumentReference {
  return {
    path: "users/fake",
    get: async () => ({
      exists,
      data: () => (exists ? { email } : undefined),
    }),
  } as unknown as DocumentReference;
}

function checkout(
  userId: DocumentReference | null,
  persons: CheckoutPersonEntity[],
): CheckoutEntity {
  return {
    // The functions-side type is non-nullable, but anonymous checkouts
    // store null — exactly the case under test.
    userId: userId as unknown as DocumentReference,
    persons,
  } as CheckoutEntity;
}

const guest: CheckoutPersonEntity = {
  name: "Gast Gabi",
  email: "guest@example.com",
  userType: "erwachsen",
};

describe("resolveGuestEmail (#651)", () => {
  it("returns the guest's e-mail when the checkout has no account holder", () => {
    expect(resolveGuestEmail(checkout(null, [guest]))).to.equal("guest@example.com");
  });

  it("skips roster entries without an e-mail and picks the next one, trimmed", () => {
    const persons: CheckoutPersonEntity[] = [
      { name: "Kid", email: "", userType: "kind" },
      { name: "Blank", email: "   ", userType: "kind" },
      { name: "Gabi", email: "  guest@example.com ", userType: "erwachsen" },
    ];
    expect(resolveGuestEmail(checkout(null, persons))).to.equal("guest@example.com");
  });

  it("returns null when no roster entry carries an e-mail", () => {
    const persons: CheckoutPersonEntity[] = [
      { name: "Kid", email: "", userType: "kind" },
    ];
    expect(resolveGuestEmail(checkout(null, persons))).to.be.null;
    expect(resolveGuestEmail(checkout(null, []))).to.be.null;
  });

  it("returns null when the checkout HAS an account holder — a roster member never replaces the payer (#471)", () => {
    const ref = fakeUserRef(null);
    expect(resolveGuestEmail(checkout(ref, [guest]))).to.be.null;
  });
});

describe("resolveBillRecipientEmail (#651)", () => {
  it("prefers the account holder's e-mail over a roster e-mail (#471)", async () => {
    const ref = fakeUserRef("owner@example.com");
    const persons: CheckoutPersonEntity[] = [
      { name: "Someone Else", email: "other@example.com", userType: "erwachsen" },
    ];
    expect(await resolveBillRecipientEmail(checkout(ref, persons))).to.equal(
      "owner@example.com",
    );
  });

  it("falls back to the guest e-mail only when there is no account holder", async () => {
    expect(await resolveBillRecipientEmail(checkout(null, [guest]))).to.equal(
      "guest@example.com",
    );
  });

  it("returns null for an account holder without e-mail even if the roster has one (#471)", async () => {
    const ref = fakeUserRef(null);
    expect(await resolveBillRecipientEmail(checkout(ref, [guest]))).to.be.null;
  });

  it("returns null when neither an account holder nor a guest e-mail exists", async () => {
    const persons: CheckoutPersonEntity[] = [
      { name: "Kid", email: "", userType: "kind" },
    ];
    expect(await resolveBillRecipientEmail(checkout(null, persons))).to.be.null;
  });
});

describe("resolveRecipientEmail (reminder cron, account holder only)", () => {
  it("stays null for a guest checkout — the guest fallback must not leak into reminders", async () => {
    expect(await resolveRecipientEmail(checkout(null, [guest]))).to.be.null;
  });
});
