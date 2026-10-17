// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Wallee entry points (ADR-0051): the webhook that settles a terminal
 * payment within a second of the tap, and the nightly reconcile that
 * catches whatever a lost delivery missed.
 *
 * Both only *read* Wallee and hand the transaction to
 * `settleTerminalPayment`; neither trusts a webhook body beyond its ids.
 */

import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  WALLEE_TRANSACTION_ENTITY_ID,
  parseWebhookPayload,
  walleeApi,
  walleeAuthKey,
  walleeConfig,
  walleeListenerName,
} from "./wallee";
import {
  settleTerminalPayment,
  settleTransaction,
  type SettleOutcome,
} from "../invoice/terminal_payment";

/** How far back the reconcile looks (days); settled ones are no-ops. */
const RECONCILE_WINDOW_DAYS = 3;

/** Wallee's deliveries are ~250 bytes; anything far larger is not one. */
const MAX_BODY_BYTES = 16 * 1024;

export interface WebhookRequest {
  method: string;
  rawBody: Buffer | undefined;
  signature: string | undefined;
}

export interface WebhookReply {
  status: number;
  body: string;
}

/**
 * The webhook's logic without the HTTP framework, for tests. 200 tells
 * Wallee the delivery is done (also for what we deliberately ignore); 5xx
 * makes it retry. Wallee deactivates a listener that keeps failing, so
 * only transient errors may answer 5xx.
 */
export async function handleWalleeWebhook(req: WebhookRequest): Promise<WebhookReply> {
  if (req.method !== "POST") return { status: 405, body: "method not allowed" };
  const config = walleeConfig();
  // Not set up in this environment: acknowledge, so Wallee doesn't
  // deactivate a listener someone registered early.
  if (!config) return { status: 200, body: "not configured" };

  const raw = req.rawBody;
  if (!raw || raw.length === 0 || raw.length > MAX_BODY_BYTES) {
    return { status: 400, body: "bad request" };
  }
  const rawBody = raw.toString("utf8");

  const api = await walleeApi();
  let valid = false;
  try {
    valid = !!req.signature && (await api.isSignatureValid(req.signature, rawBody));
  } catch (err) {
    // The SDK fetches the signing key from Wallee; failing to reach it is
    // transient, not proof of forgery.
    logger.error("wallee_webhook_key_fetch_failed", {
      event: "wallee_webhook_key_fetch_failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 503, body: "retry" };
  }
  if (!valid) {
    logger.warn("wallee_webhook_bad_signature", {
      event: "wallee_webhook_bad_signature",
      bytes: raw.length,
    });
    return { status: 401, body: "invalid signature" };
  }

  const payload = parseWebhookPayload(rawBody);
  if (
    !payload ||
    payload.spaceId !== config.spaceId ||
    payload.listenerEntityId !== WALLEE_TRANSACTION_ENTITY_ID
  ) {
    return { status: 200, body: "ignored" };
  }

  let outcome: SettleOutcome;
  try {
    outcome = await settleTerminalPayment(payload.entityId, "webhook");
  } catch (err) {
    logger.error("wallee_webhook_settle_failed", {
      event: "wallee_webhook_settle_failed",
      transactionId: payload.entityId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 500, body: "retry" };
  }
  return { status: 200, body: outcome };
}

export const walleeWebhook = onRequest(
  {
    // Wallee calls it unauthenticated; the ECDSA signature is the gate.
    invoker: "public",
    secrets: [walleeAuthKey],
    // One kiosk: a handful of deliveries per payment.
    maxInstances: 5,
    memory: "512MiB",
  },
  async (req, res) => {
    const reply = await handleWalleeWebhook({
      method: req.method,
      rawBody: (req as unknown as { rawBody?: Buffer }).rawBody,
      signature: req.get("x-signature") ?? undefined,
    });
    res.status(reply.status).type("text/plain").send(reply.body);
  },
);

export interface ReconcileReport {
  checked: number;
  outcomes: Partial<Record<SettleOutcome, number>>;
  listenerActive: boolean | null;
}

/**
 * Settles every paid terminal transaction of the last few days that a lost
 * webhook left behind, and checks that this project's listener is still
 * active. Exported for tests.
 */
export async function runReconcileTerminalPayments(
  now: Date = new Date(),
): Promise<ReconcileReport | null> {
  const config = walleeConfig();
  if (!config) return null;
  const api = await walleeApi();
  const since = new Date(now.getTime() - RECONCILE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const outcomes: Partial<Record<SettleOutcome, number>> = {};
  const transactions = await api.searchPaidTerminalTransactions(since);
  for (const transaction of transactions) {
    // One bad transaction must not stop the others.
    try {
      const outcome = await settleTransaction(transaction, "reconcile", config);
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      if (outcome === "settled") {
        // Its webhook never got through: worth knowing why.
        logger.warn("terminal_payment_reconciled", {
          event: "terminal_payment_reconciled",
          transactionId: transaction.id,
          reference: transaction.merchantReference,
        });
      }
    } catch (err) {
      logger.error("terminal_reconcile_failed", {
        event: "terminal_reconcile_failed",
        transactionId: transaction.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Wallee deactivates a listener whose deliveries keep failing; then only
  // this job would settle payments, a night late.
  let listenerActive: boolean | null = null;
  try {
    const projectId = process.env.GCLOUD_PROJECT ?? "";
    const ours = (await api.listWebhookListeners()).filter(
      (l) => l.name === walleeListenerName(projectId),
    );
    listenerActive = ours.some((l) => l.state === "ACTIVE");
    if (!listenerActive) {
      logger.error("wallee_webhook_inactive", {
        event: "wallee_webhook_inactive",
        listeners: ours.map((l) => ({ id: l.id, state: l.state })),
      });
    }
  } catch (err) {
    logger.error("wallee_listener_check_failed", {
      event: "wallee_listener_check_failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info("terminal_reconcile_done", {
    event: "terminal_reconcile_done",
    checked: transactions.length,
    outcomes,
  });
  return { checked: transactions.length, outcomes, listenerActive };
}

export const reconcileTerminalPayments = onSchedule(
  {
    // Before the 05:00 stats export, after the terminal's 02:08 closing.
    schedule: "30 4 * * *",
    timeZone: "Europe/Zurich",
    timeoutSeconds: 300,
    secrets: [walleeAuthKey],
  },
  async () => {
    await runReconcileTerminalPayments();
  },
);
