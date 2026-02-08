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
import {
  KeyDiversificationRequest,
  KeyDiversificationResponse,
} from "./proto/firebase_rpc/personalization.js";
import { handleTerminalCheckin } from "./auth/handle_terminal_checkin";
import { handleAuthenticateTag } from "./auth/handle_authenticate_tag";
import { handleCompleteTagAuth } from "./auth/handle_complete_tag_auth";
import { handleUploadUsage } from "./session/handle_upload_usage";
import { handleKeyDiversification } from "./personalization/handle_key_diversification";
import { handleVerifyTagCheckout } from "./checkout/verify_tag";
import { BinaryWriter } from "@bufbuild/protobuf/wire";

initializeApp();

const diversificationMasterKey = defineSecret("DIVERSIFICATION_MASTER_KEY");
const diversificationSystemName = defineString("DIVERSIFICATION_SYSTEM_NAME");
const particleWebhookApiKey = defineSecret("PARTICLE_WEBHOOK_API_KEY");
const gatewayApiKey = defineSecret("GATEWAY_API_KEY");
const terminalKey = defineSecret("TERMINAL_KEY");

export const app = express();
app.use(express.json());

// Public endpoint for tag-based checkout (no auth required)
// Must be registered BEFORE auth middleware
export const verifyTagCheckoutHandler = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const result = await handleVerifyTagCheckout(req.body, {
      terminalKey: terminalKey.value(),
    });

    res.status(200).contentType("application/json").send(result);
  } catch (error: any) {
    logger.error("Tag verification failed", { error: error.message });
    res.status(400).contentType("application/json").send({
      error: error.message || "Tag verification failed",
    });
  }
};

app.post("/verifyTagCheckout", verifyTagCheckoutHandler);

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

// === Personalization Handler ===

export const keyDiversificationHandler = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const request = decodeProtoRequest(req, KeyDiversificationRequest.decode);
    const response = handleKeyDiversification(request, (req as any).config);
    sendProtoResponse(req, res, response, KeyDiversificationResponse.encode);
  } catch (error: any) {
    sendHttpError(req, res, error);
  }
};

// Register routes
app.post("/terminalCheckin", terminalCheckinHandler);
app.post("/authenticateTag", authenticateTagHandler);
app.post("/completeTagAuth", completeTagAuthHandler);
app.post("/uploadUsage", uploadUsageHandler);
app.post("/personalize", keyDiversificationHandler);

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
  let message = error instanceof Error ? error.message : "Unknown Error";

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
  { secrets: [diversificationMasterKey, particleWebhookApiKey, gatewayApiKey, terminalKey] },
  app
);

// Export admin API
export { admin } from "./admin-api";

// Export Firestore triggers
export { syncCustomClaims } from "./auth/set-custom-claims";
