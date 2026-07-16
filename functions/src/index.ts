// Sets the global europe-west6 region (#211). MUST stay first — see options.ts
// for why import order matters.
import "./options";
import express from "express";
import { onRequest } from "firebase-functions/v2/https";
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

// Authentication middleware - accepts Particle webhook key or gateway key.
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

// Export bill lifecycle triggers + the daily auto-ack cron (#251).
export { onCheckoutClosed, onCheckoutCreatedClosed } from "./invoice/create_bill";

// Self-service badge purchase: associate tokens on checkout close. The
// callable (addBadgeToCheckout) is grouped into billingCall.
export { onCheckoutClosedAssociateBadges } from "./badge/associate_on_close";
export {
  onBillCreate,
  onBillUpdate,
  retryBillProcessing,
} from "./invoice/bill_triggers";
export { autoAcknowledgeBills } from "./invoice/acknowledge_bill";
export { monthlyBillRun } from "./invoice/monthly_bill_run";

// Membership callables are grouped into `membershipCall` (./membership/dispatcher).
// Here we export only the membership triggers + scheduled jobs. Membership
// activation runs from `onBillUpdate` (gated on the customer's payment-method
// ack), not on checkout close (#251 / #302).
export { onMembershipWritten } from "./membership/on_membership_written";
export { hourlyMembershipExpiryCheck } from "./membership/expiry_check";
export { issueMembershipRenewalBills } from "./membership/renewal_invoicer";

// Export scheduled cleanup
export { cleanupAbandonedCheckouts } from "./checkout/cleanup_abandoned_checkouts";

// Daily reminder for open checkouts a visitor walked away from (#531).
export { staleCheckoutReminders } from "./checkout/stale_checkout_reminders";

// Export Firestore triggers
export { syncCustomClaims } from "./auth/set-custom-claims";

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
