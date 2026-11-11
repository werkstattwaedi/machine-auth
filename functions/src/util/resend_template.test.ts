// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Which Resend refusals are the recipient's fault (warn, invalid-argument)
 * and which are ours (error, internal) — the split keeps a typo'd address
 * from paging.
 */

import { expect } from "chai";
import { isRecipientRejection } from "./resend_template";

describe("isRecipientRejection", () => {
  it("is the 422 Resend returns for a malformed `to`", () => {
    expect(
      isRecipientRejection({
        name: "validation_error",
        message:
          "Invalid `to` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.",
      })
    ).to.equal(true);
  });

  it("is not a validation error about anything else", () => {
    expect(
      isRecipientRejection({
        name: "validation_error",
        message: "Missing required variable `firstName`.",
      })
    ).to.equal(false);
  });

  it("is not any other Resend error", () => {
    expect(
      isRecipientRejection({ name: "rate_limit_exceeded", message: "Too many requests. `to`" })
    ).to.equal(false);
    expect(isRecipientRejection({})).to.equal(false);
  });
});
