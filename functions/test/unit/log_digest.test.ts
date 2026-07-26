// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { summarizeLogEntries, type RawLogEntry } from "@oww/shared";
import {
  DIGEST_LOOKBACK_HOURS,
  renderDigest,
  runLogDigest,
  type DigestMail,
} from "../../src/util/log_digest";

/**
 * Grouping itself is tested in `shared/src/log-triage.test.ts` — this file
 * covers only what the function adds: mail rendering and the job's
 * send/skip decisions.
 */

function entry(overrides: Partial<RawLogEntry> = {}): RawLogEntry {
  return {
    severity: "WARNING",
    service: "authcall",
    timestamp: "2026-07-26T05:00:00.000Z",
    message: "SDM counter replay rejected",
    ...overrides,
  };
}

describe("logDigest — rendering", () => {
  const opts = {
    projectId: "oww-maco",
    since: new Date("2026-07-25T05:00:00.000Z"),
    until: new Date("2026-07-26T05:00:00.000Z"),
  };

  it("puts counts and project in the subject", () => {
    const mail = renderDigest(summarizeLogEntries([entry(), entry()]), opts);
    expect(mail.subject).to.contain("oww-maco");
    expect(mail.subject).to.contain("2");
  });

  it("announces truncation instead of hiding it", () => {
    const mail = renderDigest(summarizeLogEntries([entry()], true), opts);
    expect(mail.text).to.contain("Limit");
    expect(mail.html).to.contain("Limit");
  });

  it("escapes HTML in log messages", () => {
    const mail = renderDigest(
      summarizeLogEntries([entry({ message: "<script>alert(1)</script>" })]),
      opts,
    );
    expect(mail.html).to.not.contain("<script>");
    expect(mail.html).to.contain("&lt;script&gt;");
  });
});

describe("logDigest — job", () => {
  const now = new Date("2026-07-26T05:00:00.000Z");

  function harness(entries: RawLogEntry[], recipient = "ops@example.com") {
    const sent: Array<DigestMail & { to: string }> = [];
    const windows: Date[] = [];
    return {
      sent,
      windows,
      run: () =>
        runLogDigest({
          projectId: "oww-maco",
          now,
          recipient,
          fetchEntries: async (_projectId, since) => {
            windows.push(since);
            return { entries, truncated: false };
          },
          sendMail: async (mail) => {
            sent.push(mail);
          },
        }),
    };
  }

  it("queries exactly the lookback window", async () => {
    const h = harness([entry()]);
    await h.run();
    expect(h.windows[0].toISOString()).to.equal(
      new Date(
        now.getTime() - DIGEST_LOOKBACK_HOURS * 3600_000,
      ).toISOString(),
    );
  });

  it("sends the digest when there is something to report", async () => {
    const h = harness([entry(), entry({ severity: "ERROR" })]);
    const summary = await h.run();
    expect(h.sent).to.have.lengthOf(1);
    expect(h.sent[0].to).to.equal("ops@example.com");
    expect(summary.total).to.equal(2);
  });

  it("stays silent on a quiet day", async () => {
    const h = harness([]);
    const summary = await h.run();
    expect(h.sent).to.be.empty;
    expect(summary.total).to.equal(0);
  });

  it("does not throw when no recipient is configured", async () => {
    const h = harness([entry()], "");
    const summary = await h.run();
    expect(h.sent).to.be.empty;
    expect(summary.total).to.equal(1);
  });
});
