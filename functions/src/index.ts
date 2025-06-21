import express from "express";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { defineSecret, defineString } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import * as flatbuffers from "flatbuffers";
import { StartSessionRequest } from "./fbs/oww/session/start-session-request";
import { AuthenticatePart2Request } from "./fbs/oww/session/authenticate-part2-request";
import { handleStartSession } from "./session/handle_start_session";
import { handleAuthenticatePart2 } from "./session/handle_authentication_part2";

initializeApp();

const diversificationMasterKey = defineSecret("DIVERSIFICATION_MASTER_KEY");
const diversificationSystemName = defineString("DIVERSIFICATION_SYSTEM_NAME");

export const app = express();
app.use(express.text());

// Middleware to attach config to request
app.use(
  (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
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
    const startSessionResponseFbs = handleStartSession(
      unpackRequest(req, (buffer) =>
        StartSessionRequest.getRootAsStartSessionRequest(buffer).unpack()
      ),
      (req as any).config
    );

    sendFlatbufferSuccessResponse(res, startSessionResponseFbs);
  } catch (error: any) {
    sendHttpError(req, res, error);
  }
};

export const authenticatePart2Handler = async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const responseFbs = handleAuthenticatePart2(
      unpackRequest(req, (buffer) =>
        AuthenticatePart2Request.getRootAsAuthenticatePart2Request(
          buffer
        ).unpack()
      ),
      (req as any).config
    );

    sendFlatbufferSuccessResponse(res, responseFbs);
  } catch (error: any) {
    sendHttpError(req, res, error);
  }
};

app.post("/startSession", startSessionHandler);
app.post("/authenticatePart2", authenticatePart2Handler);

function unpackRequest<T>(
  req: express.Request,
  unpacker: (buffer: flatbuffers.ByteBuffer) => T
): T {
  if (req.method !== "POST") {
    throw new Error("Method Not Allowed.");
  }

  const base64Payload = req.body;
  if (typeof base64Payload !== "string" || base64Payload.trim() === "") {
    throw new Error("Missing request body.");
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

function sendHttpError(req: express.Request, res: express.Response, error: any) {
  console.log("Request Failed!", error);
  let message = "unknown error2";
  if (error instanceof Error) {
    message = error.message;
  }

  // logger.error(`Request ${req.url} failed`, error);

  res.status(400).contentType("application/json").send({ message });
}

function sendFlatbufferSuccessResponse(
  res: express.Response,
  responseObject: flatbuffers.IGeneratedObject
) {
  const responseBuilder = new flatbuffers.Builder(1024);
  const responseOffset = responseObject.pack(responseBuilder);
  responseBuilder.finish(responseOffset);
  const responseBytes = responseBuilder.asUint8Array();
  const responseBase64 = Buffer.from(responseBytes).toString("base64");
  res.status(200).type("text/plain").send(responseBase64);
}

export const api = onRequest({ secrets: [diversificationMasterKey] }, app);
