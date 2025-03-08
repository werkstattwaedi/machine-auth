/**
 */

import { onMessagePublished } from "firebase-functions/v2/pubsub";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import Particle from "particle-api-js";

const particle = new Particle();
const particleAccessToken = defineSecret("PARTICLE_ACCESS_TOKEN");

interface BlankTag {
  type: "blank-tag";
  uid: string;
}

type TerminalPayload = BlankTag;

export const terminalEvent = onMessagePublished<TerminalPayload>(
  { topic: "terminal", secrets: [particleAccessToken] },
  (event) => {
    const message = event.data.message;
    const deviceId = message.attributes["device_id"];
    const payload = message.json;

    logger.warn(`Received event from ${deviceId}`, payload);

    switch (payload.type) {
    case "blank-tag":
      logger.warn(`Blank Tag ${payload.uid}`);

      particle.callFunction({
        deviceId,
        name: "State",
        argument: JSON.stringify({ response: "OK" }),
        auth: particleAccessToken.value(),
      });

      break;
    }
  },
);
