// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Single daily membership maintenance job: expiry flip + renewal invoicing.
 *
 * Both sweeps are day-granular, so they share one Cloud Scheduler job
 * (billed per job) instead of two. The fixed cron time matters: the renewal
 * invoicer's `[now+28d, now+30d)` slice relies on stable ~24h tick spacing —
 * "every 24 hours" scheduling can shift on redeploy, a fixed cron cannot.
 * 04:00 runs after `autoAcknowledgeBills` (03:00) and before `monthlyBillRun`
 * (06:00).
 */

import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { runMembershipExpiryCheck } from "./expiry_check";
import { runRenewalInvoicer } from "./renewal_invoicer";

/**
 * Core orchestration, exported for tests. The steps are independent (expiry
 * touches `validUntil < now`, renewal touches `validUntil ≈ +30d`), so each
 * runs in its own try/catch — one failing must not starve the other — and
 * the first failure is rethrown at the end so the scheduler still records
 * the run as failed.
 */
export async function runDailyMembershipMaintenance(
  steps: {
    expiryCheck: () => Promise<unknown>;
    renewalInvoicer: () => Promise<unknown>;
  } = {
    expiryCheck: () => runMembershipExpiryCheck(),
    renewalInvoicer: () => runRenewalInvoicer(),
  },
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await steps.expiryCheck();
  } catch (e) {
    logger.error("dailyMembershipMaintenance: expiry check failed", e);
    errors.push(e);
  }
  try {
    await steps.renewalInvoicer();
  } catch (e) {
    logger.error("dailyMembershipMaintenance: renewal invoicer failed", e);
    errors.push(e);
  }
  if (errors.length > 0) throw errors[0];
}

export const dailyMembershipMaintenance = onSchedule(
  {
    schedule: "0 4 * * *",
    timeZone: "Europe/Zurich",
    timeoutSeconds: 540,
  },
  async () => {
    await runDailyMembershipMaintenance();
  },
);
