/**
 */

import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { onRequest } from "firebase-functions/v2/https";

import * as logger from "firebase-functions/logger";
import { defineSecret, defineString } from "firebase-functions/params";
import Particle from "particle-api-js";
import { initializeApp } from "firebase-admin/app";

// import { getFirestore } from "firebase-admin/firestore";
import { diversifyKeys } from "./key_diversification";

initializeApp();

// const db = getFirestore();
const particle = new Particle();
const particleAccessToken = defineSecret("PARTICLE_ACCESS_TOKEN");
const diversificationMasterKey = defineSecret("DIVERSIFICATION_MASTER_KEY");
const diversificationSystemName = defineString("DIVERSIFICATION_SYSTEM_NAME");

interface Personalization {
  type: "presonalization";
  requestId: string;
  uid: string;
}

type TerminalRequestPayload = Personalization;

export const terminalEvent = onMessagePublished<TerminalRequestPayload>(
  {
    topic: "terminal",
    secrets: [particleAccessToken, diversificationMasterKey],
  },
  (event) => {
    const message = event.data.message;
    const deviceId = message.attributes["device_id"];
    const payload = message.json;

    logger.info(`Received request from ${deviceId}`, payload);

    switch (payload.type) {
      case "presonalization": {
        logger.info(`Personalization for ${payload.uid}`);
        const keys = diversifyKeys(
          diversificationMasterKey.value(),
          diversificationSystemName.value(),
          payload.uid
        );

        particle.callFunction({
          deviceId,
          name: "TerminalResponse",
          argument: JSON.stringify({
            type: payload.type,
            requestId: payload.requestId,
            keys,
          }),
          auth: particleAccessToken.value(),
        });

        break;
      }
      case "presonalization": {

    }
  }
);

export const ping = onRequest((request, response) => {
  logger.info("Hello logs!", { structuredData: true });
  response.status(200).send({ response: "OK" });
});
