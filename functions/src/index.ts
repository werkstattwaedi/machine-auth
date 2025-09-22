import express from "express";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { defineSecret, defineString } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import * as flatbuffers from "flatbuffers";
import { StartSessionRequest , AuthenticateNewSessionRequest ,  CompleteAuthenticationRequest , UploadUsageRequest } from "./fbs";
import { KeyDiversificationRequest } from "./fbs/key-diversification-request.js";
import { handleStartSession } from "./session/handle_start_session";
import { handleAuthenticateNewSession } from "./session/handle_authenticate_new_session";
import { handleCompleteAuthentication } from "./session/handle_complete_authentication";
import { handleUploadUsage } from "./session/handle_upload_usage";
import { handleKeyDiversification } from "./personalization/handle_key_diversification";

initializeApp();

const diversificationMasterKey = defineSecret("DIVERSIFICATION_MASTER_KEY");
const diversificationSystemName = defineString("DIVERSIFICATION_SYSTEM_NAME");
const particleWebhookApiKey = defineSecret("PARTICLE_WEBHOOK_API_KEY");

export const app = express();
app.use(express.json());

// Authentication middleware to check for the Particle webhook API key.
const authMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const authHeader = req.headers.authorization;
  const apiKey = particleWebhookApiKey.value();

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.warn("Missing or invalid Authorization header.");
    return res.status(401).send({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  if (token !== apiKey) {
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
    };
    next();
  }
);

export const startSessionHandler = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const responseFbs = await handleStartSession(
      unpackRequest(req, (buffer) =>
        StartSessionRequest.getRootAsStartSessionRequest(buffer).unpack()
      ),
      (req as any).config
    );

    sendFlatbufferSuccessResponse(req, res, responseFbs);
  } catch (error: any) {
    sendHttpError(req, res, error);
  }
};

export const authenticateNewSessionHandler = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const responseFbs = await handleAuthenticateNewSession(
      unpackRequest(req, (buffer) =>
        AuthenticateNewSessionRequest.getRootAsAuthenticateNewSessionRequest(buffer).unpack()
      ),
      (req as any).config
    );

    sendFlatbufferSuccessResponse(req, res, responseFbs);
  } catch (error: any) {
    sendHttpError(req, res, error);
  }
};

export const completeAuthenticationHandler = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const responseFbs = await handleCompleteAuthentication(
      unpackRequest(req, (buffer) =>
        CompleteAuthenticationRequest.getRootAsCompleteAuthenticationRequest(buffer).unpack()
      ),
      (req as any).config
    );

    sendFlatbufferSuccessResponse(req, res, responseFbs);
  } catch (error: any) {
    sendHttpError(req, res, error);
  }
};

export const uploadUsageHandler = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const responseFbs = await handleUploadUsage(
      unpackRequest(req, (buffer) =>
        UploadUsageRequest.getRootAsUploadUsageRequest(buffer).unpack()
      ),
      (req as any).config
    );

    sendFlatbufferSuccessResponse(req, res, responseFbs);
  } catch (error: any) {
    sendHttpError(req, res, error);
  }
};


export const keyDiversificationHandler = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const keyDiversificationResponseFbs = handleKeyDiversification(
      unpackRequest(req, (buffer) =>
        KeyDiversificationRequest.getRootAsKeyDiversificationRequest(
          buffer
        ).unpack()
      ),
      (req as any).config
    );
    sendFlatbufferSuccessResponse(req, res, keyDiversificationResponseFbs);
  } catch (error: any) {
    sendHttpError(req, res, error);
  }
};

app.post("/startSession", startSessionHandler);
app.post("/authenticateNewSession", authenticateNewSessionHandler);
app.post("/completeAuthentication", completeAuthenticationHandler);
app.post("/uploadUsage", uploadUsageHandler);
app.post("/personalize", keyDiversificationHandler);

function unpackRequest<T>(
  req: express.Request,
  unpacker: (buffer: flatbuffers.ByteBuffer) => T
): T {
  if (req.method !== "POST") {
    throw new Error("Method Not Allowed.");
  }

  const base64Payload = req.body.data;

  if (typeof base64Payload !== "string" || base64Payload.trim() === "") {
    throw new Error("Missing request payload.");
  }

  try {
    const flatByteBuffer = new flatbuffers.ByteBuffer(
      Buffer.from(base64Payload, "base64")
    );
    return unpacker(flatByteBuffer);
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

function sendFlatbufferSuccessResponse(
  req: express.Request,
  res: express.Response,
  responseObject: flatbuffers.IGeneratedObject
) {
  const responseBuilder = new flatbuffers.Builder(1024);
  const responseOffset = responseObject.pack(responseBuilder);
  responseBuilder.finish(responseOffset);
  const responseBytes = responseBuilder.asUint8Array();
  const responseBase64 = Buffer.from(responseBytes).toString("base64");

  res.status(200).contentType("application/json").send({
    id: req.body.id,
    data: responseBase64,
  });
}

export const api = onRequest(
  { secrets: [diversificationMasterKey, particleWebhookApiKey] },
  app
);