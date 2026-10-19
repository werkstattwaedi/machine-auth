// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

/**
 * Wallee integration for the payment terminal at the kiosk (payment method
 * "wallee_terminal", ADR-0051).
 *
 * The kiosk drives the A35 over LTI and never reports a result to us; the
 * Wallee backend is the source of truth. Everything here reads it: the
 * webhook and the nightly reconcile re-read a transaction, check it and
 * hand it to `settleTerminalPayment`.
 *
 * The official `wallee` SDK is ~15 MB and loads every service on
 * `require`, so it is imported lazily inside the Wallee code paths — other
 * functions sharing an instance don't pay its load time on a cold start.
 * Tests replace the whole API with `setWalleeApiForTest`.
 */

import * as logger from "firebase-functions/logger";
import { defineSecret, defineString } from "firebase-functions/params";
import type { TerminalReferenceEnv } from "@oww/shared";

/** Application user's authentication key (base64), per project. */
export const walleeAuthKey = defineSecret("WALLEE_AUTH_KEY");

// The space, user and terminal are shared by staging and prod (one A35);
// empty values switch the integration off (`isWalleeConfigured`).
const walleeSpaceId = defineString("WALLEE_SPACE_ID", { default: "" });
const walleeUserId = defineString("WALLEE_USER_ID", { default: "" });
/**
 * The Wallee *backend* terminal id (`Transaction.terminal.id`), not the
 * EP2 terminal id the terminal reports over LTI.
 */
const walleeTerminalId = defineString("WALLEE_TERMINAL_ID", { default: "" });
/** "P" or "S": this environment's letter in terminal references. */
const walleeReferencePrefix = defineString("WALLEE_REFERENCE_PREFIX", { default: "" });

/** Webhook listener entity id of `Transaction` in Wallee's API. */
export const WALLEE_TRANSACTION_ENTITY_ID = 1472041829003;

/**
 * States in which an approved terminal payment counts as paid. It lands in
 * AUTHORIZED within a second of the tap and moves on to COMPLETED/FULFILL
 * at the terminal's daily closing (02:08) — both later states mean the
 * same money (spike, 2026-10-17).
 */
export const WALLEE_PAID_STATES: ReadonlySet<string> = new Set([
  "AUTHORIZED",
  "COMPLETED",
  "FULFILL",
]);

/** The fields of a Wallee transaction the settlement reads. */
export interface WalleeTransaction {
  id: number;
  state: string;
  /** CHF, as a decimal (3 = CHF 3.00). */
  authorizationAmount: number | null;
  currency: string | null;
  authorizedOn: Date | null;
  merchantReference: string | null;
  userInterfaceType: string | null;
  terminalId: number | null;
  /** What the person paid with ("Visa", "Mastercard", "TWINT"), if Wallee says. */
  paymentBrand: string | null;
}

export interface WalleeListener {
  id: number;
  name: string | null;
  state: string | null;
}

/** The part of the Wallee API we use; tests swap in a fake. */
export interface WalleeApi {
  getTransaction(id: number): Promise<WalleeTransaction>;
  /** Terminal transactions authorized since `since` that are in a paid state. */
  searchPaidTerminalTransactions(since: Date): Promise<WalleeTransaction[]>;
  /** The "Kunde" receipt text (40 columns, LF line ends), or null if none. */
  getCustomerReceiptText(transactionId: number): Promise<string | null>;
  /** Checks a webhook's `x-signature` header over the raw body. */
  isSignatureValid(signatureHeader: string, rawBody: string): Promise<boolean>;
  listWebhookListeners(): Promise<WalleeListener[]>;
}

export interface WalleeConfig {
  spaceId: number;
  userId: number;
  terminalId: number;
  referenceEnv: TerminalReferenceEnv;
}

/**
 * Null while any part of the configuration is missing — the terminal is
 * then offered nowhere and the webhook acknowledges without acting.
 */
export function walleeConfig(): WalleeConfig | null {
  const spaceId = Number(walleeSpaceId.value());
  const userId = Number(walleeUserId.value());
  const terminalId = Number(walleeTerminalId.value());
  const prefix = walleeReferencePrefix.value().trim();
  if (!spaceId || !userId || !terminalId) return null;
  if (prefix !== "P" && prefix !== "S") {
    if (prefix) logger.error(`WALLEE_REFERENCE_PREFIX must be "P" or "S", got "${prefix}"`);
    return null;
  }
  return { spaceId, userId, terminalId, referenceEnv: prefix };
}

/** The name the setup script gives this project's webhook listener. */
export function walleeListenerName(projectId: string): string {
  return `machine-auth ${projectId}`;
}

let testApi: WalleeApi | null = null;

/** Replaces the SDK-backed API in tests; pass null to restore it. */
export function setWalleeApiForTest(api: WalleeApi | null): void {
  testApi = api;
}

let sdkApi: { key: string; api: WalleeApi } | null = null;

/** The API for the current configuration. Throws when it's incomplete. */
export async function walleeApi(): Promise<WalleeApi> {
  if (testApi) return testApi;
  const config = walleeConfig();
  if (!config) throw new Error("Wallee is not configured");
  const authKey = walleeAuthKey.value();
  const key = `${config.spaceId}:${config.userId}:${authKey}`;
  if (sdkApi?.key !== key) {
    sdkApi = { key, api: await createSdkApi(config, authKey) };
  }
  return sdkApi.api;
}

async function createSdkApi(config: WalleeConfig, authKey: string): Promise<WalleeApi> {
  const sdk = await import("wallee");
  const configuration = new sdk.Configuration({
    httpBearerAuth: new sdk.HttpBearerAuth(config.userId, authKey),
  });
  const transactions = new sdk.TransactionsService(configuration);
  const keys = new sdk.WebhookEncryptionKeysService(configuration);
  const listeners = new sdk.WebhookListenersService(configuration);
  const space = config.spaceId;
  const expand = new Set(TRANSACTION_EXPAND);

  return {
    async getTransaction(id) {
      return toWalleeTransaction(
        await transactions.getPaymentTransactionsId({ id, space, expand }),
      );
    },
    async searchPaidTerminalTransactions(since) {
      const states = [...WALLEE_PAID_STATES].map((s) => `state:${s}`).join(" OR ");
      const query =
        `userInterfaceType:TERMINAL authorizedOn:>="${since.toISOString()}" (${states})`;
      const found: WalleeTransaction[] = [];
      // The window is a few days of one kiosk: a handful of pages at most.
      for (let offset = 0; offset < 2000; offset += 100) {
        const page = await transactions.getPaymentTransactionsSearch({
          space,
          query,
          limit: 100,
          offset,
          order: "authorizedOn:ASC",
          expand,
        });
        const data = page.data ?? [];
        found.push(...data.map(toWalleeTransaction));
        if (data.length < 100) break;
      }
      return found;
    },
    async getCustomerReceiptText(transactionId) {
      const res = await transactions.getPaymentTransactionsIdTerminalReceipts({
        id: transactionId,
        format: sdk.TerminalReceiptFormat.Txt,
        width: RECEIPT_WIDTH,
        space,
      });
      return customerReceiptText(res.data ?? []);
    },
    async isSignatureValid(signatureHeader, rawBody) {
      return keys.isContentValid(signatureHeader, rawBody);
    },
    async listWebhookListeners() {
      const res = await listeners.getWebhooksListenersSearch({ space, limit: 100 });
      return (res.data ?? []).map((l) => ({
        id: l.id ?? 0,
        name: l.name ?? null,
        state: (l.state as string | undefined) ?? null,
      }));
    },
  };
}

/**
 * Wallee leaves the connector configuration's references unresolved unless
 * asked. The card brand hangs off its connector; TWINT has no brand there,
 * only its payment method configuration (staging, 2026-10-19).
 */
const TRANSACTION_EXPAND = [
  "paymentConnectorConfiguration.connector.paymentMethodBrand",
  "paymentConnectorConfiguration.paymentMethodConfiguration",
];

/** Width of the terminal receipt Wallee renders for us (characters). */
export const RECEIPT_WIDTH = 40;

/** Wallee's id for the cardholder's receipt type ("Kunde"). */
const CUSTOMER_RECEIPT_TYPE_ID = 1562577925136;

/**
 * Picks the cardholder receipt out of a terminal-receipts response and
 * decodes it. Exported for unit tests.
 */
export function customerReceiptText(
  receipts: ReadonlyArray<{
    data?: string;
    mimeType?: string;
    receiptType?: { id?: number; name?: Record<string, string> };
  }>,
): string | null {
  const customer = receipts.find(
    (r) =>
      r.receiptType?.id === CUSTOMER_RECEIPT_TYPE_ID ||
      r.receiptType?.name?.["en-US"] === "Customer",
  );
  if (!customer?.data) return null;
  const text = Buffer.from(customer.data, "base64").toString("utf8");
  // CRLF from Wallee; trailing blank lines and padding carry no content.
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value) return new Date(value);
  return null;
}

/** Brand names are proper names, so any language will do; German first. */
function localized(names: Record<string, string> | undefined): string | null {
  if (!names) return null;
  return names["de-CH"] || names["de-DE"] || names["en-US"] || Object.values(names)[0] || null;
}

/** The card method's configuration name says nothing about the card. */
const GENERIC_CARD_METHOD_NAME = "Credit / Debit Card";

/** A payment method without brands (TWINT) is named by its configuration. */
function methodName(name: string | undefined): string | null {
  return name && name !== GENERIC_CARD_METHOD_NAME ? name : null;
}

/**
 * Normalizes an SDK transaction (or the raw JSON of one, in tests).
 * Exported for unit tests.
 */
export function toWalleeTransaction(raw: unknown): WalleeTransaction {
  const t = raw as {
    id?: number;
    state?: string;
    authorizationAmount?: number;
    currency?: string;
    authorizedOn?: Date | string;
    merchantReference?: string;
    userInterfaceType?: string;
    terminal?: { id?: number };
    paymentConnectorConfiguration?: {
      connector?: { paymentMethodBrand?: { name?: Record<string, string> } };
      paymentMethodConfiguration?: { name?: string };
    };
  };
  const connectorConfig = t.paymentConnectorConfiguration;
  return {
    id: Number(t.id),
    state: String(t.state ?? ""),
    authorizationAmount:
      typeof t.authorizationAmount === "number" ? t.authorizationAmount : null,
    currency: t.currency ?? null,
    authorizedOn: toDate(t.authorizedOn),
    merchantReference: t.merchantReference ?? null,
    userInterfaceType: t.userInterfaceType ?? null,
    terminalId: typeof t.terminal?.id === "number" ? t.terminal.id : null,
    paymentBrand:
      localized(connectorConfig?.connector?.paymentMethodBrand?.name) ??
      methodName(connectorConfig?.paymentMethodConfiguration?.name),
  };
}

/** A webhook delivery body. It carries ids only — never trust its `state`. */
export interface WalleeWebhookPayload {
  entityId: number;
  listenerEntityId: number;
  spaceId: number;
  state?: string;
  eventId?: number;
}

/** Null when the body isn't a webhook delivery. Exported for unit tests. */
export function parseWebhookPayload(rawBody: string): WalleeWebhookPayload | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const b = body as Partial<WalleeWebhookPayload>;
  if (
    typeof b?.entityId !== "number" ||
    typeof b.listenerEntityId !== "number" ||
    typeof b.spaceId !== "number"
  ) {
    return null;
  }
  return {
    entityId: b.entityId,
    listenerEntityId: b.listenerEntityId,
    spaceId: b.spaceId,
    state: typeof b.state === "string" ? b.state : undefined,
    eventId: typeof b.eventId === "number" ? b.eventId : undefined,
  };
}
