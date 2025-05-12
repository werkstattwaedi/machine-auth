/**
 */

import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { onRequest } from "firebase-functions/v2/https";

import * as logger from "firebase-functions/logger";
import { defineSecret, defineString } from "firebase-functions/params";
import Particle from "particle-api-js";
import { initializeApp } from "firebase-admin/app";

import { getFirestore } from "firebase-admin/firestore";
import * as flatbuffers from "flatbuffers";
import { StartSessionRequest } from "./fbs/oww/session/start-session-request";
import { AuthenticatePart2Request } from "./fbs/oww/session/authenticate-part2-request";
import { handleStartSession } from "./session/handle_start_session";
import { handleAuthenticatePart2 } from "./session/handle_authentication_part2";

initializeApp();

const particle = new Particle();
const particleAccessToken = defineSecret("PARTICLE_ACCESS_TOKEN");
const diversificationMasterKey = defineSecret("DIVERSIFICATION_MASTER_KEY");
const diversificationSystemName = defineString("DIVERSIFICATION_SYSTEM_NAME");

export const terminalEvent = onMessagePublished<String>(
  {
    topic: "terminal",
    secrets: [particleAccessToken, diversificationMasterKey],
  },
  (event) => {
    const message = event.data.message;
    const deviceId = message.attributes["device_id"];

    const rawData = Buffer.from(message.data, "base64").toString("utf8");
    const parts = rawData.split(",");
    if (parts.length !== 3) {
      logger.error(
        `Invalid message format received from ${deviceId}: ${rawData}`
      );
      return;
    }

    const [command, requestId, base64Payload] = parts;
    logger.info(`Received request ${command} (${requestId}) from ${deviceId}`);

    const flatByteBuffer = new flatbuffers.ByteBuffer(
      Buffer.from(base64Payload, "base64")
    );

    let response: flatbuffers.IGeneratedObject | null = null;

    const diversificationInfo = {
      masterKey: diversificationMasterKey.value(),
      systemName: diversificationSystemName.value(),
    };

    try {
      switch (command) {
        case "startSession": {
          const request =
            StartSessionRequest.getRootAsStartSessionRequest(
              flatByteBuffer
            ).unpack();

          response = handleStartSession(request, {
            ...diversificationInfo,
          });
          break;
        }
        case "authenticatePart2": {
          const request =
            AuthenticatePart2Request.getRootAsAuthenticatePart2Request(
              flatByteBuffer
            ).unpack();

          response = handleAuthenticatePart2(request, {
            ...diversificationInfo,
          });
          break;
        }
        default: {
          logger.error(`Unknown command ${command}`);
          break;
        }
      }
    } catch (error) {
      logger.error(`Error processing command ${command}: ${error}`);
    }

    let responseArgument: string;
    if (response) {
      const responseBuilder = new flatbuffers.Builder(1024);

      const responseOffset = response.pack(responseBuilder);
      responseBuilder.finish(responseOffset);

      const responseBytes = responseBuilder.asUint8Array();
      const responseBase64Payload =
        Buffer.from(responseBytes).toString("base64");
      responseArgument = `${requestId},OK,${responseBase64Payload}`;
    } else {
      responseArgument = `${requestId},ERROR`;
    }

    particle.callFunction({
      deviceId,
      name: "TerminalResponse",
      argument: responseArgument,
      auth: particleAccessToken.value(),
    });
  }
);

export const ping = onRequest((request, response) => {
  logger.info("Hello logs!", { structuredData: true });
  response.status(200).send({ response: "OK" });
});
