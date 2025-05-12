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

export function handleStartSession(
  request: StartSessionRequestT,
  options: {
    masterKey: string;
    systemName: string;
  }
): StartSessionResponseT {
  logger.info("handleStartSession", request);
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
        firstAuth.ntagChallenge,
        authorizationKey
      );

      const authenticationPart2T = new AuthenticationPart2T();
      authenticationPart2T.cloudChallenge = Array.from(challengeResponse);
      response.resultType = AuthorizationResult.AuthenticationPart2;
      response.result = authenticationPart2T;
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

  response.sessionId = "session-123"; // Assign session ID

  return response;
}
