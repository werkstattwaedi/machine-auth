// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Daily digest of WARNING-and-above Cloud Logging entries.
 *
 * Why this exists: a rejected request driven by untrusted client input (a
 * malformed SDM URL, a duplicate submit, a bot GETting a callable's root)
 * is not a server fault. Logging those at ERROR let any external client
 * page us at will, so they log at `warn` instead — see the rationale in
 * `checkout/verify_tag.ts`. Warnings still carry the signal we actually
 * debug from (notably the `clientError` records the web app reports via
 * `logClientError`), they just don't deserve a pager. This job batches
 * them into one mail a day.
 *
 * Daily rather than weekly on purpose: the categories are new and we want
 * to see a bad pattern within a day, not six days late. Widening the
 * cadence later is a one-line schedule change.
 */

import * as logger from "firebase-functions/logger";
import { defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  summarizeLogEntries,
  type LogSummary,
  type RawLogEntry,
} from "@oww/shared";
import { resendApiKey, resendFromEmail } from "./resend_template";

export type { RawLogEntry };

/** Recipient of the digest. Empty (unconfigured) skips the send. */
export const logDigestEmail = defineString("LOG_DIGEST_EMAIL", { default: "" });

/** Lookback window. Matches the daily schedule with no gap or overlap. */
export const DIGEST_LOOKBACK_HOURS = 24;

/**
 * Hard cap on entries pulled per run. A genuine flood would otherwise turn
 * one mail into a megabyte; the digest reports when it truncates rather
 * than silently under-reporting (a summary that hides its own limits is
 * worse than no summary).
 */
export const DIGEST_MAX_ENTRIES = 2000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface DigestMail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Render the digest. Plain text carries the full content; the HTML part is
 * the same thing in a monospace table so it stays readable in a mail
 * client without pulling in a template.
 */
export function renderDigest(
  summary: LogSummary,
  opts: { projectId: string; since: Date; until: Date },
): DigestMail {
  const { projectId, since, until } = opts;
  const window = `${since.toISOString()} → ${until.toISOString()}`;
  const subject =
    `[${projectId}] ${summary.total} Warnungen/Fehler ` +
    `in ${summary.groups.length} Gruppen`;

  const lines: string[] = [
    `Projekt: ${projectId}`,
    `Zeitraum: ${window}`,
    `Einträge: ${summary.total} in ${summary.groups.length} Gruppen`,
  ];
  if (summary.truncated) {
    lines.push(
      `ACHTUNG: Limit von ${DIGEST_MAX_ENTRIES} Einträgen erreicht — ` +
        "ältere Einträge fehlen in dieser Übersicht.",
    );
  }
  lines.push("");

  for (const group of summary.groups) {
    const services =
      group.services.length > 4
        ? `${group.services.slice(0, 4).join(", ")} +${group.services.length - 4}`
        : group.services.join(", ");
    lines.push(`${group.severity}  ×${group.count}  ${group.message}`);
    lines.push(`  services: ${services}`);
    lines.push(`  ${group.firstTimestamp} → ${group.lastTimestamp}`);
    for (const sample of group.samples) lines.push(`  - ${sample}`);
    lines.push("");
  }

  const rows = summary.groups
    .map(
      (group) =>
        `<tr>` +
        `<td>${escapeHtml(group.severity)}</td>` +
        `<td align="right">${group.count}</td>` +
        `<td>${escapeHtml(group.message)}</td>` +
        `<td align="right">${group.services.length}</td>` +
        `<td>${escapeHtml(group.lastTimestamp)}</td>` +
        `</tr>` +
        `<tr><td colspan="5"><pre style="margin:0 0 8px 0">` +
        escapeHtml(
          `${group.services.join(", ")}\n${group.samples.join("\n")}`,
        ) +
        `</pre></td></tr>`,
    )
    .join("");

  const html =
    `<div style="font-family:ui-monospace,monospace;font-size:13px">` +
    `<p><strong>${escapeHtml(projectId)}</strong><br>` +
    `${escapeHtml(window)}<br>` +
    `${summary.total} Einträge in ${summary.groups.length} Gruppen</p>` +
    (summary.truncated
      ? `<p><strong>Limit von ${DIGEST_MAX_ENTRIES} Einträgen erreicht — ` +
        `ältere Einträge fehlen.</strong></p>`
      : "") +
    `<table cellpadding="4" style="border-collapse:collapse">` +
    `<tr><th align="left">Severity</th><th>Anzahl</th>` +
    `<th align="left">Meldung</th><th>Services</th>` +
    `<th align="left">Zuletzt</th></tr>` +
    rows +
    `</table></div>`;

  return { subject, text: lines.join("\n"), html };
}

/**
 * Pull the window's entries out of Cloud Logging. Lazy-imports the client
 * so the SDK stays out of every other function's cold-start bundle.
 */
async function fetchLogEntries(
  projectId: string,
  since: Date,
): Promise<{ entries: RawLogEntry[]; truncated: boolean }> {
  const { Logging } = await import("@google-cloud/logging");
  const logging = new Logging({ projectId });
  const filter =
    `resource.type="cloud_run_revision" AND severity>=WARNING ` +
    `AND timestamp>="${since.toISOString()}"`;

  const [found] = await logging.getEntries({
    filter,
    orderBy: "timestamp desc",
    pageSize: DIGEST_MAX_ENTRIES,
    autoPaginate: false,
  });

  const entries: RawLogEntry[] = found.map((entry) => {
    const metadata = entry.metadata as {
      severity?: string;
      timestamp?: string | Date;
      resource?: { labels?: { service_name?: string } };
    };
    const data = entry.data as unknown;

    let message: string;
    let detail: Record<string, unknown> | undefined;
    if (typeof data === "string") {
      message = data;
    } else if (data && typeof data === "object") {
      const payload = data as Record<string, unknown>;
      const { message: payloadMessage, ...rest } = payload;
      message =
        typeof payloadMessage === "string"
          ? payloadMessage
          : JSON.stringify(payload);
      if (Object.keys(rest).length > 0) detail = rest;
    } else {
      message = String(data ?? "");
    }

    const timestamp = metadata.timestamp;
    return {
      severity: metadata.severity ?? "DEFAULT",
      service: metadata.resource?.labels?.service_name ?? "unknown",
      timestamp:
        timestamp instanceof Date
          ? timestamp.toISOString()
          : String(timestamp ?? ""),
      message,
      detail,
    };
  });

  return { entries, truncated: entries.length >= DIGEST_MAX_ENTRIES };
}

/**
 * Core job, exported for tests with both side effects injected.
 *
 * Returns the summary so a caller (test or manual invocation) can assert on
 * it. A quiet day sends nothing — a daily "0 Einträge" mail is exactly the
 * kind of message that trains you to stop reading it.
 */
export async function runLogDigest(
  deps: {
    projectId: string;
    now: Date;
    recipient: string;
    fetchEntries: (
      projectId: string,
      since: Date,
    ) => Promise<{ entries: RawLogEntry[]; truncated: boolean }>;
    sendMail: (mail: DigestMail & { to: string }) => Promise<void>;
  },
): Promise<LogSummary> {
  const { projectId, now, recipient, fetchEntries, sendMail } = deps;
  const since = new Date(now.getTime() - DIGEST_LOOKBACK_HOURS * 3600_000);

  const { entries, truncated } = await fetchEntries(projectId, since);
  const summary = summarizeLogEntries(entries, truncated);

  if (summary.total === 0) {
    logger.info("logDigest: nothing to report", {
      since: since.toISOString(),
    });
    return summary;
  }

  if (!recipient) {
    // Visible on purpose: the job ran, found something, and had nowhere to
    // send it. Set LOG_DIGEST_EMAIL in the operations config.
    logger.warn("logDigest: LOG_DIGEST_EMAIL is unset — digest not sent", {
      total: summary.total,
      groups: summary.groups.length,
    });
    return summary;
  }

  const mail = renderDigest(summary, { projectId, since, until: now });
  await sendMail({ ...mail, to: recipient });
  logger.info("logDigest: sent", {
    total: summary.total,
    groups: summary.groups.length,
    truncated: summary.truncated,
  });
  return summary;
}

async function sendDigestMail(
  mail: DigestMail & { to: string },
): Promise<void> {
  const { Resend } = await import("resend");
  const resend = new Resend(resendApiKey.value());
  const { error } = await resend.emails.send({
    from: resendFromEmail.value(),
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  if (error) {
    logger.error("logDigest: Resend send failed", { error });
    throw new Error(`Resend send failed: ${error.message ?? "unknown"}`);
  }
}

/**
 * 07:00 Europe/Zurich: after the nightly crons (03:00 auto-ack, 04:00
 * membership maintenance, 06:00 monthly bill run) so their warnings land in
 * the same day's digest rather than the next one's.
 */
export const dailyLogDigest = onSchedule(
  {
    schedule: "0 7 * * *",
    timeZone: "Europe/Zurich",
    timeoutSeconds: 540,
    secrets: [resendApiKey],
  },
  async () => {
    if (process.env.FUNCTIONS_EMULATOR === "true") {
      logger.info("logDigest: skipped in emulator");
      return;
    }
    const projectId =
      process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "";
    await runLogDigest({
      projectId,
      now: new Date(),
      recipient: logDigestEmail.value().trim(),
      fetchEntries: fetchLogEntries,
      sendMail: sendDigestMail,
    });
  },
);
