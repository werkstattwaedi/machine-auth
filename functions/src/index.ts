import express from "express";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { defineSecret, defineString } from "firebase-functions/params";
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
import { handleVerifyTagCheckout } from "./checkout/verify_tag";
import { BinaryWriter } from "@bufbuild/protobuf/wire";

initializeApp();

const diversificationMasterKey = defineSecret("DIVERSIFICATION_MASTER_KEY");
const diversificationSystemName = defineString("DIVERSIFICATION_SYSTEM_NAME");
const particleWebhookApiKey = defineSecret("PARTICLE_WEBHOOK_API_KEY");
const gatewayApiKey = defineSecret("GATEWAY_API_KEY");
const terminalKey = defineSecret("TERMINAL_KEY");
// Soft revocation/audit knob for the kiosk's verifyTagCheckout call. NOT real
// kiosk attestation — extracting this from a public Windows machine is
// trivial. The actual security is the synthetic-UID custom token returned by
// verifyTagCheckout (see checkout/verify_tag.ts).
const kioskBearerKey = defineSecret("KIOSK_BEARER_KEY");

export const app = express();
app.use(express.json());

// Per-route middleware for the public verifyTagCheckout endpoint. Bearer is
// required in production; emulator mode skips it so E2E doesn't need the
// secret baked into seed data.
const kioskAuthMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn("Kiosk request missing Authorization header.");
    res.status(401).send({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.split(" ")[1];
  if (token !== kioskBearerKey.value()) {
    logger.warn("Kiosk request with invalid Bearer.");
    res.status(403).send({ error: "Forbidden" });
    return;
  }

  // Tag the request with kiosk identity for audit-friendly logging downstream.
  // Single-kiosk deployment for now; revisit when more kiosks are provisioned.
  (req as { kioskId?: string }).kioskId = "kiosk-1";
  next();
};

export const verifyTagCheckoutHandler = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const result = await handleVerifyTagCheckout(req.body, {
      terminalKey: terminalKey.value(),
      masterKey: diversificationMasterKey.value(),
      systemName: diversificationSystemName.value(),
    });

    res.status(200).contentType("application/json").send(result);
  } catch (error: any) {
    logger.error("Tag verification failed", { error: error.message });
    res.status(400).contentType("application/json").send({
      error: error.message || "Tag verification failed",
    });
  }
};

app.post("/verifyTagCheckout", kioskAuthMiddleware, verifyTagCheckoutHandler);

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
  const validKeys = [particleWebhookApiKey.value(), gatewayApiKey.value()];
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
    secrets: [
      diversificationMasterKey,
      particleWebhookApiKey,
      gatewayApiKey,
      terminalKey,
      kioskBearerKey,
    ],
  },
  app
);

// Export admin API
export { admin } from "./admin-api";

// Export callable functions
export { createUser } from "./auth/create-user";
export { requestLoginCode } from "./auth/login-code/request";
export { verifyLoginCode } from "./auth/login-code/verify-code";
export { verifyMagicLink } from "./auth/login-code/verify-link";
export { getInvoiceDownloadUrl } from "./invoice/get_invoice_download_url";
export { getPaymentQrData } from "./invoice/get_payment_qr_data";
export { closeCheckoutAndGetPayment } from "./invoice/close_checkout_and_get_payment";
export { logClientError } from "./util/log_client_error";

// Export bill lifecycle triggers
export { onCheckoutClosed, onCheckoutCreatedClosed } from "./invoice/create_bill";
export { onBillCreate, retryBillProcessing } from "./invoice/bill_triggers";

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
