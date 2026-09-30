// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { summarizeLogEntries, type RawLogEntry } from "@oww/shared";
import {
  DIGEST_LOOKBACK_HOURS,
  renderDigest,
  runLogDigest,
  toRawLogEntry,
  type DigestMail,
} from "../../src/util/log_digest";

/**
 * Grouping itself is tested in `shared/src/log-triage.test.ts` — this file
 * covers only what the function adds: the Logging-entry mapping, mail
 * rendering and the job's send/skip decisions.
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

/**
 * A post-deploy probe burst in the shape of issue #671: every function URL
 * GETted without credentials within half a minute.
 */
function probeBurst(startIso = "2026-07-25T20:25:52.000Z"): RawLogEntry[] {
  const get = (status: number) => ({ method: "GET", status, url: "/" });
  const shapes: Array<Partial<RawLogEntry>> = [
    ...["onbillcreate", "onbillupdate", "monthlybillrun"].flatMap((service) =>
      Array.from({ length: 4 }, () => ({
        service,
        message:
          "The request was not authenticated. Either allow unauthenticated " +
          "invocations or set the proper Authorization header. Empty " +
          "Authorization header value.",
        httpRequest: get(403),
      })),
    ),
    { service: "authcall", message: "Request has invalid method. GET" },
    {
      service: "authcall",
      severity: "ERROR",
      message: "Error: Invalid request, unable to process.\n    at x (y.js:1:1)",
    },
    { service: "api", message: "Missing or invalid Authorization header." },
    { service: "api", message: "", httpRequest: get(401) },
    { service: "authcall", message: "", httpRequest: get(405) },
  ];
  const start = Date.parse(startIso);
  return shapes.map((shape, i) =>
    entry({
      ...shape,
      timestamp: new Date(
        start + Math.round((i * 29_000) / (shapes.length - 1)),
      ).toISOString(),
    }),
  );
}

const REAL_WARNINGS: RawLogEntry[] = [
  entry({
    service: "onbillcreate",
    timestamp: "2026-07-25T21:00:00.000Z",
    message: "Bill 42: no recipient email, skipping",
  }),
  entry({
    service: "logclienterror",
    timestamp: "2026-07-25T22:00:00.000Z",
    message: "clientError: permission-denied",
  }),
];

const PROBE_FOOTER =
  /\d+ Einträge aus unauthentisierten Probes .* nicht aufgeführt/g;

describe("logDigest — entry mapping", () => {
  const metadata = {
    severity: "WARNING",
    timestamp: new Date("2026-07-26T05:00:00.000Z"),
    resource: { labels: { service_name: "api" } },
  };

  it("carries the request of a request-log row", () => {
    const raw = toRawLogEntry({
      metadata: {
        ...metadata,
        httpRequest: {
          requestMethod: "GET",
          status: 401,
          requestUrl: "https://api-abc-oa.a.run.app/",
        },
      },
      data: undefined,
    });
    expect(raw).to.deep.include({
      severity: "WARNING",
      service: "api",
      timestamp: "2026-07-26T05:00:00.000Z",
      message: "",
    });
    expect(raw.httpRequest).to.deep.equal({
      method: "GET",
      status: 401,
      url: "https://api-abc-oa.a.run.app/",
    });
  });

  it("treats an empty payload as no message", () => {
    const raw = toRawLogEntry({
      metadata: { ...metadata, httpRequest: { requestMethod: "GET" } },
      data: {},
    });
    expect(raw.message).to.equal("");
    expect(raw.httpRequest?.method).to.equal("GET");
    expect(raw.httpRequest?.status).to.equal(undefined);
  });

  it("leaves application log lines without a request", () => {
    const text = toRawLogEntry({ metadata, data: "plain text" });
    expect(text.message).to.equal("plain text");
    expect(text).to.not.have.property("httpRequest");

    const structured = toRawLogEntry({
      metadata,
      data: { message: "SDM counter replay rejected", tokenId: "04aa" },
    });
    expect(structured.message).to.equal("SDM counter replay rejected");
    expect(structured.detail).to.deep.equal({ tokenId: "04aa" });
    expect(structured).to.not.have.property("httpRequest");
  });
});

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

  it("lists the real warnings and folds the deploy probe into one line", () => {
    // Issue #671: the probe used to fill the mail with ~20 groups.
    const burst = probeBurst();
    const mail = renderDigest(
      summarizeLogEntries([...burst, ...REAL_WARNINGS]),
      opts,
    );

    expect(mail.subject).to.contain("2 Warnungen/Fehler in 2 Gruppen");
    for (const body of [mail.text, mail.html]) {
      expect(body).to.contain("Bill 42: no recipient email, skipping");
      expect(body).to.contain("clientError: permission-denied");
      expect(body.match(PROBE_FOOTER)).to.have.lengthOf(1);
      expect(body).to.not.contain("Request has invalid method");
      expect(body).to.not.contain("not authenticated");
      expect(body).to.not.contain("Invalid request, unable to process");
    }
    expect(mail.text).to.contain(
      `Einträge: 2 in 2 Gruppen (+${burst.length} Probe-Einträge ausgeblendet)`,
    );
    expect(mail.text).to.contain(
      `${burst.length} Einträge aus unauthentisierten Probes der ` +
        "Function-URLs (20:25–20:26 UTC), nicht aufgeführt.",
    );
  });

  it("names the burst count when several deploys were folded", () => {
    const entries = [
      ...probeBurst("2026-07-25T20:25:52.000Z"),
      ...probeBurst("2026-07-25T23:10:00.000Z"),
      ...REAL_WARNINGS,
    ];
    const mail = renderDigest(summarizeLogEntries(entries), opts);
    expect(mail.text).to.contain("(2 Bursts, 20:25–23:10 UTC)");
  });

  it("has no probe line on a day without probes", () => {
    const mail = renderDigest(summarizeLogEntries(REAL_WARNINGS), opts);
    expect(mail.text.match(PROBE_FOOTER)).to.equal(null);
    expect(mail.html.match(PROBE_FOOTER)).to.equal(null);
    expect(mail.text).to.not.contain("ausgeblendet");
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

  it("sends no mail on a day with nothing but the deploy probe", async () => {
    const burst = probeBurst();
    const h = harness(burst);
    const summary = await h.run();
    expect(h.sent).to.be.empty;
    expect(summary.total).to.equal(0);
    expect(summary.excluded?.count).to.equal(burst.length);
  });

  it("sends one mail for the probe plus one real warning", async () => {
    const h = harness([...probeBurst(), REAL_WARNINGS[0]]);
    const summary = await h.run();
    expect(h.sent).to.have.lengthOf(1);
    expect(summary.total).to.equal(1);
    expect(h.sent[0].subject).to.contain("1 Warnungen/Fehler in 1 Gruppen");
    expect(h.sent[0].text.match(PROBE_FOOTER)).to.have.lengthOf(1);
  });

  it("does not throw when no recipient is configured", async () => {
    const h = harness([entry()], "");
    const summary = await h.run();
    expect(h.sent).to.be.empty;
    expect(summary.total).to.equal(1);
  });
});
