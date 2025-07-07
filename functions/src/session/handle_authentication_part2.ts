import { logger } from "firebase-functions";
import {
  AuthenticatePart2RequestT,
  AuthenticatePart2ResponseT,
  AuthorizationResult,
  StateAuthorizedT,
} from "../fbs/oww/session";
import * as admin from "firebase-admin";
import { authorizeStep2 } from "../ntag/authorize";
import { diversifyKey } from "../ntag/key_diversification";
import { toKeyBytes } from "../ntag/bytebuffer_util";

export async function handleAuthenticatePart2(
  request: AuthenticatePart2RequestT,
  options: {
    masterKey: string;
    systemName: string;
  }
): Promise<AuthenticatePart2ResponseT> {
  if (!request.sessionId) {
    throw new Error("Missing sessionId");
  }

  if (!request.encryptedNtagResponse) {
    throw new Error("Missing encryptedNtagResponse");
  }

  const sessionId = request.sessionId as string;

  const sessionDoc = await admin
    .firestore()
    .collection("sessions")
    .doc(sessionId)
    .get();

  if (!sessionDoc.exists) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const sessionData = sessionDoc.data();
  if (!sessionData?.rndA || !sessionData?.tokenId) {
    throw new Error(`Invalid session data: ${sessionId}`);
  }

  const authorizationKey = diversifyKey(
    options.masterKey,
    options.systemName,
    Buffer.from(sessionData.tokenId, "hex"),
    "authorization"
  );

  authorizeStep2(
    Buffer.from(request.encryptedNtagResponse),
    toKeyBytes(authorizationKey),
    sessionData.rndA
  );

  const response = new AuthenticatePart2ResponseT();
  const stateAuthorizedT = new StateAuthorizedT();
  stateAuthorizedT.name = "Werkstatt Admin"; // This should be looked up from the user database in the future
  response.resultType = AuthorizationResult.StateAuthorized;
  response.result = stateAuthorizedT;

  return response;
}
