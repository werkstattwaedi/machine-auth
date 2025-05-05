/**
 */

import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { onRequest } from "firebase-functions/v2/https";

import * as logger from "firebase-functions/logger";
import { defineSecret, defineString } from "firebase-functions/params";
import Particle from "particle-api-js";
import { initializeApp } from "firebase-admin/app";

import { getFirestore } from "firebase-admin/firestore";
import { diversifyKeys, diversifyKey, KeyName } from "./key_diversification";
import * as flatbuffers from "flatbuffers"; // Import flatbuffers library
import { StartSessionRequest } from "./fbs/oww/session/start-session-request";
import { AuthenticatePart2Request } from "./fbs/oww/session/authenticate-part2-request";
import { FirstAuthenticationT } from "./fbs/oww/session/first-authentication.js";
import { authorizeStep1 } from "./authorize";
import { StartSessionResponse } from "./fbs/oww/session/start-session-response";
import { AuthenticatePart2Response } from "./fbs/oww/session/authenticate-part2-response.js";
import { StateAuthorized } from "./fbs/oww/session/state-authorized.js";
import { StateRejected } from "./fbs/oww/session/state-rejected.js";
import { AuthenticationPart2 } from "./fbs/oww/session/authentication-part2.js";
import { AuthorizationResult } from "./fbs/oww/session/authorization-result.js";

initializeApp();

const db = getFirestore();
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

    // Decode the base64 message data from Pub/Sub
    const rawData = Buffer.from(message.data, "base64").toString("utf8");

    // Split the comma-separated string
    const parts = rawData.split(",");
    if (parts.length !== 3) {
      logger.error(
        `Invalid message format received from ${deviceId}: ${rawData}`
      );
      return; // Or handle error appropriately
    }

    const [command, requestId, base64Payload] = parts;

    const fbByteBuffer = new flatbuffers.ByteBuffer(
      Buffer.from(base64Payload, "base64")
    );

    logger.info(`Received request ${command} (${requestId}) from ${deviceId}`);

    const builder = new flatbuffers.Builder(1024);

    switch (command) {
      // case "personalization": {
      //   // Assuming personalization still needs uid, which isn't in the base64 payload based on the C++ code.
      //   // This part needs clarification on where the UID comes from for personalization.
      //   // For now, let's assume it might be part of the flatbuffer or needs fetching.
      //   const uid = "placeholder-uid"; // Placeholder - Update based on actual data source
      //   logger.info(`Personalization for ${uid}`);
      //   responsePayload = {
      //     keys: diversifyKeys(
      //       diversificationMasterKey.value(),
      //       diversificationSystemName.value(),
      //       uid
      //     ),
      //   };
      //   // Personalization might have a different response structure/command name
      //   // responseCommand = "personalizationResponse"; // Example
      //   break;
      // }
      case "startSession": {
        const request =
          StartSessionRequest.getRootAsStartSessionRequest(fbByteBuffer);
        const requestData = request.unpack(); // Use unpacked data for easier access

        logger.info("Deserialized startSession request:", requestData);

        // Ensure tokenId and uid exist before proceeding
        if (!requestData.tokenId?.uid) {
          throw new Error("Missing tokenId or uid in startSession request");
        }
        const uid = Buffer.from(requestData.tokenId.uid);

        let resultType: AuthorizationResult = AuthorizationResult.NONE;
        let resultOffset: flatbuffers.Offset = 0;

        switch (requestData.authenticationType) {
          case 0: // Authentication.NONE
            logger.info("Authentication type: NONE - Rejecting");
            const message = builder.createString("Authentication required");
            StateRejected.startStateRejected(builder);
            StateRejected.addMessage(builder, message);
            resultOffset = StateRejected.endStateRejected(builder);
            resultType = AuthorizationResult.StateRejected;
            break;
          case 1: {
            logger.info("Authentication type: FirstAuthentication");
            if (
              !requestData.authentication ||
              !(requestData.authentication instanceof FirstAuthenticationT)
            ) {
              throw new Error(
                "Missing or invalid authentication data for FirstAuthentication"
              );
            }
            const firstAuth =
              requestData.authentication as FirstAuthenticationT;
            if (!firstAuth.ntagChallenge) {
              throw new Error(
                "Missing ntagChallenge in FirstAuthentication data"
              );
            }

            const authorizationKey = diversifyKey(
              diversificationMasterKey.value(),
              diversificationSystemName.value(),
              uid,
              "authorization"
            );

            const challengeResponse = authorizeStep1(
              firstAuth.ntagChallenge,
              authorizationKey
            );

            const cloudChallengeOffset =
              AuthenticationPart2.createCloudChallengeVector(
                builder,
                challengeResponse.subarray(0, 16)
              );
            AuthenticationPart2.startAuthenticationPart2(builder);
            AuthenticationPart2.addCloudChallenge(
              builder,
              cloudChallengeOffset
            );
            resultOffset = AuthenticationPart2.endAuthenticationPart2(builder);
            resultType = AuthorizationResult.AuthenticationPart2;

            break;
          }
          case 2: // Authentication.RecentAuthentication
            logger.info(
              "Authentication type: RecentAuthentication - Assuming authorized for now"
            );
            const name = builder.createString("Werkstatt Admin (Recent)");
            StateAuthorized.startStateAuthorized(builder);
            StateAuthorized.addName(builder, name);
            resultOffset = StateAuthorized.endStateAuthorized(builder);
            resultType = AuthorizationResult.StateAuthorized;
            break;
          default:
            logger.error(
              `Unknown authentication type: ${requestData.authenticationType}`
            );
            const errorMessage = builder.createString(
              "Unknown authentication type"
            );
            StateRejected.startStateRejected(builder);
            StateRejected.addMessage(builder, errorMessage);
            resultOffset = StateRejected.endStateRejected(builder);
            resultType = AuthorizationResult.StateRejected;
        }

        const sessionId = builder.createString("session-123");

        StartSessionResponse.startStartSessionResponse(builder);
        StartSessionResponse.addSessionId(builder, sessionId);
        StartSessionResponse.addResultType(builder, resultType);
        StartSessionResponse.addResult(builder, resultOffset);
        const responseOffset =
          StartSessionResponse.endStartSessionResponse(builder);

        builder.finish(responseOffset);

        break;
      }
      case "authenticatePart2": {
        const request =
          AuthenticatePart2Request.getRootAsAuthenticatePart2Request(
            fbByteBuffer
          );
        const requestData = request.unpack();

        logger.info("Deserialized authenticatePart2 request:", requestData);

        if (!requestData.sessionId) {
          throw new Error("Missing sessionId in authenticatePart2 request");
        }
        const sessionId = builder.createString(requestData.sessionId);
        const name = builder.createString("Werkstatt Admin (Auth2)");
        StateAuthorized.startStateAuthorized(builder);
        StateAuthorized.addName(builder, name);
        const resultOffset = StateAuthorized.endStateAuthorized(builder);

        AuthenticatePart2Response.startAuthenticatePart2Response(builder);
        AuthenticatePart2Response.addSessionId(builder, sessionId);
        AuthenticatePart2Response.addResultType(
          builder,
          AuthorizationResult.StateAuthorized
        );
        AuthenticatePart2Response.addResult(builder, resultOffset);
        const responseOffset =
          AuthenticatePart2Response.endAuthenticatePart2Response(builder);

        builder.finish(responseOffset);

        break;
      }
      default: {
        logger.error(`Unknown command ${command}`);
      }
    }

    const responseBytes = builder.asUint8Array();
    const responseBase64Payload = Buffer.from(responseBytes).toString("base64");

    const argumentString = `${command},${requestId},${responseBase64Payload}`;

    particle.callFunction({
      deviceId,
      name: "TerminalResponse",
      argument: argumentString,
      auth: particleAccessToken.value(),
    });
  }
);

export const ping = onRequest((request, response) => {
  logger.info("Hello logs!", { structuredData: true });
  response.status(200).send({ response: "OK" });
});
