// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Daily reminder for open checkouts a visitor walked away from (#531).
 *
 * A visitor who leaves without closing their checkout leaves
 * `checkouts/{id}` at `status: "open"`. The terminal already refuses to
 * badge them in on their next visit (#393) and the web root dispatcher
 * routes them to the checkout step with a banner — but nothing reaches out
 * *before* they return. This cron mails the account holder once the checkout
 * has been open past the workshop business day, at configurable business-day
 * offsets (default 1 and 7).
 *
 * Design notes:
 *   - "Stale" is measured with the same {@link businessDaysBetween} / 03:00
 *     Europe/Zurich business day the terminal gate uses (#268), so the mailer
 *     and the gate can never drift apart.
 *   - The offsets that trigger a reminder are config-only
 *     (`CHECKOUT_REMINDER_OFFSET_DAYS`, default `"1,7"`) — changing the
 *     cadence needs no schema or code change.
 *   - Each send appends a server `Timestamp` to `checkout.remindersSent`.
 *     The decision "which reminder is due" is derived purely from that array
 *     (how many fired so far → which offset is next) plus a one-per-business-
 *     day guard, so a re-run on the same day is a no-op and no reminder is
 *     ever sent twice.
 *   - No first-deploy backfill: reminders only go out for checkouts that
 *     become stale from now on (per the issue-#531 revision).
 *
 * Follows the `cleanupAbandonedCheckouts` idiom: an exported `run*(now)` core
 * (integration-testable without a scheduler runtime) plus a thin `onSchedule`
 * wrapper.
 */

import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineString } from "firebase-functions/params";
import { HttpsError } from "firebase-functions/v2/https";
import {
  getFirestore,
  Timestamp,
  FieldValue,
} from "firebase-admin/firestore";
import {
  businessDaysBetween,
  businessDayStart,
  isSameBusinessDay,
} from "@oww/shared";
import type { CheckoutEntity } from "../types/firestore_entities";
import { resolveRecipientEmail } from "../util/checkout_recipient";
import {
  resendApiKey,
  sendTemplate,
} from "../util/resend_template";

/** Resend template alias for the reminder email (operations-repo config). */
const resendCheckoutReminderTemplateId = defineString(
  "RESEND_CHECKOUT_REMINDER_TEMPLATE_ID",
);

/**
 * Comma-separated business-day offsets that each trigger one reminder, e.g.
 * `"1,7"` → a reminder the business day after the checkout opened, and again
 * six business days later. Config-only so the cadence can be retuned from the
 * operations repo without a code or schema change (#531). An unset/empty value
 * falls back to {@link DEFAULT_REMINDER_OFFSETS} — a param default alone isn't
 * materialised outside the deployed runtime (tests, emulator), so the fallback
 * is applied explicitly at read time.
 */
const checkoutReminderOffsetDaysParam = defineString(
  "CHECKOUT_REMINDER_OFFSET_DAYS",
  { default: "1,7" },
);

/** Built-in cadence when the config param is unset/empty: day 1 and day 7. */
const DEFAULT_REMINDER_OFFSETS = "1,7";

/**
 * Domain hosting the public checkout app (e.g. `checkout.werkstattwaedi.ch`).
 * Same param + no-silent-localhost contract as the price-list QR link (#248).
 */
const checkoutDomainParam = defineString("CHECKOUT_DOMAIN", { default: "" });

/**
 * Cap candidates scanned per run. Open checkouts are inherently few (the
 * terminal gate + abandoned-checkout cleanup keep the set small), so this is
 * a safety valve, not an expected limit.
 */
const BATCH_LIMIT = 500;

function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

/**
 * Parse `CHECKOUT_REMINDER_OFFSET_DAYS` into a sorted, de-duplicated list of
 * positive integer offsets. Fails loud on a malformed value rather than
 * silently disabling reminders (mirrors `parseIntParamOrDie`). Exported for
 * unit testing.
 */
export function parseReminderOffsets(value: string): number[] {
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const offsets = parts.map((s) => {
    const n = Number.parseInt(s, 10);
    if (Number.isNaN(n) || n <= 0 || String(n) !== s) {
      logger.error(
        `CHECKOUT_REMINDER_OFFSET_DAYS contains a non-positive-integer ` +
          `entry (${JSON.stringify(s)} in ${JSON.stringify(value)}).`,
      );
      throw new HttpsError(
        "failed-precondition",
        "CHECKOUT_REMINDER_OFFSET_DAYS is malformed",
      );
    }
    return n;
  });
  if (offsets.length === 0) {
    logger.error(
      `CHECKOUT_REMINDER_OFFSET_DAYS is empty (${JSON.stringify(value)}).`,
    );
    throw new HttpsError(
      "failed-precondition",
      "CHECKOUT_REMINDER_OFFSET_DAYS is empty",
    );
  }
  // Sort ascending + de-dup so the "next reminder" index maps to a stable
  // threshold regardless of how ops ordered the config.
  return [...new Set(offsets)].sort((a, b) => a - b);
}

/**
 * Decide which reminder offset (if any) is due for a checkout right now.
 *
 * Pure and unit-testable. Returns the business-day offset to fire, or `null`
 * when nothing is due. Derived entirely from the observable state:
 *   - `staleDays` — business days since the checkout opened.
 *   - `remindersSent` — how many reminders already fired (its length picks the
 *     next offset) and when the last one fired (the one-per-business-day
 *     idempotency guard).
 *
 * Reminders fire strictly in offset order, at most one per checkout per
 * business day. A missed cron tick can't skip a reminder (we compare with
 * `>=`, not `==`) and a same-day re-run is always a no-op.
 */
export function selectDueReminderOffset(params: {
  now: Date;
  created: Date;
  remindersSent: Date[];
  offsets: number[];
}): number | null {
  const { now, created, remindersSent, offsets } = params;
  const staleDays = businessDaysBetween(created, now);
  if (staleDays < 1) return null;

  // At most one reminder per checkout per business day. Guards against a
  // same-day re-run double-sending even when several offsets are already due
  // (e.g. a checkout that jumped straight past offset 7).
  const lastSent = remindersSent[remindersSent.length - 1];
  if (lastSent && isSameBusinessDay(lastSent, now)) return null;

  const nextIndex = remindersSent.length;
  if (nextIndex >= offsets.length) return null; // all reminders already sent

  const offset = offsets[nextIndex];
  return staleDays >= offset ? offset : null;
}

/** Format the checkout's open date for the email body (Europe/Zurich). */
function formatCheckoutDate(created: Date): string {
  return new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(created);
}

/**
 * Resolve the checkout domain at run time. In production the param must be
 * set (no silent `localhost` — same contract as the price-list QR, #248); in
 * the emulator it defaults to `localhost:5173`.
 */
function resolveCheckoutDomain(): string {
  const value = checkoutDomainParam.value();
  if (isEmulator()) return value.trim() || "localhost:5173";
  if (value.trim().length === 0) {
    logger.error(
      "CHECKOUT_DOMAIN is empty in production — stale-checkout reminder " +
        "links cannot be built. Set the param via firebase functions:config " +
        "or regenerate functions/.env.<projectId> via `npm run generate-env`.",
    );
    throw new HttpsError(
      "failed-precondition",
      "CHECKOUT_DOMAIN is not configured",
    );
  }
  return value.trim();
}

/**
 * Deep link the reminder email points at. The checkout id is carried in the
 * path so the `/checkout/<id>` route can catch a stale/wrong-user sign-in and
 * use the id as a hint (#531). Exported for unit testing.
 */
export function buildCheckoutReminderLink(
  domain: string,
  checkoutId: string,
): string {
  return `https://${domain}/checkout/${checkoutId}`;
}

export interface ReminderRunSummary {
  scanned: number;
  remindersSent: number;
  skippedNoEmail: number;
  skippedNotDue: number;
}

/**
 * Core loop, exported so the integration test can invoke it directly against
 * the Firestore emulator without a scheduler runtime. `now` is injectable so
 * tests can freeze the clock.
 */
export async function runStaleCheckoutReminders(
  now: Date = new Date(),
): Promise<ReminderRunSummary> {
  const db = getFirestore();
  const offsets = parseReminderOffsets(
    checkoutReminderOffsetDaysParam.value().trim() || DEFAULT_REMINDER_OFFSETS,
  );

  // Cost prefilter on the existing `status ASC, created ASC` composite index
  // (firestore.indexes.json): only open checkouts opened before the current
  // business day started can possibly be stale. Each candidate is then
  // re-checked with the exact business-day math below.
  const cutoff = Timestamp.fromDate(businessDayStart(now));
  const snap = await db
    .collection("checkouts")
    .where("status", "==", "open")
    .where("created", "<", cutoff)
    .orderBy("created", "asc")
    .limit(BATCH_LIMIT)
    .get();

  const summary: ReminderRunSummary = {
    scanned: snap.size,
    remindersSent: 0,
    skippedNoEmail: 0,
    skippedNotDue: 0,
  };

  const domain = snap.empty ? "" : resolveCheckoutDomain();

  for (const doc of snap.docs) {
    const checkout = doc.data() as CheckoutEntity & {
      remindersSent?: Timestamp[];
    };

    const created = checkout.created?.toDate?.();
    if (!created) {
      summary.skippedNotDue += 1;
      continue;
    }

    const sentDates = (checkout.remindersSent ?? []).map((ts) => ts.toDate());
    const dueOffset = selectDueReminderOffset({
      now,
      created,
      remindersSent: sentDates,
      offsets,
    });
    if (dueOffset === null) {
      summary.skippedNotDue += 1;
      continue;
    }

    // Anonymous checkouts (no account holder) and account holders with no
    // email are skipped WITHOUT stamping — a later email addition still lets
    // the next run reach them at the same offset. `cleanupAbandonedCheckouts`
    // reaps abandoned anonymous checkouts on its own schedule.
    const recipient = await resolveRecipientEmail(checkout);
    if (!recipient) {
      summary.skippedNoEmail += 1;
      continue;
    }

    const recipientName = checkout.persons?.[0]?.name?.trim() || "";
    const variables = {
      RECIPIENT_NAME: recipientName,
      CHECKOUT_DATE: formatCheckoutDate(created),
      CHECKOUT_LINK: buildCheckoutReminderLink(domain, doc.id),
      STALE_DAYS: String(businessDaysBetween(created, now)),
      REMINDER_OFFSET: String(dueOffset),
    };

    // Stamp before the send so a Resend failure can't cause a retry storm:
    // this is deliberately at-most-once per offset. A lost early reminder is
    // still followed by the later one; a lost final reminder is logged.
    await doc.ref.update({
      remindersSent: FieldValue.arrayUnion(Timestamp.fromDate(now)),
    });

    if (isEmulator()) {
      logger.info(
        `[stale-checkout-reminder] EMULATOR would email ${recipient} ` +
          `for checkout ${doc.id} (offset ${dueOffset}, link ` +
          `${variables.CHECKOUT_LINK})`,
      );
    } else {
      try {
        await sendTemplate({
          to: recipient,
          templateId: resendCheckoutReminderTemplateId.value(),
          templateIdParam: "RESEND_CHECKOUT_REMINDER_TEMPLATE_ID",
          variables,
        });
      } catch (error) {
        // Already stamped — log and move on rather than unwinding committed
        // state (mirrors membership/invite.ts). At-most-once by design.
        logger.error(
          `Stale-checkout reminder send failed for checkout ${doc.id}`,
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }

    summary.remindersSent += 1;
  }

  logger.info("Stale-checkout reminder run complete", { ...summary, offsets });
  return summary;
}

/**
 * Scheduled trigger. 09:00 Europe/Zurich sits safely after the 03:00
 * business-day rollover (so "yesterday's" checkout is unambiguously stale)
 * and at a civil hour. Region `europe-west6` is inherited from
 * `setGlobalOptions` (functions/src/options.ts).
 */
export const staleCheckoutReminders = onSchedule(
  {
    schedule: "0 9 * * *",
    timeZone: "Europe/Zurich",
    timeoutSeconds: 540,
    secrets: [resendApiKey],
  },
  async () => {
    await runStaleCheckoutReminders();
  },
);
