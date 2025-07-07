import {
  Authentication,
  AuthenticationPart2T,
  AuthorizationResult,
  FirstAuthenticationT,
  StartSessionRequestT,
  StartSessionResponseT,
  StateAuthorizedT,
} from "../fbs/oww/session";
import * as logger from "firebase-functions/logger";
import { diversifyKey } from "../ntag/key_diversification";
import { authorizeStep1 } from "../ntag/authorize";
import { toKeyBytes } from "../ntag/bytebuffer_util";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export async function handleStartSession(
  request: StartSessionRequestT,
  options: {
    masterKey: string;
    systemName: string;
  }
): Promise<StartSessionResponseT> {
  if (!request.tokenId?.uid) {
    throw new Error("Missing token uid in startSession request");
  }
  const uid = Buffer.from(request.tokenId.uid);

  const response = new StartSessionResponseT();

  switch (request.authenticationType) {
    case Authentication.FirstAuthentication: {
      const firstAuth = request.authentication as FirstAuthenticationT;
      if (!firstAuth.ntagChallenge) {
        throw new Error("Missing ntagChallenge in FirstAuthentication data");
      }

      const authorizationKey = diversifyKey(
        options.masterKey,
        options.systemName,
        uid,
        "authorization"
      );

      const challengeResponse = authorizeStep1(
        Buffer.from(firstAuth.ntagChallenge),
        toKeyBytes(authorizationKey)
      );

      const sessionId = admin.firestore().collection("sessions").doc().id;
      await admin
        .firestore()
        .collection("sessions")
        .doc(sessionId)
        .set({
          rndA: challengeResponse.cloudChallenge,
          tokenId: uid.toString("hex"),
          createdAt: Timestamp.now(),
        });

      const authenticationPart2T = new AuthenticationPart2T();
      authenticationPart2T.cloudChallenge = Array.from(
        challengeResponse.encrypted
      );
      response.resultType = AuthorizationResult.AuthenticationPart2;
      response.result = authenticationPart2T;
      response.sessionId = sessionId;
      break;
    }
    case Authentication.RecentAuthentication: {
      throw new Error("Not yet implemented");
      const stateAuthorizedT = new StateAuthorizedT();
      stateAuthorizedT.name = "Werkstatt Admin (Recent)";
      response.resultType = AuthorizationResult.StateAuthorized;
      response.result = stateAuthorizedT;
      break;
    }
    default:
      throw new Error(
        `Unknown authentication type: ${request.authenticationType}`
      );
  }

  return response;
}
