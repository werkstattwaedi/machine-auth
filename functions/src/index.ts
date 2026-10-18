// Sets the global europe-west6 region (#211). MUST stay first — see options.ts
// for why import order matters.
import "./options";
import express from "express";
import { onRequest } from "firebase-functions/v2/https";
import { createMintTestTap } from "./testing/mint_test_tap";
import { isStagingProject } from "./testing/staging_guard";
import { createUploadTestUsage } from "./testing/upload_test_usage";
import { BUILD_VERSION } from "./util/build_info";
import { deviceStatusHandler } from "./device_status/handle_device_status";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import {
  TerminalCheckinRequest,
  TerminalCheckinResponse,
  AuthenticateTagRequest,
  AuthenticateTagResponse,
  CompleteTagAuthRequest,
  CompleteTagAuthResponse,
} from "./proto/firebase_rpc/auth.js";
import {
  UploadUsageRequest,
  UploadUsageResponse,
} from "./proto/firebase_rpc/usage.js";
import { handleTerminalCheckin } from "./auth/handle_terminal_checkin";
import { handleAuthenticateTag } from "./auth/handle_authenticate_tag";
import { handleCompleteTagAuth } from "./auth/handle_complete_tag_auth";
import { handleUploadUsage } from "./session/handle_upload_usage";
import {
  terminalKey,
  diversificationMasterKey,
  diversificationSystemName,
} from "./config/tag-secrets";
import { BinaryWriter } from "@bufbuild/protobuf/wire";

initializeApp();

const gatewayApiKey = defineSecret("GATEWAY_API_KEY");

export const app = express();
app.use(express.json());

// Authentication middleware - accepts the gateway API key.
const authMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn("Missing or invalid Authorization header.");
    return res.status(401).send({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  const validKeys = [gatewayApiKey.value()];
  if (!validKeys.includes(token)) {
    logger.warn("Invalid API key provided.");
    return res.status(403).send({ message: "Forbidden" });
  }

  next();
  return;
};

app.use(authMiddleware);

// Bearer-checked no-op that reports the deployed release version
// (ADR-0045) — the gateway's former keep-warm target (ADR-0037), now kept
// for manual checks. Touches no Firestore and decodes no payload.
app.get("/ping", (_req: express.Request, res: express.Response) => {
  res.status(200).send({ ok: true, version: BUILD_VERSION });
});

// Gateway heartbeat + terminal status (ADR-0045, phase 2c). Every 5 minutes
// around the clock, so it also keeps this function warm (it replaced the
// gateway's opening-hours warm ping, ADR-0037).
app.post("/device-status", (req: express.Request, res: express.Response) => {
  deviceStatusHandler(req, res).catch((error) => {
    logger.error("device-status failed", { error: (error as Error).message });
    res.status(500).send({ message: "Internal error" });
  });
});

// Middleware to attach config to request
app.use(
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    (req as any).config = {
      masterKey: diversificationMasterKey.value(),
      systemName: diversificationSystemName.value(),
      terminalKey: terminalKey.value(),
    };
    next();
  }
);

// === Auth Handlers ===

export const terminalCheckinHandler = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const request = decodeProtoRequest(req, TerminalCheckinRequest.decode);
    const response = await handleTerminalCheckin(request, (req as any).config);
    sendProtoResponse(req, res, response, TerminalCheckinResponse.encode);
  } catch (error: any) {
    sendHttpError(req, res, error);
  }
};

export const authenticateTagHandler = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const request = decodeProtoRequest(req, AuthenticateTagRequest.decode);
    const response = await handleAuthenticateTag(request, (req as any).config);
    sendProtoResponse(req, res, response, AuthenticateTagResponse.encode);
  } catch (error: any) {
    sendHttpError(req, res, error);
  }
};

export const completeTagAuthHandler = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const request = decodeProtoRequest(req, CompleteTagAuthRequest.decode);
    const response = await handleCompleteTagAuth(request, (req as any).config);
    sendProtoResponse(req, res, response, CompleteTagAuthResponse.encode);
  } catch (error: any) {
    sendHttpError(req, res, error);
  }
};

// === Usage Handler ===

export const uploadUsageHandler = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const request = decodeProtoRequest(req, UploadUsageRequest.decode);
    const response = await handleUploadUsage(request, (req as any).config);
    sendProtoResponse(req, res, response, UploadUsageResponse.encode);
  } catch (error: any) {
    sendHttpError(req, res, error);
  }
};

// Register routes
app.post("/terminalCheckin", terminalCheckinHandler);
app.post("/authenticateTag", authenticateTagHandler);
app.post("/completeTagAuth", completeTagAuthHandler);
app.post("/uploadUsage", uploadUsageHandler);

function decodeProtoRequest<T>(
  req: express.Request,
  decode: (bytes: Uint8Array) => T
): T {
  if (req.method !== "POST") {
    throw new Error("Method Not Allowed.");
  }

  const base64Payload = req.body.data;

  if (typeof base64Payload !== "string" || base64Payload.trim() === "") {
    throw new Error("Missing request payload.");
  }

  try {
    const bytes = new Uint8Array(Buffer.from(base64Payload, "base64"));
    return decode(bytes);
  } catch (e: any) {
    throw new Error(`Invalid payload: ${e.message}`);
  }
}

function sendHttpError(
  req: express.Request,
  res: express.Response,
  error: any
) {
  console.log("Request Failed!", error);
  const message = error instanceof Error ? error.message : "Unknown Error";

  res.status(400).contentType("application/json").send({
    id: req.body.id,
    message: message,
  });
}

function sendProtoResponse<T>(
  req: express.Request,
  res: express.Response,
  message: T,
  encode: (message: T, writer?: BinaryWriter) => BinaryWriter
) {
  const writer = encode(message);
  const responseBytes = writer.finish();
  const responseBase64 = Buffer.from(responseBytes).toString("base64");

  res.status(200).contentType("application/json").send({
    id: req.body.id,
    data: responseBase64,
  });
}

export const api = onRequest(
  {
    secrets: [diversificationMasterKey, gatewayApiKey, terminalKey],
    memory: "512MiB",
  },
  app
);

// Export admin API
export { admin } from "./admin-api";

// STAGING-ONLY smoke-test tooling: mints badge taps for virtual tags. The
// export is `undefined` for every other project, so discovery — which runs
// with GCLOUD_PROJECT set to the deploy target — never puts it into a
// production manifest. The handler re-checks the project at runtime. See
// ./testing/mint_test_tap.ts for why this must never exist in production.
export const mintTestTap = isStagingProject() ? createMintTestTap() : undefined;
// Same contract: reports a machine session for a smoke-test account.
export const uploadTestUsage = isStagingProject()
  ? createUploadTestUsage()
  : undefined;

// Export grouped callable dispatchers (#277). The ~20 individual callables
// collapsed into one onCall per domain, so a session that touches several
// reuses one warm instance instead of cold-starting each. See ./rpc/dispatch.
export { authCall } from "./auth/dispatcher";
export { membershipCall } from "./membership/dispatcher";
export { billingCall } from "./invoice/dispatcher";
export { catalogCall } from "./catalog/dispatcher";

// logClientError stays standalone: it's the unauthenticated, fire-and-forget
// error reporter and must not depend on a dispatcher that may itself be failing.
export { logClientError } from "./util/log_client_error";

// Daily batched digest of WARNING-and-above logs. Client-input rejections
// log at warn (they must not page us), so this is how those — and the
// clientError records the web app reports — actually get looked at.
export { dailyLogDigest } from "./util/log_digest";

// Bill lifecycle triggers. Every close mints its bill itself, committed
// (#750, #757), so there is no checkout trigger or overnight commit.
// Self-service badge purchase: associate tokens on checkout close. The
// callable (addBadgeToCheckout) is grouped into billingCall.
export { onCheckoutClosedAssociateBadges } from "./badge/associate_on_close";
export {
  onBillCreate,
  onBillUpdate,
  retryBillProcessing,
} from "./invoice/bill_triggers";
// Wallee terminal (ADR-0051): the signed webhook settles a terminal
// payment; the nightly job settles what a lost delivery missed.
export {
  walleeWebhook,
  reconcileTerminalPayments,
} from "./payments/wallee_webhook";
export { monthlyBillRun } from "./invoice/monthly_bill_run";

// Membership callables are grouped into `membershipCall` (./membership/dispatcher).
// Here we export only the membership triggers + scheduled jobs. Membership
// activation runs from `onBillUpdate` (gated on the customer's payment-method
// ack), not on checkout close (#251 / #302).
export { onMembershipWritten } from "./membership/on_membership_written";
export { dailyMembershipMaintenance } from "./membership/daily_maintenance";

// Export scheduled cleanup
export { cleanupAbandonedCheckouts } from "./checkout/cleanup_abandoned_checkouts";

// Daily pseudonymized stats export to BigQuery (ADR-0039).
export { dailyStatsExport } from "./stats/export_job";

// Daily reminder for open checkouts a visitor walked away from (#531).
export { staleCheckoutReminders } from "./checkout/stale_checkout_reminders";

// Export Firestore triggers
export { syncCustomClaims } from "./auth/set-custom-claims";
export { syncAuthIdentity } from "./auth/sync-auth-identity";

// Export audit triggers
export {
  auditUsers,
  auditTokens,
  auditMachine,
  auditPermission,
  auditMaco,
  auditUsageMachine,
  auditCheckouts,
  auditCatalog,
  auditBills,
} from "./audit/audit-trigger";
