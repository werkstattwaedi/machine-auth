// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { subjectKey } from "./subject_key";

describe("subjectKey", () => {
  it("matches the published HMAC-SHA256 test vector", () => {
    // Well-known vector: HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")
    expect(
      subjectKey("key", "The quick brown fox jumps over the lazy dog")
    ).to.equal(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
    );
  });

  it("is deterministic for the same salt + id", () => {
    expect(subjectKey("s1", "user-a")).to.equal(subjectKey("s1", "user-a"));
  });

  it("differs across ids and across salts", () => {
    expect(subjectKey("s1", "user-a")).to.not.equal(subjectKey("s1", "user-b"));
    expect(subjectKey("s1", "user-a")).to.not.equal(subjectKey("s2", "user-a"));
  });

  it("returns null for missing subject ids", () => {
    expect(subjectKey("s1", null)).to.equal(null);
    expect(subjectKey("s1", undefined)).to.equal(null);
    expect(subjectKey("s1", "")).to.equal(null);
  });

  it("throws on an empty salt instead of producing weak keys", () => {
    expect(() => subjectKey("", "user-a")).to.throw(/salt/);
  });
});
