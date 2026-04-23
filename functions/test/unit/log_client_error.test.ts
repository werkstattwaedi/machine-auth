// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { buildClientErrorLogPayload } from "../../src/util/log_client_error";

/**
 * The callable itself is a thin wrapper that calls `logger.warn("clientError", ...)`.
 * We exercise the sanitization helper directly — it builds the exact fields
 * that are passed to logger.warn, and is the only non-trivial part worth testing.
 */
describe("logClientError — payload sanitization", () => {
  it("preserves a valid payload verbatim", () => {
    const { logFields } = buildClientErrorLogPayload(
      {
        sessionId: "abcd1234",
        context: "usage",
        code: "permission-denied",
        message: "Missing or insufficient permissions.",
        path: "/bills",
        userAgent: "Mozilla/5.0",
      },
      "user-42",
    );
    expect(logFields).to.deep.equal({
      sessionId: "abcd1234",
      context: "usage",
      code: "permission-denied",
      message: "Missing or insufficient permissions.",
      path: "/bills",
      uid: "user-42",
      userAgent: "Mozilla/5.0",
    });
  });

  it("drops the message when total body exceeds 4096 bytes", () => {
    // Each field is first truncated to 2000 chars. A 2000-char message plus
    // a 2000-char userAgent pushes the sanitized JSON above the 4096-byte
    // budget, at which point `message` is dropped to keep the metadata.
    const twoKB = "x".repeat(5000);
    const { logFields } = buildClientErrorLogPayload(
      {
        sessionId: "abcd1234",
        context: "usage",
        code: "permission-denied",
        message: twoKB,
        path: "/bills",
        userAgent: twoKB,
      },
      null,
    );
    expect(logFields.message).to.equal(null);
    expect(logFields.sessionId).to.equal("abcd1234");
    expect(logFields.context).to.equal("usage");
    expect(logFields.code).to.equal("permission-denied");
    expect(logFields.path).to.equal("/bills");
    expect(logFields.uid).to.equal(null);
    expect((logFields.userAgent as string).length).to.equal(2000);
  });

  it("truncates individual string fields past 2000 chars", () => {
    const longContext = "c".repeat(3000);
    const { logFields } = buildClientErrorLogPayload(
      { sessionId: "abcd1234", context: longContext },
      null,
    );
    expect((logFields.context as string).length).to.equal(2000);
  });

  it("falls back to 'unknown' when sessionId is missing or non-string", () => {
    const { logFields: missing } = buildClientErrorLogPayload({}, null);
    expect(missing.sessionId).to.equal("unknown");

    const { logFields: nonString } = buildClientErrorLogPayload(
      { sessionId: 42 as unknown as string },
      null,
    );
    expect(nonString.sessionId).to.equal("unknown");
  });

  it("coerces non-string fields to null", () => {
    const { logFields } = buildClientErrorLogPayload(
      {
        sessionId: "abcd1234",
        code: 42 as unknown as string,
        message: { foo: "bar" } as unknown as string,
      },
      null,
    );
    expect(logFields.code).to.equal(null);
    expect(logFields.message).to.equal(null);
  });
});
