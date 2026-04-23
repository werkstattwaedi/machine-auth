// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import {
  constantTimeEqual,
  generateCode,
  generateDocId,
  hashCode,
  isOriginInList,
  isPlausibleEmail,
  normalizeEmail,
} from "../../src/auth/login-code/helpers";

describe("login-code helpers", () => {
  describe("normalizeEmail", () => {
    it("lowercases and trims", () => {
      expect(normalizeEmail("  FOO@Bar.Ch  ")).to.equal("foo@bar.ch");
    });
  });

  describe("isPlausibleEmail", () => {
    it("accepts a normal address", () => {
      expect(isPlausibleEmail("a@b.ch")).to.equal(true);
    });
    it("rejects malformed strings", () => {
      expect(isPlausibleEmail("no-at-sign")).to.equal(false);
      expect(isPlausibleEmail("a@b")).to.equal(false);
      expect(isPlausibleEmail("")).to.equal(false);
    });
  });

  describe("generateCode", () => {
    it("returns 6 digits, zero-padded", () => {
      for (let i = 0; i < 50; i++) {
        const c = generateCode();
        expect(c).to.match(/^\d{6}$/);
      }
    });
  });

  describe("generateDocId", () => {
    it("returns a URL-safe base64 string of at least 32 chars", () => {
      const id = generateDocId();
      expect(id).to.match(/^[A-Za-z0-9_-]+$/);
      expect(id.length).to.be.greaterThanOrEqual(32);
    });
    it("returns different values", () => {
      const a = generateDocId();
      const b = generateDocId();
      expect(a).to.not.equal(b);
    });
  });

  describe("hashCode", () => {
    it("is deterministic", () => {
      expect(hashCode("123456", "doc-x")).to.equal(hashCode("123456", "doc-x"));
    });
    it("binds to docId — same code in different docs hashes differently", () => {
      expect(hashCode("123456", "a")).to.not.equal(hashCode("123456", "b"));
    });
    it("produces different hashes for different codes", () => {
      expect(hashCode("123456", "d")).to.not.equal(hashCode("123457", "d"));
    });
  });

  describe("constantTimeEqual", () => {
    it("returns true for equal strings", () => {
      expect(constantTimeEqual("abcdef", "abcdef")).to.equal(true);
    });
    it("returns false for different strings of same length", () => {
      expect(constantTimeEqual("abcdef", "abcdez")).to.equal(false);
    });
    it("returns false for different lengths (no crash)", () => {
      expect(constantTimeEqual("ab", "abc")).to.equal(false);
    });
  });

  describe("isOriginInList", () => {
    const prodList =
      "https://checkout.werkstattwaedi.ch,https://admin.werkstattwaedi.ch,https://oww-maco.web.app";

    it("allows exact-match production origins", () => {
      expect(isOriginInList("https://checkout.werkstattwaedi.ch", prodList))
        .to.equal(true);
      expect(isOriginInList("https://oww-maco.web.app", prodList))
        .to.equal(true);
    });

    it("rejects wildcard-ish impostor Firebase Hosting domains", () => {
      // The *.web.app wildcard used to let any Firebase project impersonate
      // ours — this is the phishing vector we explicitly closed.
      expect(isOriginInList("https://evil-app.web.app", prodList))
        .to.equal(false);
      expect(isOriginInList("https://oww-maco-attacker.web.app", prodList))
        .to.equal(false);
      expect(isOriginInList("https://oww-admin.firebaseapp.com", prodList))
        .to.equal(false);
    });

    it("rejects unknown origins outright", () => {
      expect(isOriginInList("https://evil.example.com", prodList))
        .to.equal(false);
      expect(isOriginInList(undefined, prodList)).to.equal(false);
      expect(isOriginInList("", prodList)).to.equal(false);
    });

    it("rejects everything (except emulator localhost) when allowlist is empty", () => {
      expect(isOriginInList("https://checkout.werkstattwaedi.ch", ""))
        .to.equal(false);
      // Localhost still allowed because the unit tests don't set
      // FUNCTIONS_EMULATOR; when tests *do* set it (integration), localhost
      // passes — exercised in the integration suite.
    });

    it("trims whitespace and ignores empty entries", () => {
      expect(
        isOriginInList(
          "https://checkout.werkstattwaedi.ch",
          " https://checkout.werkstattwaedi.ch , , https://other.example "
        )
      ).to.equal(true);
    });
  });
});
