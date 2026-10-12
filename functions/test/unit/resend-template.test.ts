// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import {
  contractVariables,
  stripMarkup,
  templateEnvFrom,
} from "../../src/util/resend_template";

describe("resend_template (ADR-0046)", () => {
  describe("templateEnvFrom", () => {
    let savedEmulator: string | undefined;

    beforeEach(() => {
      savedEmulator = process.env.FUNCTIONS_EMULATOR;
      delete process.env.FUNCTIONS_EMULATOR;
    });

    afterEach(() => {
      if (savedEmulator === undefined) {
        delete process.env.FUNCTIONS_EMULATOR;
      } else {
        process.env.FUNCTIONS_EMULATOR = savedEmulator;
      }
    });

    it("accepts the known environments, trimmed", () => {
      expect(templateEnvFrom("prod")).to.equal("prod");
      expect(templateEnvFrom(" staging ")).to.equal("staging");
    });

    for (const value of ["", "   ", "production"]) {
      it(`fails loudly on ${JSON.stringify(value)} outside the emulator (issue #149)`, () => {
        try {
          templateEnvFrom(value);
          throw new Error("expected throw, got success");
        } catch (err: any) {
          expect(err.code).to.equal("failed-precondition");
          expect(err.message).to.contain("not configured");
        }
      });
    }

    it("falls back to test in the emulator, which never sends", () => {
      process.env.FUNCTIONS_EMULATOR = "true";
      expect(templateEnvFrom("")).to.equal("test");
    });
  });

  describe("contractVariables", () => {
    it("keeps exactly the mail's contract variables", () => {
      const vars = contractVariables("bill-sammelrechnung", {
        RECIPIENT_NAME: "Ada",
        CHECKOUT_DATE: "1. Oktober 2026, 10:00",
        INVOICE_NUMBER: "RE-4200001",
        AMOUNT: "8.00",
        CURRENCY: "CHF",
        KASSE_EMAIL: "kasse@example.com",
      });
      expect(Object.keys(vars).sort()).to.deep.equal(
        ["AMOUNT", "CURRENCY", "INVOICE_NUMBER", "KASSE_EMAIL", "RECIPIENT_NAME"],
      );
    });

    it("throws when one is missing", () => {
      expect(() => contractVariables("login", { CODE: "123456" })).to.throw(
        /MAGIC_LINK, EXPIRES_MINUTES/,
      );
    });
  });

  describe("stripMarkup", () => {
    it("drops angle brackets, keeps everything else", () => {
      expect(stripMarkup('<a href="x">Eve</a> & Söhne')).to.equal('a href="x"Eve/a & Söhne');
      expect(stripMarkup("https://example.com/verify?token=a&b=1")).to.equal(
        "https://example.com/verify?token=a&b=1",
      );
    });
  });
});
