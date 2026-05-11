// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { formatFullName } from "./username-utils";

describe("formatFullName", () => {
  it("joins first + last with a single space", () => {
    expect(formatFullName({ firstName: "Max", lastName: "Muster" })).to.equal(
      "Max Muster",
    );
  });

  it("returns just firstName when lastName is missing", () => {
    expect(formatFullName({ firstName: "Max", lastName: "" })).to.equal("Max");
    expect(formatFullName({ firstName: "Max", lastName: null })).to.equal(
      "Max",
    );
    expect(formatFullName({ firstName: "Max" })).to.equal("Max");
  });

  it("returns just lastName when firstName is missing", () => {
    expect(formatFullName({ firstName: "", lastName: "Muster" })).to.equal(
      "Muster",
    );
    expect(formatFullName({ firstName: null, lastName: "Muster" })).to.equal(
      "Muster",
    );
    expect(formatFullName({ lastName: "Muster" })).to.equal("Muster");
  });

  it("returns the fallback when both names are empty/missing", () => {
    expect(
      formatFullName({ firstName: "", lastName: "" }, "fallback"),
    ).to.equal("fallback");
    expect(
      formatFullName({ firstName: null, lastName: null }, "user@example.com"),
    ).to.equal("user@example.com");
    expect(formatFullName({}, "Jemand")).to.equal("Jemand");
  });

  it("returns an empty string when both names are empty and no fallback", () => {
    expect(formatFullName({ firstName: "", lastName: "" })).to.equal("");
    expect(formatFullName({})).to.equal("");
  });

  it("treats whitespace-only inputs as empty so the fallback wins", () => {
    // Regression guard for callers that previously used `|| email` after
    // the inline `.trim()` — whitespace-only firstName/lastName must
    // still fall through to the fallback.
    expect(
      formatFullName({ firstName: "   ", lastName: "   " }, "fallback"),
    ).to.equal("fallback");
  });

  it("preserves internal whitespace inside individual names", () => {
    expect(
      formatFullName({ firstName: "Anne Marie", lastName: "von Muster" }),
    ).to.equal("Anne Marie von Muster");
  });
});
